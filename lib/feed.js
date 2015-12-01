var bitfield = require('bitfield')
var thunky = require('thunky')
var prefix = require('sublevel-prefixer')()
var low = require('last-one-wins')
var messages = require('./messages')

module.exports = Feed

function Feed (link, drive, opts) {
  if (!(this instanceof Feed)) return new Feed(link, drive, opts)
  if (!opts) opts = {}

  var self = this

  this.id = link
  this.blocks = opts.blocks || 0
  this.index = opts.index || []

  this.pointer = null
  this.bitfield = null
  this.drive = drive

  this._decode = !!opts.decode
  this._ptr = null
  this._channel = this.drive.swarm.join(link) // TODO: only join if not fully downloaded (on open)
  this._sync = low(function (buf, cb) {
    self.drive._bitfields.put(link.toString('hex'), buf, cb)
  })

  this.open = thunky(function (cb) {
    self.drive._links.get(link.toString('hex'), function (_, info) {
      self.drive._bitfields.get(link.toString('hex'), function (_, bits) {
        if (info) {
          self.blocks = info.blocks
          self.pointer = info.pointer || link
          self.index = info.index
        } else {
          self.pointer = link
        }
        self.bitfield = bitfield(bits || 1024)
        self._ptr = prefix(self.pointer.toString('hex'), '')
        cb(self)
      })
    })
  })

  this.open()
}

Feed.prototype.get = function (index, cb) {
  if (this._decode) cb = decoder(cb)

  this.open(function (self) {
    if (self.blocks && index >= self.blocks) return cb(null, null)
    if (self.bitfield.get(index)) return self._block(index, cb)

    self._channel.want.push({block: index, cb: cb})
    self._channel.fetch(index)
  })
}

Feed.prototype._block = function (index, cb) {
  var self = this
  this.drive._hashes.get(this._ptr + index, function (err, hash) {
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
