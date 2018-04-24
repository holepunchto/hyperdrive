const inherits = require('inherits')
const Entry = require('hyperdb/lib/messages').Entry
const Stat = require('./messages').Stat
const ras = require('random-access-storage')
const raf = require('random-access-file')
const fs = require('fs')
const path = require('path')

module.exports = ContentStorage

function ContentStorage (dir, opts) {
  if (!(this instanceof ContentStorage)) return new ContentStorage(dir, opts)
  ras.call(this)

  this.metadata = opts.metadata
  this.content = opts.feed
  this.directory = dir
  this.files = []
}

inherits(ContentStorage, ras)

ContentStorage.prototype.onappend = function (filename) {
  this.files.push({
    start: this.content.byteLength,
    end: Infinity,
    storage: raf(filename, {truncate: true, directory: this.directory})
  })
}

ContentStorage.prototype.onunlink = function (filename, cb) {
  fs.unlink(path.join(this.directory, filename), function () {
    cb()
  })
}

ContentStorage.prototype._read = function (req) {
  this._find(req.offset, function (err, file) {
    if (err) return req.callback(err)
    const offset = req.offset - file.start
    file.storage.read(offset, req.size, req.callback.bind(req))
  })
}

ContentStorage.prototype._write = function (req) {
  this._find(req.offset, function (err, file) {
    if (err) return req.callback(err)
    const offset = req.offset - file.start
    file.storage.write(offset, req.data, req.callback.bind(req))
  })
}

ContentStorage.prototype._find = function (offset, cb) {
  for (var i = 0; i < this.files.length; i++) {
    var file = this.files[i]
    if (file.start <= offset && offset < file.end) {
      return cb(null, file)
    }
  }

  this._findInFeed(offset, cb)
}

ContentStorage.prototype._findInFeed = function (offset, cb) {
  const self = this

  find(this.metadata, offset, function (err, entry, st, index) {
    if (err) return cb(err)
    if (!st) return cb(new Error('Could not find file'))

    const file = {
      start: st.byteOffset,
      end: st.size + st.byteOffset,
      storage: raf(entry.key, {directory: self.directory})
    }

    self.files.push(file)
    cb(null, file)
  })
}

function find (metadata, bytes, cb) {
  var top = metadata.length - 1
  var btm = 1
  var mid = Math.floor((top + btm) / 2)

  get(metadata, btm, mid, function loop (err, actual, entry, st) {
    if (err) return cb(err)

    var oldMid = mid

    if (!entry) {
      btm = mid
      mid = Math.floor((top + btm) / 2)
    } else {
      var start = st.byteOffset
      var end = st.byteOffset + st.size

      if (start <= bytes && bytes < end) return cb(null, entry, st, actual)
      if (top <= btm) return cb(null, null, null, -1)

      if (bytes < start) {
        top = mid
        mid = Math.floor((top + btm) / 2)
      } else {
        btm = mid
        mid = Math.floor((top + btm) / 2)
      }
    }

    if (mid === oldMid) {
      if (btm < top) mid++
      else return cb(null, null, null, -1)
    }

    get(metadata, btm, mid, loop)
  })
}

function get (metadata, btm, seq, cb) {
  if (seq < btm) return cb(null, -1, null)

  // TODO: this can be done a lot faster using the hypercore internal iterators, expose!
  var i = seq
  while (!metadata.has(i) && i > btm) i--
  if (!metadata.has(i)) return cb(null, -1, null)

  metadata.get(i, {valueEncoding: Entry}, function (err, entry) {
    if (err) return cb(err)

    var st = entry.value && Stat.decode(entry.value)

    if (!entry.value || (!st.offset && !st.blocks) || (!st.byteOffset && !st.blocks)) {
      return get(metadata, btm, i - 1, cb) // TODO: check the index instead for fast lookup
    }

    cb(null, i, entry, st)
  })
}
