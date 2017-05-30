var thunky = require('thunky')

module.exports = Cursor

function Cursor (archive, name) {
  if (!(this instanceof Cursor)) return new Cursor(archive, name)

  var self = this

  this.archive = archive
  this.name = name
  this.opened = false
  this.position = 0
  this.index = 0
  this.offset = 0
  this.open = thunky(open)

  this._stat = null
  this._seekTo = 0
  this._start = 0
  this._end = 0

  this.open()

  function open (cb) {
    archive._ensureContent(function (err) {
      if (err) return cb(err)
      archive.tree.get(name, function (err, st) {
        if (err) return cb(err)

        self._stat = st
        self._start = st.offset
        self._end = st.offset + st.blocks

        cb(null)
      })
    })
  }
}

Cursor.prototype.seek = function (pos) {
  this._seekTo = pos
  return this
}

Cursor.prototype._seek = function (cb) {
  var self = this
  var bytes = this._seekTo

  if (bytes === -1) return cb(null)

  this.open(function (err) {
    if (err) return cb(err)

    if (self._seekTo !== bytes) return this._seek(cb)

    if (bytes < 0) self._seekTo = bytes = 0
    if (bytes > self._stat.size) self._seekTo = bytes = self._stat.size

    var st = self._stat
    var opts = {start: self._start, end: self._end}

    if (bytes === 0) return onseek(null, self._start, 0)
    if (bytes === self._stat.size) return onseek(self._end, 0)

    self.archive.content.seek(st.byteOffset + bytes, opts, onseek)
  })

  function onseek (err, index, offset) {
    if (err) return cb(err)

    if (self._seekTo === bytes) {
      self._seekTo = -1
      self.position = bytes
      self.index = index
      self.offset = offset
    }

    cb(null)
  }
}

Cursor.prototype.next = function (cb) {
  if (this._seekTo > -1) return this._seekAndNext(cb)

  var self = this
  var offset = self.offset
  var pos = self.position

  if (self.index >= self._end || self.index < self._start) return cb(null, null)

  self.archive.content.get(self.index, function (err, data) {
    if (err) return cb(err)

    if (offset) {
      data = data.slice(offset)
    }

    if (pos === self.position) {
      self.offset = 0
      self.position += data.length
      self.index++
    }

    cb(null, data)
  })
}

Cursor.prototype.prev = function (cb) {
  this.open(function (err) {
    if (err) return cb(err)
    console.log('prev')
  })
}

Cursor.prototype._seekAndNext = function (cb) {
  var self = this

  this._seek(function (err) {
    if (err) return cb(err)
    self.next(cb)
  })
}
