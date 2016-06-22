var thunky = require('thunky')

module.exports = Cursor

function Cursor (archive, file, opts) {
  if (!(this instanceof Cursor)) return new Cursor(archive, file, opts)
  if (!opts) opts = {}

  var self = this

  this._nextOffset = 0
  this._block = 0

  this.archive = archive
  this.options = opts
  this.file = file
  this.entry = null
  this.position = 0
  this.start = opts.start || 0
  this.end = opts.end || 0
  this.opened = false
  this.open = thunky(open)

  this.open()

  function open (cb) {
    self._open(cb)
  }
}

Cursor.prototype.seekToStart = function (cb) {
  this.seek(0, cb)
}

Cursor.prototype.seekToEnd = function (cb) {
  this.seek(Infinity, cb)
}

Cursor.prototype.seek = function (offset, cb) {
  if (!cb) cb = noop
  if (!this.opened) return this._openAndSeek(offset, cb)
  this._seek(offset, cb)
}

Cursor.prototype.next = function (cb) {
  if (!cb) cb = noop
  if (!this.opened) return this._openAndNext(cb)
  this._next(cb)
}

Cursor.prototype._seek = function (offset, cb) {
  var self = this

  if (offset < this.start) offset = this.start

  if (offset >= this.end) {
    self.position = this.end
    return cb(null)
  }

  this.archive.content.seek(offset, function (err, block, rel) {
    if (err) return cb(err)

    self._block = block
    self._nextOffset = rel
    self.position = offset

    cb(null)
  })
}

Cursor.prototype._next = function (cb) {
  var self = this
  var block = this._block
  var pos = this.position

  if (self.position >= self.end) return cb(null, null)

  this.archive.content.get(block, function (err, data) {
    if (err) return cb(err)

    if (self._nextOffset) {
      data = data.slice(self._nextOffset)
      self._nextOffset = 0
    }

    if (pos + data.length > self.end) {
      data = data.slice(0, self.end - pos)
    }

    if (block === self._block) {
      self._block++
      self.position += data.length
    }

    cb(null, data)
  })
}

Cursor.prototype._open = function (cb) {
  var self = this
  this.archive.get(this.file, function (err, entry) {
    if (err) return cb(err)
    if (!entry.content) return cb(new Error('entry.content is required for byte cursors'))

    self.opened = true
    self.entry = entry

    var max = entry.content.bytesOffset + entry.length
    if (!self.end) self.end = entry.length
    self.start = Math.min(self.start + entry.content.bytesOffset, max)
    self.end = Math.min(self.end + entry.content.bytesOffset, max)
    self._block = entry.content.blockOffset

    if (self.start !== entry.content.bytesOffset) self.seek(self.start, cb)
    else cb(null)
  })
}

Cursor.prototype._openAndSeek = function (offset, cb) {
  var self = this
  this.open(function (err) {
    if (err) return cb(err)
    self._seek(offset, cb)
  })
}

Cursor.prototype._openAndNext = function (cb) {
  var self = this
  this.open(function (err) {
    if (err) return cb(err)
    self._next(cb)
  })
}

function noop () {}
