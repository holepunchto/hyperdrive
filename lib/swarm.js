var protocol = require('./protocol')
var hash = require('./hash')
var thunky = require('thunky')
var flat = require('flat-tree')
var equals = require('buffer-equals')

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
    block: get,
    ready: thunky(open),
    sync: low(sync)
  }

  function sync (data, cb) {
    console.log('should sync')
    cb()
  }

  function get (block, proof, cb) {
    if (!ptr) return cb(new Error('Must open first'))

    self.drive._hashes.get(ptr + (2 * block), function (err, hash) {
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
          channels.blocks = info.blocks
          ptr = prefix((info.pointer || info.id).toString('hex'), '')
        } else {
          ptr = prefix(link.toString('hex'), '')
        }
        if (bits) {
          channels.bitfield = bitfield(bits, {grow: channels.blocks || Infinity})
        }
        cb()
      })
    })
  }

  function fetch () {
    console.log('[swarm %s] should fetch', self._name)

    for (var i = 0; i < channels.peers.length; i++) {
      var peer = channels.peers[i]
      var block = chooseBlock(peer)
      if (block > -1) peer.request(block)
    }
  }

  function chooseBlock (peer) {
    var len = peer.remoteBitfield.buffer.length * 8
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

  console.log('[swarm %s] new peer stream', this._name)

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
    console.log('[channel %s] joined channel', name)
    var state = add(ch)

    ch.on('response', function (block, data, proof) {
      console.log('[channel %s] rcvd response #%d (%d bytes, proof contained %d hashes)', name, block, data.length, proof.length)

      if (!state.blocks) { // first ever response *MUST* include root proof
        var blocks = validateRoots(proof, ch.link)
        if (!blocks) return ch.leave(new Error('Invalid root proof'))
        state.blocks = blocks
      }
    })

    ch.on('request', function (block) {
      if (!state.blocks) return

      console.log('[channel %s] rcvd request #%d', name, block)

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
      console.log('[channel %s] warning "%s"', name, err.message)
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
