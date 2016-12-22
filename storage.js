var fns = require('sorted-array-functions')

module.exports = Storage

function Storage (archive) {
  if (!(this instanceof Storage)) return new Storage(archive)

  this.archive = archive
  this._opened = []
  this._maxStores = 128 // TODO: be more fancy here - try and upgrade based on EACESS etc
  this._appending = null
  this._appendingName = null
  this._readonly = false
}

Storage.prototype.openAppend = function (name, readonly) {
  this._readonly = !!readonly
  this._appendingName = name
}

Storage.prototype.closeAppend = function (cb) {
  if (!cb) cb = noop

  this._appendingName = null
  this._readonly = false

  if (!this._appending) return cb(null)

  var s = this._appending
  this._appending = null

  var i = this._opened.indexOf(s)
  if (i > -1) this._opened.splice(i, 1)
  close(s, cb)
}

Storage.prototype.read = function (offset, length, cb) {
  var s = this._get(offset)
  if (!s) return this._open(offset, length, null, cb)
  s.storage.read(offset - s.start, length, cb)
}

Storage.prototype.write = function (offset, buf, cb) {
  var s = this._get(offset)
  if (!s) return this._open(offset, 0, buf, cb)
  if (this._readonly && s === this._appending) return cb(null)
  s.storage.write(offset - s.start, buf, cb)
}

Storage.prototype.end = function (offset, options, cb) {
  var s = this._get(offset)
  if (!s) {
    var self = this
    return this._open(offset, 0, null, function (err) {
      if (err) return cb(err)
      self.end(offset, options, cb)
    })
  }
  if (this._readonly && s === this._appending) return cb(null)
  if (s.storage.end) return s.storage.end(options, cb)
  cb()
}

Storage.prototype._get = function (offset) {
  var i = fns.lte(this._opened, {start: offset}, cmp)
  if (i === -1) return null
  var file = this._opened[i]
  return offset < file.end ? file : null
}

Storage.prototype._open = function (offset, length, buf, cb) {
  if (!this._appendingName) return bisect(this, offset, length, buf, cb)

  var result = {
    start: offset,
    end: Infinity,
    storage: this.archive.options.file(this._appendingName, this.archive.options)
  }
  this._appendingName = null
  this._appending = result
  this._opened.push(result)
  if (buf) this.write(offset, buf, cb)
  else this.read(offset, length, cb)
}

Storage.prototype._kick = function (cb) {
  // TODO: use actual LRU cache here
  var self = this

  loop(null)

  function loop (err) {
    if (err) return cb(err)
    if (self._opened.length < self._maxStores) return cb(null)

    var oldest = Math.floor(Math.random() * self._opened.length)
    var removed = self._opened[oldest]
    self._opened.splice(oldest, 1)
    close(removed, loop)
  }
}

function noop () {}

function close (item, cb) {
  if (item.storage.close) item.storage.close(cb)
  else cb(null)
}

function bisect (self, offset, length, buffer, cb) {
  var btm = 0
  var top = self.archive.metadata.blocks ? self.archive.metadata.blocks - 1 : 0
  var mid = Math.floor((btm + top) / 2)

  loop(null, null)

  function done (start, end, data) {
    self._kick(function (err) {
      if (err) return cb(err)

      var result = {
        start: start,
        end: end,
        storage: self.archive.options.file(data.name, self.archive.options)
      }

      fns.add(self._opened, result, cmp)
      if (buffer) self.write(offset, buffer, cb)
      else self.read(offset, length, cb)
    })
  }

  function loop (err, data) {
    if (err) return cb(err)
    if (!data) return self.archive.get(mid, loop)

    if (!data.content) { // index message (TODO: just add .content to this)
      if (mid === 0) btm++
      else top--
      mid = Math.floor((btm + top) / 2)
      return self.archive.get(mid, loop)
    }

    var start = data.content.bytesOffset
    var end = data.content.bytesOffset + data.length

    if (start <= offset && offset < end) {
      if (data.type !== 'file') {
        mid++
        return self.archive.get(mid, loop)
      }

      return done(start, end, data)
    }

    if (btm === top) return bisect(self, offset, length, buffer, cb) // retry

    if (offset < start) {
      top = mid - 1
    } else {
      btm = mid + 1
    }

    mid = Math.floor((btm + top) / 2)
    self.archive.get(mid, loop)
  }
}

function cmp (a, b) {
  return a.start - b.start
}
