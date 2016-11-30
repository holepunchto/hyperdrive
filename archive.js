var inherits = require('inherits')
var events = require('events')
var thunky = require('thunky')
var bulk = require('bulk-write-stream')
var from = require('from2')
var rabin = process.browser ? require('through2') : require('rabin')
var pump = require('pump')
var pumpify = require('pumpify')
var collect = require('stream-collector')
var storage = require('./storage')
var cursor = require('./cursor')
var encoding = require('hyperdrive-encoding')

module.exports = Archive

function Archive (drive, key, opts) {
  events.EventEmitter.call(this)
  var self = this

  this.options = opts || {}
  this.drive = drive
  this.live = this.options.live = !key && (this.options.live !== false)
  this.metadata = drive.core.createFeed(key, this.options)
  this.content = null
  this.key = key || this.metadata.key
  this.discoveryKey = this.metadata.discoveryKey
  this.owner = !key
  this.open = thunky(open)
  this.id = drive.id

  this._sparse = !!this.options.sparse
  this._closed = false
  this._appending = []
  this._indexBlock = -1
  this._finalized = false

  function open (cb) {
    self._open(cb)
  }
}

inherits(Archive, events.EventEmitter)

Archive.prototype.replicate = function (opts) {
  if (!opts) opts = {}
  if (isStream(opts)) opts = {stream: opts}

  assertReplication(this)

  var stream = opts.stream
  var self = this
  if (!stream) stream = opts.stream = this.metadata.replicate(opts)
  else this.metadata.replicate(opts)

  this.open(function (err) {
    if (err) return stream.destroy(err)
    if (self.content && self.content.key) self.content.replicate(opts)
  })

  return stream
}

Archive.prototype.unreplicate = function (stream) {
  var self = this

  this.metadata.unreplicate(stream)
  this.open(function (err) {
    if (err) return
    if (self.content && self.content.key) self.content.unreplicate(stream)
  })

  return stream
}

Archive.prototype.list = function (opts, cb) {
  if (typeof opts === 'function') return this.list(null, opts)
  if (!opts) opts = {}

  var self = this
  var opened = false
  var offset = opts.offset || 0
  var limit = opts.limit || Infinity
  var live = opts.live === false ? false : (opts.live || !cb)
  var range = null
  var stream = from.obj(read)

  return collect(stream.on('end', cleanup).on('close', cleanup), cb)

  function cleanup () {
    if (range) self.metadata.unprioritize(range)
  }

  function read (size, cb) {
    if (!opened) return open(size, cb)
    if (offset === self._indexBlock) offset++
    if (offset === self.metadata.blocks && !live) return cb(null, null)
    if (!limit--) return cb(null, null)

    self.metadata.get(offset++, function (err, buf) {
      if (err || !buf) return cb(err, buf)

      try {
        var entry = encoding.decode(buf)
      } catch (err) {
        return cb(err)
      }

      cb(null, entry)
    })
  }

  function open (size, cb) {
    opened = true
    self.open(function (err) {
      if (stream.destroyed) return
      if (err) return cb(err)
      if (!self.live && opts.live !== true) live = false
      range = self.metadata.prioritize({prioritize: 3, start: offset, end: offset + limit, linear: true})
      read(size, cb)
    })
  }
}

Archive.prototype.get = function (index, opts, cb) {
  if (typeof opts === 'function') return this.get(index, null, opts)
  if (typeof index === 'object' && index.name) return cb(null, index)
  if (!opts) opts = {}

  var self = this
  var called = false
  var timeout = null

  if (opts.timeout) {
    timeout = setTimeout(ontimeout, opts.timeout)
  }

  if (typeof index === 'string') return this.lookup(index, done)

  this.open(function (err) {
    if (err) return done(err)
    if (self._indexBlock <= index && self._indexBlock > -1) index++

    self.metadata.get(index, function (err, buf) {
      if (err) return done(err)
      if (!buf) return done(null, null)

      try {
        var entry = encoding.decode(buf)
      } catch (err) {
        return done(err)
      }

      done(null, entry)
    })
  })

  function ontimeout () {
    var err = new Error('Get timed out')
    err.timeout = true
    err.code = 'ETIMEDOUT'
    done(err)
  }

  function done (err, val) {
    if (timeout) clearTimeout(timeout)
    if (called) return
    called = true
    cb(err, val)
  }
}

Archive.prototype.lookup = function (name, cb) {
  var entries = this.list({live: false})
  var result = null

  entries.on('data', function (data) {
    if (data.name !== name) return
    result = data
  })

  entries.on('error', done)
  entries.on('close', done)
  entries.on('end', done)

  function done (err) {
    if (result) return cb(null, result)
    cb(err || new Error('Could not find entry'))
  }
}

Archive.prototype.countDownloadedBlocks = function (entry) {
  // no content hypercore yet? then nothing is downloaded
  if (!this.content) {
    return 0
  }

  // iterate and tally the entry's blocks
  var b = 0
  var offset = entry.content.blockOffset
  for (var i = 0; i < entry.blocks; i++) {
    if (this.content.has(i + offset)) {
      b++
    }
  }
  return b
}

Archive.prototype.isEntryDownloaded = function (entry) {
  return this.countDownloadedBlocks(entry) === entry.blocks
}

Archive.prototype.finalize = function (cb) {
  if (!cb) cb = noop
  var self = this

  this.open(function (err) {
    if (err) return done(err)

    self._finalized = true

    if (self._appending.length) {
      self.once('idle', function () {
        self.finalize(cb)
      })
      return
    }

    self.content.finalize(function (err) {
      if (err) return done(err)
      if (self._indexBlock > -1) return self.metadata.finalize(done)
      self._writeIndex(function (err) {
        if (err) return done(err)
        self.metadata.finalize(done)
      })
    })
  })

  function done (err) {
    if (err) return cb(err)
    self.key = self.metadata.key
    self.discoveryKey = self.metadata.discoveryKey
    cb(null)
  }
}

Archive.prototype.createFileWriteStream = function (entry, opts) {
  assertFinalized(this)

  if (typeof entry === 'string') entry = {name: entry}
  if (!entry.type) entry.type = 'file'
  if (!opts) opts = {}

  var self = this
  var opened = false
  var start = 0
  var bytesOffset = 0
  var stream = pumpify(rabin(), bulk.obj(write, end))

  entry.length = 0
  this._appending.push(stream)

  stream.on('finish', remove)
  stream.on('close', remove)
  stream.on('error', remove)

  return stream

  function remove () {
    var i = self._appending.indexOf(stream)
    if (i > -1) {
      self._appending.splice(i, 1)
      if (self._appending.length) self._appending[0].emit('continue')
      else self.emit('idle')
    }
  }

  function open (buffers, cb) {
    opened = true
    self.open(function (err) {
      if (err) return cb(err)

      if (self._appending.indexOf(stream) !== 0) {
        stream.once('continue', function () {
          open(buffers, cb)
        })
      } else {
        start = self.content.blocks
        bytesOffset = self.content.bytes
        if (self.options.storage) {
          self.options.storage.openAppend(entry.name, opts.indexing)
        }

        if (buffers.length) write(buffers, cb)
        else cb()
      }
    })
  }

  function write (buffers, cb) {
    if (!opened) return open(buffers, cb)
    for (var i = 0; i < buffers.length; i++) entry.length += byteLength(buffers[i])
    self.content.append(buffers, cb)
  }

  function end (cb) {
    if (opened) done()
    else open([], done)

    function done (err) {
      if (err) return cb(err)

      entry.content = {
        bytesOffset: bytesOffset,
        blockOffset: start
      }
      entry.blocks = self.content.blocks - start
      if (self.options.storage) {
        self.options.storage.end(bytesOffset, entry, function (err) {
          if (err) return cb(err)
          self.options.storage.closeAppend(done)
        })
      } else {
        done(null)
      }

      function done (err) {
        if (err) return cb(err)
        self._writeEntry(entry, cb)
      }
    }
  }
}

Archive.prototype.createByteCursor = function (index, opts) {
  if (typeof opts === 'number') opts = {start: opts}
  if (!opts) opts = {}
  if (opts.length) opts.end = (opts.start || 0) + opts.length
  return cursor(this, index, opts)
}

Archive.prototype.createFileReadStream = function (entry, opts) {
  if (!opts) opts = {}

  var self = this
  var opened = false
  var cur = null
  var destroyed = false

  var stream = from(read)

  stream.on('end', cleanup)
  stream.on('close', cleanup)

  return stream

  function cleanup () {
    destroyed = true
    if (cur) cur.destroy()
  }

  function read (size, cb) {
    if (!opened) return open(size, cb)
    cur.next(cb)
  }

  function open (size, cb) {
    opened = true
    self._range(entry, function (err, startBlock, endBlock, latest) {
      if (err) return cb(err)
      if (destroyed) return
      cur = self.createByteCursor(latest, opts)
      read(size, cb)
    })
  }
}

Archive.prototype.append = function (entry, cb) {
  if (!cb) cb = noop
  assertFinalized(this)

  if (typeof entry === 'string') entry = {name: entry}
  if (!entry.type) entry.type = 'file'

  var self = this

  this.open(function (err) {
    if (err) return cb(err)

    if (entry.type === 'file') {
      if (!self.options.storage) throw new Error('Set options.file to append files')

      var rs = fileReadStream(self.options.file(entry.name, self.options))
      var ws = self.createFileWriteStream(entry, {indexing: true})
      pump(rs, ws, cb)
    } else {
      // we rely on these internally so we override them here to avoid an external
      // user messing them up
      entry.length = 0
      entry.blocks = 0
      entry.content = {
        bytesOffset: self.content.bytes,
        blockOffset: self.content.blocks
      }
      self._writeEntry(entry, cb)
    }
  })
}

Archive.prototype.close = function (cb) {
  if (!cb) cb = noop
  var self = this
  this._closed = true
  this.metadata.close(function () {
    if (!self.content) return cb()
    self.content.close(cb)
  })
}

Archive.prototype.download = function (entry, cb) {
  var self = this

  this._range(entry, function (err, start, end) {
    if (err) return cb(err)

    if (start === end && entry.type === 'file') {
      var storage = self.options.storage
      if (storage) {
        storage.openAppend(entry.name, true)
        storage.write(0, Buffer(0), function (err) {
          if (err) return cb(err)
          self.options.storage.closeAppend(cb)
        })
        return
      }
    }

    if (self._sparse) {
      self.content.prioritize({start: start, end: end})
    }

    self.content.on('download', kick)
    kick()

    function kick () {
      while (true) {
        if (start === end) return done()
        if (!self.content.has(start)) return
        start++
      }
    }

    function done () {
      self.content.removeListener('download', kick)
      cb()
    }
  })
}

Archive.prototype._range = function (entry, cb) {
  var startBlock = 0
  var self = this

  if (entry && entry.content && entry.blocks !== undefined) {
    return process.nextTick(function () {
      cb(null, entry.content.blockOffset, entry.content.blockOffset + entry.blocks, entry)
    })
  }
  this.get(entry, function (err, result) {
    if (err) return cb(err)

    var latest = null
    var name = result.name
    var i = 0
    var startResult = 0
    var endResult = 0

    self.get(i, loop)

    function loop (err, st) {
      if (err) return cb(err)
      if (st.name === name) {
        latest = st
        startResult = startBlock
        endResult = startBlock + st.blocks
      }
      startBlock += st.blocks
      if (i + 1 === self.metadata.blocks - 1) return cb(null, startResult, endResult, latest)
      self.get(++i, loop)
    }
  })
}

Archive.prototype._open = function (cb) {
  if (this._closed) return cb(new Error('Archive is closed'))
  var self = this

  this.metadata.open(function (err) {
    if (err) return cb(err)
    if (self._closed) return cb(new Error('Archive is closed'))

    if (!self.owner && self.metadata.secretKey) self.owner = true // TODO: hypercore should tell you this

    if (!self.owner || self.metadata.blocks) waitForIndex(null)
    else onindex(null)
  })

  function waitForIndex (err) {
    if (err) return cb(err)
    if (self._closed) return cb(new Error('Archive is closed'))
    if (!self.metadata.blocks) return self.metadata.get(0, waitForIndex)
    self._indexBlock = self.metadata.live ? 0 : self.metadata.blocks - 1

    self.metadata.get(self._indexBlock, function (err, buf) {
      if (err) return cb(err)

      try {
        var index = encoding.decode(buf)
        if (index.type !== 'index') throw new Error('Expected block to be index')
      } catch (err) {
        return cb(err)
      }

      onindex(index)
    })
  }

  function onindex (index) {
    if (self._closed) return cb(new Error('Archive is closed'))
    if (self.options.file) self.options.storage = storage(self)
    self.options.key = index && index.content
    self.content = self.drive.core.createFeed(null, self.options)
    self.live = self.metadata.live

    self.content.on('download', function (block, data) {
      self.emit('download', data)
    })

    self.content.on('upload', function (block, data) {
      self.emit('upload', data)
    })

    self.emit('content')

    if (self.metadata.live && !index) self._writeIndex(opened)
    else opened(null)
  }

  function opened (err) {
    if (err) return cb(err)
    self.content.open(cb)
  }
}

Archive.prototype._writeIndex = function (cb) {
  var index = {content: this.content.key, type: 'index'}
  this._indexBlock = this.metadata.blocks
  this._writeMessage(index, cb)
}

Archive.prototype._writeEntry = function (entry, cb) {
  this._writeMessage(entry, cb)
}

Archive.prototype._writeMessage = function (message, cb) {
  this.metadata.append(encoding.encode(message), cb)
}

function noop () {}

function byteLength (buf) {
  return Buffer.isBuffer(buf) ? buf.length : Buffer.byteLength(buf)
}

function fileReadStream (store) {
  var opened = false
  var offset = 0

  return from(read)

  function read (size, cb) {
    if (!opened) return open(size, cb)
    var len = Math.min(65536, store.length - offset)
    if (!len) return close(cb)
    var off = offset
    offset += len
    store.read(off, len, cb)
  }

  function close (cb) {
    if (!store.close) return cb(null, null)
    store.close(function (err) {
      if (err) return cb(err)
      cb(null, null)
    })
  }

  function open (size, cb) {
    opened = true
    if (!store.open) return read(size, cb)
    store.open(function (err) {
      if (err) return cb(err)
      read(size, cb)
    })
  }
}

function assertReplication (self) {
  if (!self.key) throw new Error('Finalize the archive before replicating it')
}

function assertFinalized (self) {
  if (self._finalized && !self.metadata.live) throw new Error('Cannot append any entries after the archive is finalized')
}

function isStream (stream) {
  return stream && typeof stream.pipe === 'function'
}
