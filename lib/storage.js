var fs = require('fs')
var mkdirp = require('mkdirp')
var path = require('path')
var low = require('last-one-wins')
var thunky = require('thunky')
var open = require('random-access-open')
var messages = require('./messages')

var SIZE = 8192 // power of 2 always
var MASK = SIZE - 1

module.exports = ChunkStore

// creates a chunk store that works with variable sized chunks
function ChunkStore (drive, feed) {
  if (!(this instanceof ChunkStore)) return new ChunkStore(drive, feed)

  var self = this

  this.fd = 0
  this.drive = drive
  this._prefix = '!' + (feed.pointer || feed.id).toString('hex') + '!'
  this.db = drive.drives
  this.filename = null
  this.contentBlocks = 0

  this._finalized = false
  this._feed = feed
  this._index = []
  this._offsets = []
  this._indexes = []
  this._batch = []
  this._writeOffsets = []
  this._nextIndex = null
  this._nextOffset = 0
  this._nextPtr = 0

  this.opened = false
  this.open = thunky(function (cb) {
    upget(function (err, doc) {
      if (err) return cb(err)

      self.filename = doc.filename
      self._index = doc.index
      self.contentBlocks = doc.contentBlocks || 0

      if (!self.filename) {
        self.opened = true
        return cb()
      }

      mkdirp(path.dirname(self.filename), function (err) {
        if (err) return cb(err)
        open(self.filename, function (err, fd) {
          if (err) return cb(err)
          self.fd = fd
          self.opened = true
          cb()
        })
      })
    })
  })

  function upget (cb) {
    self.db.get(self._prefix + 'info', {valueEncoding: messages.Info}, function (_, doc) {
      if (doc) return cb(null, doc)
      doc = {
        filename: feed.options.filename,
        index: feed.options.index || [],
        contentBlocks: feed.options.contentBlocks || 0
      }
      self.db.put(self._prefix + 'info', doc, {valueEncoding: messages.Info}, function (err) {
        if (err) return cb(err)
        cb(null, doc)
      })
    })
  }

  this._flush = low(flush)
  this.open()

  function flush (_, cb) {
    var batch = self._batch
    self._batch = []
    while (self._writeOffsets.length) {
      var index = self._writeOffsets.pop()
      batch.push({
        type: 'put',
        key: self._prefix + '!offsets!' + index,
        value: self._offsets[index]
      })
    }
    self.db.batch(batch, cb)
  }
}

ChunkStore.prototype.append = function (bufs, cb) {
  if (!cb) cb = noop
  if (!this.opened) return this._openAndAppend(bufs, cb)
  if (!Array.isArray(bufs)) this._append([bufs]. cb)
  else this._append(bufs, cb)
}

ChunkStore.prototype._append = function (bufs, cb) {
  var i = 0
  var self = this

  if (!this.filename) {
    var batch = new Array(bufs.length)
    for (; i < bufs.length; i++) {
      batch[i] = {
        type: 'put',
        key: this._prefix + '!blocks!' + (this.contentBlocks++),
        value: bufs[i]
      }
    }

    this.db.batch(batch, cb)
    return
  }

  if (this._finalized) {
    return loop()
  }

  for (; i < bufs.length; i++) {
    if (!this._nextIndex || this._nextPtr === this._nextIndex.length) {
      if (this._nextIndex) {
        this._index.push(this._nextOffset)
        this._indexes.push(this._nextIndex)
      }
      this._nextIndex = new Buffer(16384)
      this._nextPtr = 0
    }
    var buf = bufs[i]
    this.contentBlocks++
    this._nextOffset += buf.length
    this._nextIndex.writeUInt16BE(buf.length, this._nextPtr)
    this._nextPtr += 2
  }

  cb()

  function loop (err) {
    if (err) return cb(err)
    if (i === bufs.length) return cb()
    self.put(self.contentBlocks + i, bufs[i++], loop)
  }
}

ChunkStore.prototype.finalize = function (cb) {
  if (!this.filename) return cb()

  if (this._nextPtr) {
    this._indexes.push(this._nextIndex.slice(0, this._nextPtr))
    this._index.push(this._nextOffset)
  }
  var self = this
  var doc = {filename: this.filename, index: this._index, contentBlocks: this.contentBlocks}
  this.db.put(this._prefix + 'info', doc, {valueEncoding: messages.Info}, function (err) {
    if (err) return cb(err)
    self._finalized = true
    self._feed.append(self._indexes, cb)
  })
}

ChunkStore.prototype.close = function (cb) {
  if (!cb) cb = noop
  var self = this
  this.open(function (err) {
    if (err) return cb(err)
    if (!self.fd) return cb(null)
    fs.close(self.fd, cb)
  })
}

ChunkStore.prototype.get = function (index, cb) {
  if (!cb) cb = noop
  if (!this.opened) return this.open(this.get.bind(this, index, cb))

  if (!this.filename || index >= this.contentBlocks) {
    this.db.get(this._prefix + '!blocks!' + index, cb)
    return
  }

  var rel = index & MASK
  var i = (index - rel) / SIZE

  if (!this._offsets[i]) return this._openAndGet(i, rel, cb)
  this._get(i, rel, cb)
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

  fs.read(this.fd, buf, 0, buf.length, offset, read)

  function read (err, bytes) {
    if (err) return cb(err)
    ptr += bytes
    if (ptr === buf.length) return cb(null, buf)
    fs.read(self.fd, buf, ptr, buf.length - ptr, offset + ptr, read)
  }
}

ChunkStore.prototype._openAndAppend = function (bufs, cb) {
  var self = this
  this.open(function (err) {
    if (err) return cb(err)
    self.append(bufs, cb)
  })
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
  if (!this.opened) return this.open(this.put.bind(this, index, buf, cb))

  if (!this.filename) {
    this.db.put(this._prefix + '!blocks!' + index, buf, cb)
    return
  }

  if (index >= this.contentBlocks) {
    var inflated = inflate(buf)
    this._offsets[index - this.contentBlocks] = inflated
    this.db.batch([{
      type: 'put',
      key: this._prefix + '!blocks!' + index,
      value: buf
    }, {
      type: 'put',
      key: this._prefix + '!offsets!' + (index - this.contentBlocks),
      value: inflated
    }], cb)
    return
  }

  var rel = index & MASK
  var i = (index - rel) / SIZE
  if (!this.opened || !this._offsets[i]) this._openAndPut(i, rel, buf, cb)
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

  fs.write(this.fd, buf, 0, buf.length, offset, write)

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
    self.db.get(self._prefix + '!offsets!' + i, function (_, buf) {
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
