module.exports = Storage

function Storage (archive) {
  if (!(this instanceof Storage)) return new Storage(archive)

  this.archive = archive
  this._opened = []
  this._maxStores = 64
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
  for (var i = 0; i < this._opened.length; i++) {
    var s = this._opened[i]
    if (s.start <= offset && offset < s.end) {
      if (i) this._active(s, i)
      return s
    }
  }

  return null
}

Storage.prototype._open = function (offset, length, buf, cb) {
  var i = 0
  var self = this
  var result = null
  var byteOffset = 0

  if (this._appendingName) {
    result = {
      start: offset,
      end: Infinity,
      storage: self.archive.options.file(this._appendingName, this.archive.options)
    }
    this._appendingName = null
    this._appending = result
    open(result, onopen)
    return
  }

  this.archive.get(i, loop)

  function loop (err, st) {
    if (err) return cb(err)

    var start = byteOffset
    var end = byteOffset + st.length

    byteOffset = end

    if (!(start <= offset && offset < end)) return self.archive.get(++i, loop)

    result = {
      start: start,
      end: end,
      storage: self.archive.options.file(st.name, self.archive.options)
    }

    open(result, onopen)
  }

  function onopen (err) {
    if (err) return cb(err)

    var clone = self._get(offset)
    if (clone) return close(result, onready)

    self._opened.unshift(result)
    self._kick(onready)
  }

  function onready (err) {
    if (err) return cb(err)

    if (buf) self.write(offset, buf, cb)
    else self.read(offset, length, cb)
  }
}

Storage.prototype._kick = function (cb) {
  if (this._opened.length <= this._maxStores) return cb(null)
  close(this._opened.pop(), cb)
}

Storage.prototype._active = function (s, i) {
  // TODO: move to linked list for true lru behaivor
  // move to front.
  this._opened[i] = this._opened[0]
  this._opened[0] = s
}

function noop () {}

function open (item, cb) {
  if (item.storage.open) item.storage.open(cb)
  else cb(null)
}

function close (item, cb) {
  if (item.storage.close) item.storage.close(cb)
  else cb(null)
}
