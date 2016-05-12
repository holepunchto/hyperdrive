var inherits = require('inherits')
var events = require('events')
var thunky = require('thunky')
var hypercore = require('hypercore')
var bulk = require('bulk-write-stream')
var from = require('from2')
var rabin = process.browser ? require('through2') : require('rabin')
var pump = require('pump')
var pumpify = require('pumpify')
var collect = require('stream-collector')
var messages = require('./messages')
var storage = require('./storage')

module.exports = Drive

function Drive (db, opts) {
  if (!(this instanceof Drive)) return new Drive(db, opts)
  this.core = hypercore(db, opts)
}

Drive.prototype.replicate = function () {
  return this.core.replicate()
}

Drive.prototype.createArchive = function (key, opts) {
  if (typeof key === 'object' && !Buffer.isBuffer(key) && key) {
    opts = key
    key = null
  }

  return new Archive(this, key, opts)
}

function Archive (drive, key, opts) {
  events.EventEmitter.call(this)
  var self = this

  this.options = opts || {}
  this.drive = drive
  this.live = this.options.live = !key && !!this.options.live
  this.metadata = drive.core.createFeed(key, this.options)
  this.content = null
  this.key = key || this.metadata.key
  this.owner = !key
  this.open = thunky(open)

  this._appending = []
  this._indexBlock = -1
  this._finalized = false

  function open (cb) {
    self._open(cb)
  }
}

inherits(Archive, events.EventEmitter)

Archive.prototype.replicate = function (stream) {
  assertRepliction(this)

  var self = this
  if (!stream) stream = this.metadata.replicate()

  this.open(function (err) {
    if (err) return stream.destroy(err)
    self.metadata.join(stream)
    if (self.content.key) self.content.join(stream)
  })

  return stream
}

Archive.prototype.unreplicate = function (stream) {
  assertRepliction(this)

  var self = this

  this.open(function (err) {
    if (err) return stream.destroy(err)
    self.metadata.leave(stream)
    if (self.content.key) self.content.leave(stream)
  })

  return stream
}

Archive.prototype.list = function (cb) {
  var self = this
  var opened = false
  var offset = 0
  var live = !cb

  return collect(from.obj(read), cb)

  function read (size, cb) {
    if (!opened) return open(size, cb)
    if (offset === self._indexBlock) offset++
    if (offset === self.metadata.blocks && !live) return cb(null, null)

    self.metadata.get(offset++, function (err, buf) {
      if (err || !buf) return cb(err, buf)

      try {
        var entry = messages.Entry.decode(buf)
        entry.type = toTypeString(entry.type)
      } catch (err) {
        return cb(err)
      }

      cb(null, entry)
    })
  }

  function open (size, cb) {
    opened = true
    self.open(function (err) {
      if (err) return cb(err)
      if (!self.live) live = false
      read(size, cb)
    })
  }
}

Archive.prototype.get = function (index, cb) {
  if (typeof index === 'object' && index.name) return cb(null, index)
  if (typeof index === 'string') return this.lookup(index, cb)

  var self = this

  this.open(function (err) {
    if (err) return cb(err)
    if (self._indexBlock <= index && self._indexBlock > -1) index++

    self.metadata.get(index, function (err, buf) {
      if (err) return cb(err)
      if (!buf) return cb(null, null)

      try {
        var entry = messages.Entry.decode(buf)
        entry.type = toTypeString(entry.type)
      } catch (err) {
        return cb(err)
      }

      cb(null, entry)
    })
  })
}

Archive.prototype.lookup = function (name, cb) {
  var entries = this.list()
  var result = null

  entries.on('data', function (data) {
    if (data.name !== name || result) return
    result = data
    entries.destroy()
    cb(null, data)
  })

  entries.on('error', done)
  entries.on('close', done)
  entries.on('end', done)

  function done (err) {
    if (result) return
    cb(err || new Error('Could not find entry'))
  }
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
        if (self.options.storage) {
          self.options.storage.openAppend(entry.name, opts.indexing)
        }
        write(buffers, cb)
      }
    })
  }

  function write (buffers, cb) {
    if (!opened) return open(buffers, cb)
    for (var i = 0; i < buffers.length; i++) entry.length += byteLength(buffers[i])
    self.content.append(buffers, cb)
  }

  function end (cb) {
    entry.blocks = self.content.blocks - start
    if (self.options.storage) self.options.storage.closeAppend(done)
    else done(null)

    function done (err) {
      if (err) return cb(err)
      self._writeEntry(entry, cb)
    }
  }
}

Archive.prototype.createFileReadStream = function (entry) {
  var self = this
  var opened = false
  var start = 0
  var end = 0

  return from(read)

  function read (size, cb) {
    if (!opened) return open(size, cb)
    if (start >= end) return cb(null, null)
    self.content.get(start++, cb)
  }

  function open (size, cb) {
    opened = true
    self._range(entry, function (err, startBlock, endBlock) {
      if (err) return cb(err)
      start = startBlock
      end = endBlock
      read(size, cb)
    })
  }
}

Archive.prototype.append = function (entry, cb) {
  if (!cb) cb = noop
  assertFinalized(this)

  if (typeof entry === 'string') entry = {name: entry}
  if (!entry.type) entry.type = messages.TYPE.FILE

  var self = this

  this.open(function (err) {
    if (err) return cb(err)

    if (entry.type === messages.TYPE.FILE) {
      if (!self.options.storage) throw new Error('Set options.file to append files')

      var rs = fileReadStream(self.options.file(entry.name, self.options))
      var ws = self.createFileWriteStream(entry, {indexing: true})
      pump(rs, ws, cb)
    } else {
      // we rely on these internally so we override them here to avoid an external
      // user messing them up
      entry.length = 0
      entry.blocks = 0
      self._writeEntry(entry, cb)
    }
  })
}

Archive.prototype.download = function (entry, cb) {
  var self = this

  this._range(entry, function (err, start, end) {
    if (err) return cb(err)

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

  this.get(entry, function (err, result) {
    if (err) return cb(err)

    var name = result.name
    var i = 0

    self.get(i, loop)

    function loop (err, st) {
      if (err) return cb(err)
      if (st.name === name) return cb(null, startBlock, startBlock + st.blocks)
      startBlock += st.blocks
      self.get(++i, loop)
    }
  })
}

Archive.prototype._open = function (cb) {
  var self = this

  this.metadata.open(function (err) {
    if (err) return cb(err)

    if (!self.owner && self.metadata.secretKey) self.owner = true // TODO: hypercore should tell you this

    if (!self.owner || self.metadata.blocks) waitForIndex(null)
    else onindex(null)
  })

  function waitForIndex (err) {
    if (err) return cb(err)
    if (!self.metadata.blocks) return self.metadata.get(0, waitForIndex)
    self._indexBlock = self.metadata.live ? 0 : self.metadata.blocks - 1

    self.metadata.get(self._indexBlock, function (err, buf) {
      if (err) return cb(err)

      try {
        var index = messages.Index.decode(buf)
      } catch (err) {
        return cb(err)
      }

      if (index.version && index.version !== 0) {
        return cb(new Error('Archive is using an updated version of hyperdrive. Please upgrade.'))
      }

      onindex(index)
    })
  }

  function onindex (index) {
    if (self.options.file) self.options.storage = storage(self)
    self.options.key = index && index.content
    self.content = self.drive.core.createFeed(null, self.options)

    self.content.on('download', function (block, data) {
      self.emit('download', data)
    })

    self.content.on('upload', function (block, data) {
      self.emit('upload', data)
    })

    if (self.metadata.live && !index) self._writeIndex(opened)
    else opened(null)
  }

  function opened (err) {
    if (err) return cb(err)
    self.content.open(cb)
  }
}

Archive.prototype._writeIndex = function (cb) {
  var index = {version: 0, content: this.content.key}
  this._indexBlock = this.metadata.blocks
  this.metadata.append(messages.Index.encode(index), cb)
}

Archive.prototype._writeEntry = function (entry, cb) {
  entry.type = toTypeNumber(entry.type)
  this.metadata.append(messages.Entry.encode(entry), cb)
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

function assertRepliction (self) {
  if (!self.key) throw new Error('Finalize the archive before replicating it')
}

function assertFinalized (self) {
  if (self._finalized && !self.metadata.live) throw new Error('Cannot append any entries after the archive is finalized')
}

function toTypeString (t) {
  switch (t) {
    case 0: return 'file'
    case 1: return 'directory'
    case 2: return 'symlink'
    case 3: return 'hardlink'
  }

  return 'unknown'
}

function toTypeNumber (t) {
  switch (t) {
    case 'file': return 0
    case 'directory': return 1
    case 'symlink': return 2
    case 'hardlink': return 3
  }

  return 0
}
