var thunky = require('thunky')

module.exports = Cursor

function Cursor (archive, name, opts) {
  if (!(this instanceof Cursor)) return new Cursor(archive, name, opts)

  var self = this

  this.name = name
  this.opened = false
  this.position = 0
  this.index = 0
  this.offset = 0
  this.open = thunky(open)

  this._content = null
  this._stat = null
  this._seekTo = 0
  this._seeking = true
  this._start = 0
  this._end = 0
  this._range = null
  this._download = !opts || opts.download !== false

  this.open()

  function open (cb) {
    archive.stat(name, function (err, st) {
      if (err) return cb(err)
      archive._ensureContent(function (err) {
        if (err) return cb(err)
        if (!st.isFile()) return cb(new Error('Not a file'))

        self._content = archive.content
        self._stat = st
        self._start = st.offset
        self._end = st.offset + st.blocks

        if (self._seekTo === 0 && self._download) {
          self._range = self._content.download({start: self._start, end: self._end, linear: true})
        }

        cb(null)
      })
    })
  }
}

Cursor.prototype.seek = function (pos) {
  if (pos === this.position && this._seekTo === -1) return this
  this._seeking = true
  this._seekTo = pos
  return this
}

Cursor.prototype._seek = function (bytes, cb) {
  var self = this

  this.open(function (err) {
    if (err) return cb(err)

    if (bytes < 0) bytes += self._stat.size
    if (bytes < 0) bytes = 0
    if (bytes > self._stat.size) bytes = self._stat.size

    var st = self._stat
    var opts = {start: self._start, end: self._end}

    if (bytes === 0) return onseek(null, self._start, 0)
    if (bytes === self._stat.size) return onseek(self._end, 0)

    self._content.seek(st.byteOffset + bytes, opts, onseek)
  })

  function onseek (err, index, offset) {
    if (err) return cb(err)
    cb(null, bytes, index, offset)
  }
}

Cursor.prototype.next = function (cb) {
  if (this._seeking) this._seekAndNext(cb)
  else this._next(this.position, this.index, this.offset, cb)
}

Cursor.prototype.close = function (cb) {
  if (!cb) cb = noop

  var self = this
  this.open(function (err) {
    if (err) return cb(err)
    if (self._range) self._content.undownload(self._range)
    cb()
  })
}

Cursor.prototype._next = function (pos, index, offset, cb) {
  if (index < this._start || index >= this._end) return cb(null, null)

  var self = this

  this._content.get(this.index, function (err, data) {
    if (err) return cb(err)

    if (offset) {
      data = data.slice(offset)
    }

    self.position = pos + data.length
    self.offset = 0
    self.index++

    cb(null, data)
  })
}

Cursor.prototype._seekAndNext = function (cb) {
  var self = this
  var seekTo = this._seekTo

  this._seek(seekTo, function (err, pos, index, offset) {
    if (err) return cb(err)

    if (seekTo === self._seekTo) {
      self._seeking = false
      self._seekTo = -1
      self.position = pos
      self.index = index
      self.offset = offset

      if (self._download) {
        if (self._range) self._content.undownload(self._range)
        self._range = self._content.download({start: self.index, end: self._end, linear: true})
      }
    }

    self._next(pos, index, offset, cb)
  })
}

function noop () {}
