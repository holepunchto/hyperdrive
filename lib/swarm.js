var protocol = require('./protocol')
var debug = require('debug')('hyperdrive-swarm')

module.exports = Swarm

function Swarm (drive, opts) {
  if (!(this instanceof Swarm)) return new Swarm(drive, opts)
  if (!opts) opts = {}
  this.name = opts.name || 'unknown'
  this.prioritized = 0
  this.drive = drive
  this.peers = []
  this.links = []
  this.joined = {}
}

Swarm.prototype._get = function (link) {
  var id = link.toString('hex')
  var self = this

  if (this.joined[id]) return this.joined[id]

  var subswarm = {
    id: id,
    feed: this.drive._open(link),
    link: link,
    peers: [],
    fetch: fetch
  }

  subswarm.feed.on('want', function () {
    self.prioritized++
    subswarm.fetch()
  })

  subswarm.feed.on('unwant', function () {
    self.prioritized--
    if (!self.prioritized) subswarm.fetch()
  })

  subswarm.feed.on('put', function (block) {
    for (var i = 0; i < subswarm.peers.length; i++) {
      subswarm.peers[i].have(block)
    }
  })

  this.joined[id] = subswarm
  return subswarm

  function fetch (peer) {
    if (!subswarm.feed.opened) return
    debug('[%s] should fetch', self.name)

    if (peer) fetchPeer(peer)
    else subswarm.peers.forEach(fetchPeer)
  }

  function fetchPeer (peer) {
    while (true) {
      if (peer.stream.inflight >= 5) return // max 5 inflight requests
      var block = chooseBlock(peer)
      if (block === -1) return
      peer.request(block)
      debug('[%s] peer is fetching block %d', self.name, block)
    }
  }

  function chooseBlock (peer) {
    // TODO: maintain a bitfield of perswarm blocks in progress
    // so we wont fetch the same data from multiple peers

    var len = peer.remoteBitfield.buffer.length * 8
    var block = -1

    for (var j = 0; j < subswarm.feed.want.length; j++) {
      block = subswarm.feed.want[j].block
      if (peer.amRequesting.get(block)) continue
      if (peer.remoteBitfield.get(block) && !subswarm.feed.bitfield.get(block)) {
        debug('[%s] choosing prioritized block #%d', self.name, block)
        return block
      }
    }

    // TODO: there might be a starvation convern here. should only return *if* there are peers that
    // that could satisfy the want list. this is just a quick "hack" for realtime prioritization
    // when dealing with multiple files
    if (self.prioritized && !subswarm.feed.want.length) return -1

    var offset = subswarm.feed.want.length ? subswarm.feed.want[0].block : ((Math.random() * len) | 0)
    for (var i = 0; i < len; i++) {
      block = (offset + i) % len
      if (peer.amRequesting.get(block)) continue
      if (peer.remoteBitfield.get(block) && !subswarm.feed.bitfield.get(block)) {
        debug('[%s] choosing unprioritized block #%d', self.name, block)
        return block
      }
    }

    return -1
  }
}

Swarm.prototype.join = function (link) {
  var id = link.toString('hex')
  if (this.links.indexOf(id) === -1) this.links.push(id)

  for (var i = 0; i < this.peers.length; i++) {
    this.peers[i].join(link)
  }

  return this._get(link)
}

Swarm.prototype.createStream = function () {
  var self = this
  var peer = protocol()

  debug('[%s] new peer stream', this.name)

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
    var subswarm = self._get(ch.link)
    subswarm.peers.push(ch)
    ch.on('leave', function () {
      var i = subswarm.peers.indexOf(ch)
      if (i > -1) subswarm.peers.splice(ch, 1)
    })
    return subswarm
  }

  function onchannel (ch) {
    var name = ch.link.toString('hex').slice(0, 12) + '/' + self.name
    var subswarm = add(ch)

    debug('[channel %s] joined channel', name)

    ch.on('response', function (block, data, proof) {
      debug('[channel %s] rcvd response #%d (%d bytes, proof contained %d hashes)', name, block, data.length, proof.length)
      subswarm.fetch(ch)
      subswarm.feed.put(block, data, proof, function (err) {
        if (err) ch.leave(err)
      })
    })

    ch.on('request', function (block) {
      debug('[channel %s] rcvd request #%d', name, block)
      subswarm.feed.get(block, function (err, data) {
        if (err) return ch.leave(err)
        if (!data) return ch.leave(new Error('Remote peer wants a block that is out of bounds'))
        subswarm.feed.proof(block, function (err, proof) {
          if (err) return ch.leave(err)
          ch.response(block, data, proof)
        })
      })
    })

    ch.on('warn', function (err) {
      debug('[channel %s] warning "%s"', name, err.message)
    })

    ch.on('have', function () {
      subswarm.fetch(ch)
    })

    subswarm.feed.open(function (err) {
      if (err) return ch.leave(err)
      ch.bitfield(subswarm.feed.bitfield)
    })
  }

  function remove () {
    var i = self.peers.indexOf(peer)
    if (i > -1) self.peers.splice(i, 1)
  }
}
