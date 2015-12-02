var protocol = require('./protocol')
var hash = require('./hash')
var thunky = require('thunky')
var flat = require('flat-tree')
var equals = require('buffer-equals')
var debug = require('debug')('hyperdrive-swarm')

module.exports = Swarm

function Swarm (drive, opts) {
  if (!(this instanceof Swarm)) return new Swarm(drive, opts)
  if (!opts) opts = {}
  this._name = opts.name || 'unknown'
  this.drive = drive
  this.peers = []
  this.links = []
  this.joined = {}
}

Swarm.prototype._get = function (link) {
  var id = link.toString('hex')

  if (this.joined[id]) return this.joined[id]

  var bitfield = require('bitfield')
  var low = require('last-one-wins')
  var prefix = require('sublevel-prefixer')()

  var self = this
  var ptr = null

  var channels = {
    id: id,
    link: link,
    bitfield: bitfield(1, {grow: Infinity}),
    blocks: 0,
    want: [],
    peers: [],
    fetch: fetch,
    put: put,
    block: get,
    ready: thunky(open),
    sync: low(sync)
  }

  var first = true

  function sync (data, cb) {
    debug('[%s] syncing bitfield', self._name)
    if (first) self.drive._links.put(id, {id: link, blocks: channels.blocks})
    first = false
    self.drive._bitfields.put(id, channels.bitfield.buffer, cb)
  }

  var pending = {}

  function put (block, data, proof, cb) {
    if (!cb) cb = function () {}

    var batch = []
    var rootLength = 0

    if (!channels.blocks) { // first ever response *MUST* include root proof
      var blocks = validateRoots(proof, link)
      if (!blocks) return cb(new Error('Invalid root proof'))
      channels.blocks = blocks

      rootLength = flat.fullRoots(2 * blocks).length
      var roots = proof.slice(-rootLength)

      for (var i = 0; i < roots.length; i++) {
        pending['hash/' + roots[i].index] = roots[i].hash
        batch.push({
          type: 'put',
          key: ptr + roots[i].index,
          value: roots[i].hash
        })
      }
    }

    var top = hash.data(data)
    var want = 2 * block
    var offset = 0
    var swap = false

    var digest = {
      index: want,
      hash: top
    }

    getHash(want, loop)

    function write () {
      pending['hash/' + digest.index] = digest.hash
      batch.push({
        type: 'put',
        key: ptr + digest.index,
        value: digest.hash
      })

      for (var i = 0; i < offset; i++) {
        pending['hash/' + proof[i].index] = proof[i].hash
        batch.push({
          type: 'put',
          key: ptr + proof[i].index,
          value: proof[i].hash
        })
      }

      self.drive._hashes.batch(batch, function (err) {
        for (var i = 0; i < offset; i++) delete pending['hash/' + i]
        for (var j = proof.length - rootLength; j < proof.length; j++) delete pending['hash/' + j]
        if (err) return cb(err)
        self.drive._blocks.put(digest.hash.toString('hex'), data, function (err) {
          if (err) return cb(err)
          channels.bitfield.set(block)
          channels.sync()

          for (var i = 0; i < channels.peers.length; i++) {
            channels.peers[i].have(block)
          }

          var remove = []
          for (var j = 0; j < channels.want.length; j++) {
            if (channels.want[j].block === block) {
              remove.push(j)
              channels.want[j].cb(null, data)
            }
          }
          for (var k = 0; k < remove.length; k++) {
            channels.want.splice(k, 1)
          }

          cb(null)
        })
      })
    }

    function loop (_, trusted) {
      if (trusted && equals(trusted, top)) return write()

      var sibling = flat.sibling(want)
      swap = sibling < want
      want = flat.parent(sibling)

      if (offset < proof.length &&  proof[offset].index === sibling) {
        next(null, proof[offset++].hash)
      } else {
        getHash(sibling, next)
      }
    }

    function next (err, sibling) {
      if (err) return cb(err)
      if (swap) top = hash.tree(sibling, top)
      else top = hash.tree(top, sibling)
      getHash(want, loop)
    }
  }

  function getHash (index, cb) {
    var tmp = pending['hash/' + index]
    if (tmp) return cb(null, tmp)
    self.drive._hashes.get(ptr + index, cb)
  }

  function get (block, proof, cb) {
    if (!ptr) return cb(new Error('Must open first'))

    getHash(2 * block, function (err, hash) {
      if (err) return cb(err)
      self.drive._blocks.get(hash.toString('hex'), function (err, data) {
        if (err) return cb(err)

        var i = 0
        loop()

        function loop () {
          if (i === proof.length) return cb(null, data, proof)
          self.drive._hashes.get(ptr + proof[i].index, next)
        }

        function next (err, hash) {
          if (err) return cb(err)
          proof[i++].hash = hash
          loop()
        }
      })
    })
  }

  function open (cb) {
    self.drive._links.get(id, function (_, info) {
      self.drive._bitfields.get(id, function (_, bits) {
        if (info) {
          first = false
          channels.blocks = info.blocks
          ptr = prefix((info.pointer || info.id).toString('hex'), '')
        } else {
          ptr = prefix(link.toString('hex'), '')
        }
        channels.prefix = ptr
        if (bits) {
          channels.bitfield = bitfield(bits, {grow: channels.blocks || Infinity})
        }
        cb()
      })
    })
  }

  function fetch () {
    debug('[%s] should fetch', self._name)

    channels.ready(function () {
      for (var i = 0; i < channels.peers.length; i++) {
        var peer = channels.peers[i]
        var block = chooseBlock(peer)
        if (block > -1) {
          peer.request(block)
          debug('[%s] peer #%d is fetching block %d', self._name, i, block)
        }
      }
    })
  }

  function chooseBlock (peer) {
    var len = peer.remoteBitfield.buffer.length * 8

    for (var j = 0; j < channels.want.length; j++) {
      var block = channels.want[j].block
      if (peer.amRequesting.get(block)) continue
      if (peer.remoteBitfield.get(block) && !channels.bitfield.get(block)) {
        debug('[%s] choosing prioritized block #%d', self._name, block)
        return block
      }
    }

    for (var i = 0; i < len; i++) {
      if (peer.amRequesting.get(i)) continue
      if (peer.remoteBitfield.get(i) && !channels.bitfield.get(i)) {
        return i
      }
    }

    return -1
  }


  this.joined[id] = channels
  return channels
}

Swarm.prototype.join = function (link) {
  if (this.links.indexOf(link.toString('hex')) === -1) {
    this.links.push(link.toString('hex'))
  }

  for (var i = 0; i < this.peers.length; i++) {
    this.peers[i].join(link)
  }

  return this._get(link)
}

Swarm.prototype.createStream = function () {
  var self = this
  var peer = protocol()

  debug('[%s] new peer stream', this._name)

  peer.on('channel', onchannel)
  peer.on('end', remove)
  peer.on('finish', remove)
  peer.on('close', remove)

  this.peers.push(peer)
  for (var i = 0; i < this.links.length; i++) {
    peer.join(new Buffer(this.links[i], 'hex'))
  }

  return peer

  function add (ch) {
    var state = self._get(ch.link)
    state.peers.push(ch)
    ch.on('leave', function () {
      var i = state.peers.indexOf(ch)
      if (i > -1) state.peers.splice(ch, 1)
    })
    return state
  }

  function onchannel (ch) {
    var name = ch.link.toString('hex').slice(0, 12) + '/' + self._name
    debug('[channel %s] joined channel', name)
    var state = add(ch)

    ch.on('response', function (block, data, proof) {
      debug('[channel %s] rcvd response #%d (%d bytes, proof contained %d hashes)', name, block, data.length, proof.length)
      state.put(block, data, proof, function (err) {
        if (err) ch.leave(err)
        state.fetch()
      })
    })

    ch.on('request', function (block) {
      if (!state.blocks) return

      debug('[channel %s] rcvd request #%d', name, block)

      // TODO: only send back what the peer is missing
      var proof = []
      var limit = 2 * state.blocks
      var want = flat.sibling(2 * block)

      while (flat.rightSpan(want) < limit) {
        proof.push({
          index: want,
          hash: null
        })
        want = flat.sibling(flat.parent(want))
      }

      var roots = flat.fullRoots(limit)
      for (var i = 0; i < roots.length; i++) {
        proof.push({
          index: roots[i],
          hash: null
        })
      }

      state.block(block, proof, function (err, data, proof) {
        if (err) return ch.leave(err)
        ch.response(block, data, proof)
      })
    })

    ch.on('warn', function (err) {
      debug('[channel %s] warning "%s"', name, err.message)
    })

    ch.on('have', function () {
      state.fetch()
    })

    state.ready(function (err) {
      if (err) return ch.leave(err)
      ch.bitfield(state.bitfield)
    })
  }

  function remove () {
    var i = self.peers.indexOf(peer)
    if (i > -1) self.peers.splice(i, 1)
  }
}

function validateRoots (proof, id) {
  if (!proof.length) return 0
  var blocks = (flat.rightSpan(proof[proof.length - 1].index) + 2) / 2
  var roots = flat.fullRoots(2 * blocks)
  if (proof.length < roots.length) return 0
  var proofRoots = proof.slice(-roots.length)
  for (var i = 0; i < roots.length; i++) {
    if (proofRoots[i].index !== roots[i]) return 0
  }
  if (!equals(id, hash.root(proofRoots))) return 0
  return blocks
}
