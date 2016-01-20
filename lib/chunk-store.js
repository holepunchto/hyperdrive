var fs = require('fs')
var low = require('last-one-wins')
var thunky = require('thunky')
var open = require('random-access-open')

var SIZE = 8192 // power of 2 always
var MASK = SIZE - 1

module.exports = ChunkStore

// creates a chunk store that works with variable sized chunks
function ChunkStore (filename, link, db) {
  if (!(this instanceof ChunkStore)) return new ChunkStore(filename, link, db)
  var self = this

  this.fd = 0
  this.db = db
  this.filename = filename
  this.link = link
  this.contentBlocks = link.blocks - link.index.length

  this._index = new Array(link.index.length)
  this._offsets = new Array(this._index.length)
  this._batch = []
  this._writeOffsets = []

  var acc = 0
  for (var i = 0; i < link.index.length; i++) {
    this._index[i] = acc += link.index[i]
  }

  this.open = thunky(function (cb) {
    open(filename, function (err, fd) {
      if (err) return cb(err)
      self.fd = fd
      cb()
    })
  })

  this._flush = low(flush)
  this.open()

  function flush (_, cb) {
    var batch = self._batch
    self._batch = []
    while (self._writeOffsets.length) {
      var index = self._writeOffsets.pop()
      batch.push({
        type: 'put',
        key: 'inflated!' + index,
        value: self._offsets[index]
      })
    }
    self.db.batch(batch, cb)
  }
}

ChunkStore.prototype.close = function (cb) {
  if (!cb) cb = noop
  var self = this
  this.open(function (err) {
    if (err) return cb(err)
    fs.close(self.fd, cb)
  })
}

ChunkStore.prototype.get = function (index, cb) {
  if (!cb) cb = noop

  if (index >= this.contentBlocks) {
    this.db.get('blocks!' + index, {valueEncoding: 'binary'}, cb)
    return
  }

  var rel = index & MASK
  var i = (index - rel) / SIZE

  if (!this.fd || !this._offsets[i]) this._openAndGet(i, rel, cb)
  else this._get(i, rel, cb)
}

ChunkStore.prototype._get = function (i, rel, cb) {
  var offsets = this._offsets[i]
  var absPrev = i ? this._index[i - 1] : 0
  var relPrev = rel ? offsets.readUInt32BE(rel * 4 - 4) : 0
  var val = offsets.readUInt32BE(rel * 4)

  if (!val || (rel && !relPrev)) return cb(new Error('Could not calculate offset and length'))

  var offset = absPrev + relPrev
  var buf = Buffer(val - relPrev)
  var ptr = 0
  var self = this

  read()

  function read (err, bytes) {
    if (err) return cb(err)
    ptr += bytes
    if (ptr === buf.length) return cb(null, buf)
    fs.read(self.fd, buf, ptr, buf.length - ptr, offset + ptr, read)
  }
}

ChunkStore.prototype._openAndGet = function (i, rel, cb) {
  var self = this
  this._load(i, function (err) {
    if (err) return cb(err)
    self._get(i, rel, cb)
  })
}

ChunkStore.prototype.put = function (index, buf, cb) {
  if (!cb) cb = noop

  if (index >= this.contentBlocks) {
    var inflated = inflate(buf)
    this._offsets[index - this.contentBlocks] = inflated
    this.db.batch([{
      type: 'put',
      key: 'blocks!' + index,
      value: buf
    }, {
      type: 'put',
      key: 'inflated!' + (index - this.contentBlocks),
      value: inflated
    }], cb)
    return
  }

  var rel = index & MASK
  var i = (index - rel) / SIZE
  if (!this.fd || !this._offsets[i]) this._openAndPut(i, rel, buf, cb)
  else this._put(i, rel, buf, cb)
}

ChunkStore.prototype._put = function (i, rel, buf, cb) {
  var offsets = this._offsets[i]
  var absPrev = i ? this._index[i - 1] : 0
  var relPrev = rel ? offsets.readUInt32BE(rel * 4 - 4) : 0
  var backtracking = 0

  if (rel && !relPrev) {
    if (rel === offsets.length / 4 - 1) offsets.writeUInt32BE(this._index[i], offsets.length - 4)
    backtracking = offsets.readUInt32BE(4 * rel)
    if (!backtracking) return cb(new Error('Could not calculate offset'))
    relPrev = backtracking - buf.length
    offsets.writeUInt32BE(relPrev, 4 * rel - 4)
  }

  var offset = absPrev + relPrev

  if (backtracking || !offsets.readUInt32BE(rel * 4)) {
    offsets.writeUInt32BE(relPrev + buf.length, rel * 4)
    if (this._writeOffsets.indexOf(i) === -1) this._writeOffsets.push(i)
    this._flushAndWrite(offset, buf, cb)
  } else {
    this._write(offset, buf, cb)
  }
}

ChunkStore.prototype._write = function (offset, buf, cb) {
  var rel = 0
  var self = this
  write(null, 0)

  function write (err, bytes) {
    if (err) return cb(err)
    rel += bytes
    if (rel === buf.length) return cb(null)
    fs.write(self.fd, buf, rel, buf.length - rel, offset + rel, write)
  }
}

ChunkStore.prototype._flushAndWrite = function (offset, buf, cb) {
  var self = this
  this._flush(null, function (err) {
    if (err) return cb(err)
    self._write(offset, buf, cb)
  })
}

ChunkStore.prototype._openAndPut = function (i, rel, buf, cb) {
  var self = this
  this._load(i, function (err) {
    if (err) return cb(err)
    self._put(i, rel, buf, cb)
  })
}

ChunkStore.prototype._load = function (i, cb) {
  var self = this
  this.open(function (err) {
    if (err) return cb(err)
    self.db.get('inflated!' + i, {valueEncoding: 'binary'}, function (_, buf) {
      var len = (i === self._offsets.length - 1 ? (self.contentBlocks & MASK) || SIZE : SIZE) * 4
      if (!self._offsets[i]) self._offsets[i] = buf || blank(len)
      cb(null)
    })
  })
}

function noop () {}

function inflate (buf) {
  var dest = Buffer(buf.length * 2)
  var acc = 0
  for (var i = 0; i < buf.length; i += 2) dest.writeUInt32BE(acc += buf.readUInt16BE(i), 2 * i)
  return dest
}

function blank (n) {
  var b = Buffer(n)
  b.fill(0)
  return b
}
