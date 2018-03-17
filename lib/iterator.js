const thunky = require('thunky')

module.exports = Iterator

// TODO: use nanoiterator instead
function Iterator (archive, path, opts) {
  if (!(this instanceof Iterator)) return new Iterator(archive, path, opts)

  const self = this

  this.path = path
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
    archive.stat(path, function (err, st) {
      if (err) return cb(err)
      if (!st.isFile()) return cb(new Error('Not a file'))

      self._content = archive.db.contentFeeds[st.feed]
      self._stat = st
      self._start = st.offset
      self._end = st.offset + st.blocks

      if (self._seekTo === 0 && self._download) {
        self._range = self._content.download({start: self._start, end: self._end, linear: true})
      }

      cb(null)
    })
  }
}

Iterator.prototype.seek = function (pos) {
  if (pos === this.position && this._seekTo === -1) return this
  this._seeking = true
  this._seekTo = pos
  return this
}

Iterator.prototype._seek = function (bytes, cb) {
  const self = this

  this.open(function (err) {
    if (err) return cb(err)

    if (bytes < 0) bytes += self._stat.size
    if (bytes < 0) bytes = 0
    if (bytes > self._stat.size) bytes = self._stat.size

    const st = self._stat
    const opts = {start: self._start, end: self._end}

    if (bytes === 0) return onseek(null, self._start, 0)
    if (bytes === self._stat.size) return onseek(self._end, 0)

    self._content.seek(st.byteOffset + bytes, opts, onseek)
  })

  function onseek (err, index, offset) {
    if (err) return cb(err)
    cb(null, bytes, index, offset)
  }
}

Iterator.prototype.next = function (cb) {
  if (this._seeking) this._seekAndNext(cb)
  else this._next(this.position, this.index, this.offset, cb)
}

Iterator.prototype.close = function (cb) {
  if (!cb) cb = noop

  const self = this
  this.open(function (err) {
    if (err) return cb(err)
    if (self._range) self._content.undownload(self._range)
    cb()
  })
}

Iterator.prototype._next = function (pos, index, offset, cb) {
  if (index < this._start || index >= this._end) return cb(null, null)

  const self = this

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

Iterator.prototype._seekAndNext = function (cb) {
  const self = this
  const seekTo = this._seekTo

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
