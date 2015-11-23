var Multiplex = require('multiplex')
var bitfield = require('bitfield')
var ids = require('numeric-id-map')
var util = require('util')
var events = require('events')
var messages = require('./messages')

var MAX_BLOCKS = 10 * 1024 * 1024 // 160gb of data (ish) - TODO: add compressed version as well

var ENCODERS = [
  messages.Request,
  messages.Response,
  messages.Have,
  messages.Unchoke,
  messages.Choke
]

module.exports = Protocol

function Protocol (onjoin) { // TODO: add protocol string in the beginning (use @jbenets thing for that)
  if (!(this instanceof Protocol)) return new Protocol(onjoin)
  Multiplex.call(this, {limit: 5 * 1024 * 1024, binaryName: true}, onlink)

  function onlink (stream, link) {
    onjoin(new Channel(stream, link))
  }
}

util.inherits(Protocol, Multiplex)

Protocol.prototype.join = function (link) {
  var stream = this.createStream(link)
  return new Channel(stream, link)
}

function Channel (stream, link) {
  var self = this

  events.EventEmitter.call(this)

  this.left = false
  this.link = link
  this.stream = stream
  this.inflight = ids()

  this.remoteBlocks = bitfield(1024, {grow: MAX_BLOCKS})
  this.remoteChoking = true
  this.amChoking = true
  this.blocks = 0

  stream.on('data', parse)
  stream.on('error', onleave)
  stream.on('close', onleave)
  stream.on('end', onleave)

  function parse (data) {
    self.parse(data)
  }

  function onleave (err) {
    if (err) self.emit('warn', err)
    self.leave()
  }
}

util.inherits(Channel, events.EventEmitter)

Channel.prototype.leave = function (err) {
  if (this.left) return
  this.left = true
  if (err) this.emit('warn', err)
  for (var i = 0; i < this.inflight.length; i++) {
    var entry = this.inflight.remove(i)
    if (entry && entry.callback) entry.callback(new Error('Channel was destroyed'))
  }
  this.stream.end()
  this.emit('leave')
}

Channel.prototype.parse = function (data) {
  if (this.left) return

  var type = data[0]
  if (type >= ENCODERS.length) return

  try {
    var message = ENCODERS[type].decode(data, 1)
  } catch (err) {
    this.emit('warn', err)
    this.leave()
    return
  }

  switch (type) {
    case 0: return this._onrequest(message)
    case 1: return this._onresponse(message)
    case 2: return this._onhave(message)
    case 3: return this._onunchoke(message)
    case 4: return this._onchoke(message)
  }

  this.emit('warn', new Error('Unknown message type: ' + type))
}

Channel.prototype.request = function (block, hashes, cb) {
  if (this.left) return cb(new Error('Channel was destroyed'))
  var req = {
    id: 0,
    block: block,
    hashes: hashes,
    callback: cb
  }
  req.id = this.inflight.add(req)
  this._push(0, req)
}

Channel.prototype.response = function (req, block, hashes) {
  this._push(1, {
    id: req.id,
    block: block,
    hashes: hashes
  })
}

Channel.prototype.have = function (block) {
  this._push(2, {
    block: block
  })
}

Channel.prototype.unchoke = function (blocks, bitfield) {
  this.amChoking = false
  if (blocks) this.blocks = blocks
  this._push(3, {
    blocks: blocks,
    bitfield: bitfield && bitfield.buffer || bitfield
  })
}

Channel.prototype.choke = function () {
  this.amChoking = true
  this._push(4, null)
}

Channel.prototype._push = function (type, message) {
  if (!message) {
    this.stream.write(new Buffer([type]))
    return
  }
  var enc = ENCODERS[type]
  var buf = new Buffer(enc.encodingLength(message) + 1)
  buf[0] = type
  enc.encode(message, buf, 1)
  this.stream.write(buf)
}

Channel.prototype._onchoke = function () {
  this.remoteChoking = true
  this.emit('choke')
}

Channel.prototype._onunchoke = function (message) {
  if (message.bitfield) this.remoteBlocks = bitfield(message.bitfield, {grow: MAX_BLOCKS})
  if (message.blocks) this.blocks = message.blocks
  this.remoteChoking = false
  this.emit('unchoke')
}

Channel.prototype._onhave = function (message) {
  this.remoteBlocks.set(message.block)
  this.emit('have', message.block)
}

Channel.prototype._onrequest = function (message) {
  this.emit('request', message)
}

Channel.prototype._onresponse = function (message) {
  var req = this.inflight.remove(message.id)
  if (req && req.callback) req.callback(null, message, req)
}

if (require.main !== module) return

var p = Protocol(function (ch) {
  ch.on('warn', console.log)
  ch.on('unchoke', console.log)
  ch.on('request', function (req) {
    console.log('request', req)
    ch.response(req, new Buffer('hi'), [])
  })
})

var ch = p.join(new Buffer('lol'))

ch.unchoke()
ch.request(4, [], console.log)
ch.request(4, [], console.log)
ch.on('warn', console.log)
ch.leave()

p.pipe(p)
