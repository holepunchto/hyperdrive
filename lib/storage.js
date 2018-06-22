const inherits = require('inherits')
const sorted = require('sorted-array-functions')
const raf = require('random-access-file')
const ras = require('random-access-storage')
const Entry = require('hyperdb/lib/messages').Entry
const Stat = require('./messages').Stat
const fs = require('fs')
const path = require('path')

module.exports = Storage

function Storage (dir, opts) {
  if (!(this instanceof Storage)) return new Storage(dir, opts)
  ras.call(this)

  this.cache = []
  this.metadata = opts.metadata
  this.content = opts.feed
  this.directory = dir
}

inherits(Storage, ras)

Storage.prototype.onunlink = function (filename, cb) {
  filename = path.join('/', filename)
  fs.unlink(path.join(this.directory, filename), function () {
    cb(null)
  })
}

Storage.prototype.onappend = function (filename, st, cb) {
  if (this.cache.length) {
    const top = this.cache[this.cache.length - 1]
    if (top.size === Infinity) top.size = this.content.byteLength - top.byteOffset
  }

  const self = this

  this._limitCache(function retry (err) {
    if (err) return cb(err)
    if (self.cache.length >= 128) return self._limitCache(retry)

    self.cache.push({
      byteOffset: self.content.byteLength,
      size: Infinity,
      storage: raf(filename, {truncate: true, directory: self.directory})
    })

    cb(null)
  })
}

Storage.prototype._limitCache = function (cb) {
  if (this.cache.length < 128) return cb(null)

  while (true) {
    const i = Math.floor(Math.random() * this.cache.length)
    const close = this.cache[i]
    if (close.size === Infinity) continue

    this.cache.splice(i, 1)
    if (this.cache.length >= 128) {
      close.storage.close()
      continue
    }

    close.storage.close(cb)
    return
  }
}

Storage.prototype._open = function (req) {
  var missing = 2
  var error = null

  this.content.ready(done)
  this.metadata.ready(done)

  function done (err) {
    if (err) error = err
    if (!--missing) req.callback(error)
  }
}

Storage.prototype._write =
Storage.prototype._read = function (req) {
  this._switch(req, null)
}

Storage.prototype._switchAsync = function (req) {
  const self = this
  const target = {byteOffset: req.offset}

  bisect(this.metadata, target, function (err, entry, val) {
    if (err) return req.callback(err)
    if (!val) return req.callback(new Error('Offset not found'))
    if (find(self.cache, target)) return self._switch(req)

    self._limitCache(function retry (err) {
      if (err) return req.callback(err)
      if (self.cache.length >= 128) return self._limitCache(retry)

      const file = {
        byteOffset: val.byteOffset,
        size: val.size,
        storage: raf(entry.key, {directory: self.directory})
      }

      sorted.add(self.cache, file, compare)
      self._switch(req, file)
    })
  })
}

Storage.prototype._switch = function (req, found) {
  if (!found) found = find(this.cache, {byteOffset: req.offset})
  if (!found) return this._switchAsync(req)

  const offset = req.offset - found.byteOffset
  const cb = req.callback.bind(req)

  switch (req.type) {
    case 1:
      found.storage.read(offset, req.size, cb)
      break

    case 2:
      found.storage.write(offset, req.data, cb)
      break
  }
}

function find (cache, target) {
  const index = sorted.lte(cache, target, compare)
  const found = index > -1 ? cache[index] : null
  return (found && compare(found, target) === 0) ? found : null
}

function bisect (feed, search, cb) {
  var top = feed.length
  var btm = 1
  var mid = midpoint(btm, top)

  feed.get(mid, {valueEncoding: Entry}, loop)

  function loop (err, entry) {
    if (err) return cb(err)

    const val = Stat.decode(entry.value)
    const cmp = compare(val, search)

    if (!cmp) return cb(null, entry, val)
    if (top - btm <= 1) return cb(null, entry, null)

    if (cmp > 0) top = mid
    else btm = mid

    mid = midpoint(btm, top, feed)
    if (mid === -1) return cb(null, null, null)

    feed.get(mid, {valueEncoding: Entry}, loop)
  }
}

function compare (a, b) {
  const end = a.byteOffset + a.size
  if (b.byteOffset >= a.byteOffset && b.byteOffset < end) return 0
  return end <= b.byteOffset ? -1 : 1
}

function midpoint (a, b, feed) {
  // TODO: use the bitfield to only search the downloaded data
  return Math.floor((a + b) / 2)
}
