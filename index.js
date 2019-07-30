var hypercore = require('hypercore')
var mutexify = require('mutexify')
var raf = require('random-access-file')
var thunky = require('thunky')
var tree = require('append-tree')
var collect = require('stream-collector')
var sodium = require('sodium-universal')
var inherits = require('inherits')
var events = require('events')
var duplexify = require('duplexify')
var from = require('from2')
var each = require('stream-each')
var uint64be = require('uint64be')
var unixify = require('unixify')
var path = require('path').posix
var messages = require('./lib/messages')
var stat = require('./lib/stat')
var cursor = require('./lib/cursor')

var DEFAULT_FMODE = (4 | 2 | 0) << 6 | ((4 | 0 | 0) << 3) | (4 | 0 | 0) // rw-r--r--
var DEFAULT_DMODE = (4 | 2 | 1) << 6 | ((4 | 0 | 1) << 3) | (4 | 0 | 1) // rwxr-xr-x

module.exports = Hyperdrive

function Hyperdrive (storage, key, opts) {
  if (!(this instanceof Hyperdrive)) return new Hyperdrive(storage, key, opts)
  events.EventEmitter.call(this)

  if (isObject(key)) {
    opts = key
    key = null
  }

  if (!opts) opts = {}

  this.key = null
  this.discoveryKey = null
  this.live = true
  this.latest = !!opts.latest

  this._storages = defaultStorage(this, storage, opts)

  this.metadata = opts.metadata || hypercore(this._storages.metadata, key, {
    secretKey: opts.secretKey,
    sparse: opts.sparseMetadata,
    createIfMissing: opts.createIfMissing,
    storageCacheSize: opts.metadataStorageCacheSize,
    extensions: opts.extensions
  })
  this.content = opts.content || null
  this.maxRequests = opts.maxRequests || 16
  this.readable = true

  this.storage = storage
  this.tree = tree(this.metadata, {
    offset: 1,
    valueEncoding: messages.Stat,
    cache: opts.treeCacheSize !== 0,
    cacheSize: opts.treeCacheSize
  })
  if (typeof opts.version === 'number') this.tree = this.tree.checkout(opts.version)
  this.sparse = !!opts.sparse
  this.sparseMetadata = !!opts.sparseMetadata
  this.indexing = !!opts.indexing
  this.contentStorageCacheSize = opts.contentStorageCacheSize

  this._latestSynced = 0
  this._latestVersion = 0
  this._latestStorage = this.latest ? this._storages.metadata('latest') : null
  this._checkout = opts._checkout
  this._lock = mutexify()

  this._openFiles = []
  this._emittedContent = false
  this._closed = false

  var self = this

  this.metadata.on('append', update)
  this.metadata.on('extension', extension)
  this.metadata.on('error', onerror)
  this.metadata.once('close', onclose)
  this.ready = thunky(open)
  this.ready(onready)

  function onready (err) {
    if (err) return onerror(err)
    self.emit('ready')
    self._oncontent()
    if (self.latest && !self.metadata.writable) {
      self._trackLatest(function (err) {
        if (self._closed) return
        onerror(err)
      })
    }
  }

  function onerror (err) {
    if (err) self.emit('error', err)
  }

  function onclose () {
    self.emit('close')
  }

  function update () {
    self.emit('update')
  }

  function extension (name, message, peer) {
    self.emit('extension', name, message, peer)
  }

  function open (cb) {
    self._open(cb)
  }
}

inherits(Hyperdrive, events.EventEmitter)

Object.defineProperty(Hyperdrive.prototype, 'version', {
  enumerable: true,
  get: function () {
    return this._checkout ? this.tree.version : (this.metadata.length ? this.metadata.length - 1 : 0)
  }
})

Object.defineProperty(Hyperdrive.prototype, 'writable', {
  enumerable: true,
  get: function () {
    return this.metadata.writable
  }
})

Hyperdrive.prototype._oncontent = function () {
  if (!this.content || this._emittedContent) return
  this._emittedContent = true
  this.emit('content')
}

Hyperdrive.prototype._trackLatest = function (cb) {
  var self = this

  this.ready(function (err) {
    if (err) return cb(err)

    self._latestStorage.read(0, 8, function (_, data) {
      self._latestVersion = data ? uint64be.decode(data) : 0
      loop()
    })
  })

  function loop (err) {
    if (err) return cb(err)

    if (stableVersion()) return fetch()

    // TODO: lock downloading while doing this
    self._clearDangling(self._latestVersion, self.version, onclear)
  }

  function fetch () {
    if (self.sparse) {
      if (stableVersion()) return self.metadata.update(loop)
      return loop(null)
    }

    self.emit('syncing')
    self._fetchVersion(self._latestSynced, function (err, fullySynced) {
      if (err) return cb(err)

      if (fullySynced) {
        self._latestSynced = self._latestVersion
        self.emit('sync')
        if (!self._checkout) self.metadata.update(loop) // TODO: only if live
        return
      }

      loop(null)
    })
  }

  function onclear (err, version) {
    if (err) return cb(err)
    self._latestVersion = version
    self._latestStorage.write(0, uint64be.encode(self._latestVersion), loop)
  }

  function stableVersion () {
    var latest = self.version
    return latest < 0 || self._latestVersion === latest
  }
}

Hyperdrive.prototype._fetchVersion = function (prev, cb) {
  var self = this
  var version = self.version
  var updated = false
  var done = false
  var error = null
  var stream = null
  var queued = 0
  var maxQueued = 64

  var waitingData = null
  var waitingCallback = null

  this.metadata.update(function () {
    updated = true
    if (queued > 0) queued = 0
    if (stream) stream.destroy()
    kick()
  })

  this._ensureContent(function (err) {
    if (err) return cb(err)
    if (updated) return cb(null, false)

    // var snapshot = self.checkout(version)
    stream = self.tree.checkout(prev).diff(version, {puts: true, dels: false})
    each(stream, ondata, ondone)
  })

  function ondata (data, next) {
    if (updated || error) return callAndKick(next, new Error('Out of date'))

    if (queued >= maxQueued) {
      waitingData = data
      waitingCallback = next
      return
    }

    var start = data.value.offset
    var end = start + data.value.blocks

    if (start === end) return callAndKick(next, null)

    queued++
    self.content.download({start: start, end: end}, function (err) {
      if (updated && !waitingCallback) return kick()
      if (!updated) queued--

      if (waitingCallback) {
        data = waitingData
        waitingData = null
        next = waitingCallback
        waitingCallback = null
        return ondata(data, next)
      }

      if (err) {
        stream.destroy(err)
        error = err
      }

      kick()
    })

    process.nextTick(next)
  }

  function callAndKick (next, err) {
    next(err)
    kick()
  }

  function kick () {
    if (!done || queued) return
    queued = -1 // so we don't enter this twice

    if (updated) return cb(null, false)
    if (error) return cb(error)

    cb(null, version === self.version)
  }

  function ondone (err) {
    if (err) error = err
    done = true
    kick()
  }
}

Hyperdrive.prototype._clearDangling = function (a, b, cb) {
  var current = this.tree.checkout(a, {cached: true})
  var latest = this.tree.checkout(b)
  var stream = current.diff(latest, {dels: true, puts: false})
  var self = this

  this._ensureContent(oncontent)

  function done (err) {
    if (err) return cb(err)
    cb(null, b)
  }

  function oncontent (err) {
    if (err) return cb(err)
    each(stream, ondata, done)
  }

  function ondata (data, next) {
    var st = data.value
    self.content.cancel(st.offset, st.offset + st.blocks)
    self.content.clear(st.offset, st.offset + st.blocks, {byteOffset: st.byteOffset, byteLength: st.size}, next)
  }
}

Hyperdrive.prototype.replicate = function (opts) {
  if (!opts) opts = {}

  opts.expectedFeeds = 2

  var self = this
  var stream = this.metadata.replicate(opts)

  this._ensureContent(function (err) {
    if (err) return stream.destroy(err)
    if (stream.destroyed) return
    self.content.replicate({
      live: opts.live,
      download: opts.download,
      upload: opts.upload,
      stream: stream
    })
  })

  return stream
}

Hyperdrive.prototype.checkout = function (version, opts) {
  if (!opts) opts = {}
  opts._checkout = this._checkout || this
  opts.metadata = this.metadata
  opts.version = version
  return Hyperdrive(null, null, opts)
}

Hyperdrive.prototype.createDiffStream = function (version, opts) {
  if (!version) version = 0
  if (typeof version === 'number') version = this.checkout(version)
  return this.tree.diff(version.tree, opts)
}

Hyperdrive.prototype.download = function (dir, cb) {
  if (typeof dir === 'function') return this.download('/', dir)

  var downloadCount = 1
  var self = this

  download(dir || '/')

  function download (entry) {
    self.stat(entry, function (err, stat) {
      if (err) {
        if (cb) cb(err)
        return
      }
      if (stat.isDirectory()) return downloadDir(entry, stat)
      if (stat.isFile()) return downloadFile(entry, stat)
    })
  }

  function downloadDir (dirname, stat) {
    self.readdir(dirname, function (err, entries) {
      if (err) {
        if (cb) cb(err)
        return
      }
      downloadCount -= 1
      downloadCount += entries.length
      entries.forEach(function (entry) {
        download(path.join(dirname, entry))
      })
      if (downloadCount <= 0 && cb) cb()
    })
  }

  function downloadFile (entry, stat) {
    var start = stat.offset
    var end = stat.offset + stat.blocks
    if (start === 0 && end === 0) return
    self.content.download({start, end}, function () {
      downloadCount -= 1
      if (downloadCount <= 0 && cb) cb()
    })
  }
}

Hyperdrive.prototype.history = function (opts) {
  return this.tree.history(opts)
}

Hyperdrive.prototype.createCursor = function (name, opts) {
  return cursor(this, name, opts)
}

// open -> fd
Hyperdrive.prototype.open = function (name, flags, mode, opts, cb) {
  if (typeof mode === 'object' && mode) return this.open(name, flags, 0, mode, opts)
  if (typeof mode === 'function') return this.open(name, flags, 0, mode)
  if (typeof opts === 'function') return this.open(name, flags, mode, null, opts)

  // TODO: use flags, only readable cursors are supported atm
  var cursor = this.createCursor(name, opts)
  var self = this

  cursor.open(function (err) {
    if (err) return cb(err)

    var fd = self._openFiles.indexOf(null)
    if (fd === -1) fd = self._openFiles.push(null) - 1

    self._openFiles[fd] = cursor
    cb(null, fd + 20) // offset all fds with 20, unsure what the actual good offset is
  })
}

Hyperdrive.prototype.read = function (fd, buf, offset, len, pos, cb) {
  var cursor = this._openFiles[fd - 20]
  if (!cursor) return cb(new Error('Bad file descriptor'))

  if (pos !== null) cursor.seek(pos)

  cursor.next(function (err, next) {
    if (err) return cb(err)

    if (!next) return cb(null, 0, buf)

    // if we read too much
    if (next.length > len) {
      next = next.slice(0, len)
      cursor.seek(pos + len)
    }

    next.copy(buf, offset, 0, len)
    cb(null, next.length, buf)
  })
}

// TODO: move to ./lib
Hyperdrive.prototype.createReadStream = function (name, opts) {
  if (!opts) opts = {}

  name = normalizePath(name)

  var self = this
  var downloaded = false
  var first = true
  var start = 0
  var end = 0
  var offset = 0
  var length = typeof opts.end === 'number' ? 1 + opts.end - (opts.start || 0) : typeof opts.length === 'number' ? opts.length : -1
  var range = null
  var ended = false
  var stream = from(read)
  var cached = opts && !!opts.cached

  stream.on('close', cleanup)
  stream.on('end', cleanup)

  return stream

  function cleanup () {
    if (range) self.content.undownload(range, noop)
    range = null
    ended = true
  }

  function read (size, cb) {
    if (first) return open(size, cb)
    if (start === end || length === 0) return cb(null, null)

    self.content.get(start++, {wait: !downloaded && !cached}, function (err, data) {
      if (err) return cb(err)
      if (offset) data = data.slice(offset)
      offset = 0
      if (length > -1) {
        if (length < data.length) data = data.slice(0, length)
        length -= data.length
      }
      cb(null, data)
    })
  }

  function open (size, cb) {
    first = false
    self._ensureContent(function (err) {
      if (err) return cb(err)

      // if running latest === true and a delete happens while getting the tree data, the tree.get
      // should finish before the delete so there shouldn't be an rc. we should test this though.
      self.tree.get(name, ontree)

      function ontree (err, stat) {
        if (err) return cb(err)
        if (ended || stream.destroyed) return

        start = stat.offset
        end = stat.offset + stat.blocks

        var byteOffset = stat.byteOffset
        var missing = 1

        if (opts.start) self.content.seek(byteOffset + opts.start, {start: start, end: end}, onstart)
        else onstart(null, start, 0)

        function onend (err, index) {
          if (err || !range) return
          if (ended || stream.destroyed) return

          missing++
          self.content.undownload(range)
          range = self.content.download({start: start, end: index, linear: true}, ondownload)
        }

        function onstart (err, index, off) {
          if (err) return cb(err)
          if (ended || stream.destroyed) return

          offset = off
          start = index
          range = self.content.download({start: start, end: end, linear: true}, ondownload)

          if (length > -1 && length < stat.size) {
            self.content.seek(byteOffset + length, {start: start, end: end}, onend)
          }

          read(size, cb)
        }

        function ondownload (err) {
          if (--missing) return
          if (err && !ended && !downloaded) stream.destroy(err)
          else downloaded = true
        }
      }
    })
  }
}

Hyperdrive.prototype.readFile = function (name, opts, cb) {
  if (typeof opts === 'function') return this.readFile(name, null, opts)
  if (typeof opts === 'string') opts = {encoding: opts}
  if (!opts) opts = {}

  name = normalizePath(name)

  collect(this.createReadStream(name, opts), function (err, bufs) {
    if (err) return cb(err)
    var buf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs)
    cb(null, opts.encoding && opts.encoding !== 'binary' ? buf.toString(opts.encoding) : buf)
  })
}

Hyperdrive.prototype.createWriteStream = function (name, opts) {
  if (!opts) opts = {}

  name = normalizePath(name)

  var self = this
  var proxy = duplexify()

  // TODO: support piping through a "split" stream like rabin

  proxy.setReadable(false)
  this._ensureContent(function (err) {
    if (err) return proxy.destroy(err)
    if (self._checkout) return proxy.destroy(new Error('Cannot write to a checkout'))
    if (proxy.destroyed) return

    self._lock(function (release) {
      if (!self.latest || proxy.destroyed) return append(null)

      self.tree.get(name, function (err, st) {
        if (err && err.notFound) return append(null)
        if (err) return append(err)
        if (!st.size) return append(null)
        self.content.clear(st.offset, st.offset + st.blocks, append)
      })

      function append (err) {
        if (err) proxy.destroy(err)
        if (proxy.destroyed) return release()

        // No one should mutate the content other than us
        var byteOffset = self.content.byteLength
        var offset = self.content.length

        self.emit('appending', name, opts)

        // TODO: revert the content feed if this fails!!!! (add an option to the write stream for this (atomic: true))
        var stream = self.content.createWriteStream()

        proxy.on('close', done)
        proxy.on('finish', done)

        proxy.setWritable(stream)
        proxy.on('prefinish', function () {
          var st = {
            mode: (opts.mode || DEFAULT_FMODE) | stat.IFREG,
            uid: opts.uid || 0,
            gid: opts.gid || 0,
            size: self.content.byteLength - byteOffset,
            blocks: self.content.length - offset,
            offset: offset,
            byteOffset: byteOffset,
            mtime: getTime(opts.mtime),
            ctime: getTime(opts.ctime)
          }

          proxy.cork()
          self.tree.put(name, st, function (err) {
            if (err) return proxy.destroy(err)
            self.emit('append', name, opts)
            proxy.uncork()
          })
        })
      }

      function done () {
        proxy.removeListener('close', done)
        proxy.removeListener('finish', done)
        release()
      }
    })
  })

  return proxy
}

Hyperdrive.prototype.writeFile = function (name, buf, opts, cb) {
  if (typeof opts === 'function') return this.writeFile(name, buf, null, opts)
  if (typeof opts === 'string') opts = {encoding: opts}
  if (!opts) opts = {}
  if (typeof buf === 'string') buf = new Buffer(buf, opts.encoding || 'utf-8')
  if (!cb) cb = noop

  name = normalizePath(name)

  var bufs = split(buf) // split the input incase it is a big buffer.
  var stream = this.createWriteStream(name, opts)
  stream.on('error', cb)
  stream.on('finish', cb)
  for (var i = 0; i < bufs.length; i++) stream.write(bufs[i])
  stream.end()
}

Hyperdrive.prototype.mkdir = function (name, opts, cb) {
  if (typeof opts === 'function') return this.mkdir(name, null, opts)
  if (typeof opts === 'number') opts = {mode: opts}
  if (!opts) opts = {}
  if (!cb) cb = noop

  name = normalizePath(name)

  var self = this

  this.ready(function (err) {
    if (err) return cb(err)
    if (self._checkout) return cb(new Error('Cannot write to a checkout'))

    self._lock(function (release) {
      var st = {
        mode: (opts.mode || DEFAULT_DMODE) | stat.IFDIR,
        uid: opts.uid,
        gid: opts.gid,
        mtime: getTime(opts.mtime),
        ctime: getTime(opts.ctime),
        offset: self.content.length,
        byteOffset: self.content.byteLength
      }

      self.tree.put(name, st, function (err) {
        release(cb, err)
      })
    })
  })
}

Hyperdrive.prototype._statDirectory = function (name, opts, cb) {
  this.tree.list(name, opts, function (err, list) {
    if (name !== '/' && (err || !list.length)) return cb(err || new Error(name + ' could not be found'))
    var st = stat()
    st.mode = stat.IFDIR | DEFAULT_DMODE
    cb(null, st)
  })
}

Hyperdrive.prototype.access = function (name, opts, cb) {
  if (typeof opts === 'function') return this.access(name, null, opts)
  if (!opts) opts = {}
  name = normalizePath(name)
  this.stat(name, opts, function (err) {
    cb(err)
  })
}

Hyperdrive.prototype.exists = function (name, opts, cb) {
  if (typeof opts === 'function') return this.exists(name, null, opts)
  if (!opts) opts = {}
  this.access(name, opts, function (err) {
    cb(!err)
  })
}

Hyperdrive.prototype.lstat = function (name, opts, cb) {
  if (typeof opts === 'function') return this.lstat(name, null, opts)
  if (!opts) opts = {}
  var self = this

  name = normalizePath(name)

  this.tree.get(name, opts, function (err, st) {
    if (err) return self._statDirectory(name, opts, cb)
    cb(null, stat(st))
  })
}

Hyperdrive.prototype.stat = function (name, opts, cb) {
  if (typeof opts === 'function') return this.stat(name, null, opts)
  if (!opts) opts = {}
  this.lstat(name, opts, cb)
}

Hyperdrive.prototype.readdir = function (name, opts, cb) {
  if (typeof opts === 'function') return this.readdir(name, null, opts)

  name = normalizePath(name)

  if (name === '/') return this._readdirRoot(opts, cb) // TODO: should be an option in append-tree prob
  this.tree.list(name, opts, function (err, list) {
    if (err) return cb(err)
    cb(null, sanitizeDirs(list))
  })
}

Hyperdrive.prototype._readdirRoot = function (opts, cb) {
  this.tree.list('/', opts, function (_, list) {
    if (list) return cb(null, sanitizeDirs(list))
    cb(null, [])
  })
}

Hyperdrive.prototype.unlink = function (name, cb) {
  name = normalizePath(name)
  this._del(name, cb || noop)
}

Hyperdrive.prototype.rmdir = function (name, cb) {
  if (!cb) cb = noop

  name = normalizePath(name)

  var self = this

  this.readdir(name, function (err, list) {
    if (err) return cb(err)
    if (list.length) return cb(new Error('Directory is not empty'))
    self._del(name, cb)
  })
}

Hyperdrive.prototype._del = function (name, cb) {
  var self = this

  this._ensureContent(function (err) {
    if (err) return cb(err)

    self._lock(function (release) {
      if (!self.latest) return del(null)
      self.tree.get(name, function (err, value) {
        if (err) return done(err)
        self.content.clear(value.offset, value.offset + value.blocks, del)
      })

      function del (err) {
        if (err) return done(err)
        self.tree.del(name, done)
      }

      function done (err) {
        release(cb, err)
      }
    })
  })
}

Hyperdrive.prototype._closeFile = function (fd, cb) {
  var cursor = this._openFiles[fd - 20]
  if (!cursor) return cb(new Error('Bad file descriptor'))
  this._openFiles[fd - 20] = null
  cursor.close(cb)
}

Hyperdrive.prototype.close = function (fd, cb) {
  if (typeof fd === 'number') return this._closeFile(fd, cb || noop)
  else cb = fd
  if (!cb) cb = noop

  var self = this
  this.ready(function (err) {
    if (err) return cb(err)
    self._closed = true
    self.metadata.close(function (err) {
      if (!self.content) return cb(err)
      self.content.close(cb)
    })
  })
}

Hyperdrive.prototype._ensureContent = function (cb) {
  var self = this

  this.ready(function (err) {
    if (err) return cb(err)
    if (!self.content) return self._loadIndex(cb)
    cb(null)
  })
}

Hyperdrive.prototype._loadIndex = function (cb) {
  var self = this

  if (this._checkout) this._checkout._loadIndex(done)
  else this.metadata.get(0, {valueEncoding: messages.Index}, done)

  function done (err, index) {
    if (err) return cb(err)
    if (self.content) return self.content.ready(cb)

    var keyPair = self.metadata.writable && contentKeyPair(self.metadata.secretKey)
    var opts = contentOptions(self, keyPair && keyPair.secretKey)
    self.content = self._checkout ? self._checkout.content : hypercore(self._storages.content, index.content, opts)
    self.content.on('error', function (err) {
      self.emit('error', err)
    })
    self.content.ready(function (err) {
      if (err) return cb(err)
      self._oncontent()
      cb()
    })
  }
}

Hyperdrive.prototype._open = function (cb) {
  var self = this

  this.tree.ready(function (err) {
    if (err) return cb(err)
    self.metadata.ready(function (err) {
      if (err) return cb(err)
      if (self.content) return cb(null)

      self.key = self.metadata.key
      self.discoveryKey = self.metadata.discoveryKey

      if (!self.metadata.writable || self._checkout) onnotwriteable()
      else onwritable()
    })
  })

  function onnotwriteable () {
    if (self.metadata.has(0)) return self._loadIndex(cb)
    self._loadIndex(noop)
    cb()
  }

  function onwritable () {
    var wroteIndex = self.metadata.has(0)
    if (wroteIndex) return self._loadIndex(cb)

    if (!self.content) {
      var keyPair = contentKeyPair(self.metadata.secretKey)
      var opts = contentOptions(self, keyPair.secretKey)
      self.content = hypercore(self._storages.content, keyPair.publicKey, opts)
      self.content.on('error', function (err) {
        self.emit('error', err)
      })
    }

    self.content.ready(function () {
      if (self.metadata.has(0)) return cb(new Error('Index already written'))
      self.metadata.append(messages.Index.encode({type: 'hyperdrive', content: self.content.key}), cb)
    })
  }
}

Hyperdrive.prototype.extension = function (name, message) {
  this.metadata.extension(name, message)
}

function contentOptions (self, secretKey) {
  return {
    sparse: self.sparse || self.latest,
    maxRequests: self.maxRequests,
    secretKey: secretKey,
    storeSecretKey: false,
    indexing: self.metadata.writable && self.indexing,
    storageCacheSize: self.contentStorageCacheSize
  }
}

function isObject (val) {
  return !!val && typeof val !== 'string' && !Buffer.isBuffer(val)
}

function wrap (self, storage) {
  return {
    metadata: function (name, opts) {
      return storage.metadata(name, opts, self)
    },
    content: function (name, opts) {
      return storage.content(name, opts, self)
    }
  }
}

function defaultStorage (self, storage, opts) {
  var folder = ''

  if (typeof storage === 'object' && storage) return wrap(self, storage)

  if (typeof storage === 'string') {
    folder = storage
    storage = raf
  }

  return {
    metadata: function (name) {
      return storage(path.join(folder, 'metadata', name))
    },
    content: function (name) {
      return storage(path.join(folder, 'content', name))
    }
  }
}

function noop () {}

function split (buf) {
  var list = []
  for (var i = 0; i < buf.length; i += 65536) {
    list.push(buf.slice(i, i + 65536))
  }
  return list
}

function getTime (date) {
  if (typeof date === 'number') return date
  if (!date) return Date.now()
  return date.getTime()
}

function normalizePath (p) {
  return unixify(path.resolve('/', p))
}

function sanitizeDirs (list) {
  for (var i = 0; i < list.length; i++) {
    if (!noDots(list[i])) return list.filter(noDots)
  }
  return list
}

function noDots (entry) {
  return entry !== '..' && entry !== '.'
}

function contentKeyPair (secretKey) {
  var seed = new Buffer(sodium.crypto_sign_SEEDBYTES)
  var context = new Buffer('hyperdri') // 8 byte context
  var keyPair = {
    publicKey: new Buffer(sodium.crypto_sign_PUBLICKEYBYTES),
    secretKey: new Buffer(sodium.crypto_sign_SECRETKEYBYTES)
  }

  sodium.crypto_kdf_derive_from_key(seed, 1, context, secretKey)
  sodium.crypto_sign_seed_keypair(keyPair.publicKey, keyPair.secretKey, seed)
  if (seed.fill) seed.fill(0)

  return keyPair
}
