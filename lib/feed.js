var bitfield = require('bitfield')
var thunky = require('thunky')
var prefix = require('sublevel-prefixer')()
var low = require('last-one-wins')
var messages = require('./messages')

var BLOCKS_PER_DIRECTORY = 8192

module.exports = Feed

function Feed (link, drive, opts) {
  if (!(this instanceof Feed)) return new Feed(link, drive, opts)
  if (!opts) opts = {}

  var self = this

  this.id = link
  this.blocks = opts.blocks || 0
  this.index = opts.index || null

  this.bitfield = null
  this.drive = drive

  this._blocks = opts.blocks
  this._decode = !!opts.decode
  this._ptr = null
  this._channel = this.drive.swarm.join(link) // TODO: only join if not fully downloaded (on open)

  this.open = thunky(function (cb) {
    self._channel.ready(function () {
      cb(self)
    })
  })
  this.open()
}

Feed.prototype.cursor = function () {
  return new Cursor(this)
}

Feed.prototype.get = function (index, cb) {
  if (this._decode) cb = decoder(cb)

  this.open(function (self) {
    if (self._channel.blocks && index >= self._channel.blocks) return cb(null, null)
    if (self._channel.bitfield.get(index)) return self._block(index, cb)

    self._channel.want.push({block: index, cb: cb})
    self._channel.fetch(index)
  })
}

Feed.prototype._block = function (index, cb) {
  var self = this
  this.drive._hashes.get(this._channel.prefix + (2 * index), function (err, hash) {
    if (err) return cb(err)
    self.drive._blocks.get(hash.toString('hex'), cb)
  })
}

function decoder (cb) {
  return function (err, value) {
    if (err) return cb(err)
    var entry = messages.Entry.decode(value)
    // TODO: move to module
    if (entry.type === 'file') entry.value = messages.File.decode(entry.value)
    cb(null, entry)
  }
}

function Cursor (feed) {
  this.position = {bytes: 0, block: 0, offset: 0}
  this._feed = feed
  this._indexSize = 0
  this._end = 0

  if (this._feed._channel.blocks || this._feed._blocks) this._onblocks()
}

Cursor.prototype._onblocks = function () {
  var blocks = this._feed._channel.blocks || this._feed._blocks
  this._indexSize = this._feed.index ? this._feed.index.length : Math.ceil(blocks / BLOCKS_PER_DIRECTORY)
  this._end = blocks - this._indexSize
}

Cursor.prototype.read = function (offset, cb) {
  if (this.position.bytes === offset) this.next(cb)
  else this.seekAndRead(offset, cb)
}

Cursor.prototype.seekAndRead = function (offset, cb) {
  var self = this
  this.seek(offset, function (err) {
    if (err) return cb(err)
    self.next(cb)
  })
}

Cursor.prototype.next = function (cb) {
  var inited = this._feed._channel.blocks || this._feed._blocks
  if (!inited) return this.seekAndRead(offset, cb)

  var self = this
  var block = this.position.block
  var bytes = this.position.bytes
  var offset = this.position.offset

  if (block >= this._end) return cb(null, null)

  this._block(block, function (err, blk) {
    if (err) return cb(err)
    if (!blk) return cb(null, null)
    if (offset) blk = blk.slice(offset)
    self.position.block++
    self.position.offset = 0
    self.position.bytes = bytes + blk.length
    cb(null, blk)
  })
}

Cursor.prototype.seek = function (offset, cb) {
  if (!this._feed.index) return this._init(offset, cb)

  // TODO: do binary search through the indexes instead ...
  var pos = this.position
  var bytes = offset

  for (var i = 0; i < this._feed.index.length; i++) {
    if (offset < this._feed.index[i]) break
    offset -= this._feed.index[i]
  }

  this._block(this._end + i, function (err, dir) {
    if (err) return cb(err)
    if (!dir) return cb(new Error('Missing block directory'))

    var len = 0
    for (var j = 0; j < BLOCKS_PER_DIRECTORY; j++) {
      len = dir.readUInt16BE(2 * j)
      if (offset < len) break
      offset -= len
    }

    pos.block = i * BLOCKS_PER_DIRECTORY + j
    pos.bytes = bytes - offset
    pos.offset = offset

    cb()
  })
}

Cursor.prototype._init = function (offset, cb) {
  var self = this
  var index = []

  if (this._feed._channel.blocks) loop(0)
  this._feed.get(0, retry)

  function retry (err) {
    if (err) return cb(err)
    self._onblocks() // first block will populate .blocks
    self._init(offset, cb)
  }

  function loop (i) {
    if (i === self._indexSize) {
      self._feed.index = index
      self.seek(offset, cb)
      return
    }

    self._block(self._end + i, function (err, buf) {
      if (err) return cb(err)
      var size = 0
      for (var j = 0; j < buf.length; j += 2) size += buf.readUInt16BE(j)
      index.push(size)
      loop(i + 1)
    })
  }
}

Cursor.prototype._block = function (index, cb) {
  var blocks = this._feed._channel.blocks || this._feed._blocks
  if (index >= blocks) return cb(null, null)
  this._feed.get(index, cb)
}
