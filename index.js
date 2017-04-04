var hypercore = require('hypercore')
var mutexify = require('mutexify')
var raf = require('random-access-file')
var thunky = require('thunky')
var tree = require('append-tree')
var collect = require('stream-collector')
var inherits = require('inherits')
var events = require('events')
var duplexify = require('duplexify')
var from = require('from2')
var messages = require('./lib/messages')
var stat = require('./lib/stat')

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

  this._bare = !opts.shallow
  this._storages = defaultStorage(this, storage, opts)

  // TODO: forward errors
  this.metadata = opts.metadata || hypercore(this._storages.metadata, key)
  this.content = opts.content || null
  this.maxRequests = opts.maxRequests || 16

  this.storage = storage // TODO: do something smarter (this is polymorphic)
  this.tree = tree(this.metadata, {offset: 1, valueEncoding: messages.Stat})
  if (typeof opts.version === 'number') this.tree = this.tree.checkout(opts.version)
  this.version = this.tree.version
  this.sparse = !!opts.sparse

  this._checkout = opts._checkout
  this._lock = mutexify()

  var self = this

  this.metadata.on('append', update)
  this.ready = thunky(open)
  this.ready(onready)

  function onready (err) {
    if (err) return self.emit('error', err)
    self.emit('ready')
    if (self.content) self.emit('content')
  }

  function update () {
    self.version = self.tree.version
  }

  function open (cb) {
    self._open(cb)
  }
}

inherits(Hyperdrive, events.EventEmitter)

Hyperdrive.prototype.replicate = function (opts) {
  if (!opts) opts = {}

  opts.expectedFeeds = 2

  var self = this
  var stream = this.metadata.replicate(opts)

  this._ensureContent(function (err) {
    if (err) return stream.destroy(err)
    if (stream.destroyed) return
    self.content.replicate({live: opts.live, stream: stream})
  })

  return stream
}

Hyperdrive.prototype.checkout = function (version) {
  return Hyperdrive(null, null, {
    _checkout: this._checkout || this,
    metadata: this.metadata,
    version: version
  })
}

Hyperdrive.prototype.history = function (opts) {
  return this.tree.history(opts)
}

// TODO: move to ./lib
Hyperdrive.prototype.createReadStream = function (name, opts) {
  if (!opts) opts = {}

  var self = this
  var first = true
  var start = 0
  var end = 0
  var offset = 0
  var length = typeof opts.end === 'number' ? 1 + opts.end - (opts.start || 0) : typeof opts.length === 'number' ? opts.length : -1
  var range = null
  var ended = false
  var stream = from(read)

  stream.on('close', cleanup)
  stream.on('end', cleanup)

  return stream

  function cleanup () {
    if (range) self.content.undownload(range)
    range = null
    ended = true
  }

  function read (size, cb) {
    if (first) return open(size, cb)
    if (start === end || length === 0) return cb(null, null)

    self.content.get(start++, function (err, data) {
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
      self.tree.get(name, function (err, stat) {
        if (err) return cb(err)
        if (ended) return

        start = stat.offset
        end = stat.offset + stat.blocks

        var byteOffset = stat.byteOffset

        if (opts.start) self.content.seek(byteOffset + opts.start, {start: start, end: end}, onstart)
        else onstart(null, start, 0)

        function onend (err, index) {
          if (err || !range) return
          self.content.undownload(range)
          range = self.content.download({start: start, end: index, linear: true})
        }

        function onstart (err, index, off) {
          if (err) return cb(err)

          offset = off
          start = index
          range = self.content.download({start: start, end: end, linear: true})

          if (length > -1 && length < stat.size) {
            self.content.seek(byteOffset + length, {start: start, end: end}, onend)
          }

          read(size, cb)
        }
      })
    })
  }
}

Hyperdrive.prototype.readFile = function (name, opts, cb) {
  if (typeof opts === 'function') return this.readFile(name, null, opts)
  if (typeof opts === 'string') opts = {encoding: opts}
  if (!opts) opts = {}

  collect(this.createReadStream(name), function (err, bufs) {
    if (err) return cb(err)
    var buf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs)
    cb(null, opts.encoding ? buf.toString(opts.encoding) : buf)
  })
}

Hyperdrive.prototype.createWriteStream = function (name, opts) {
  if (!opts) opts = {}

  var self = this
  var proxy = duplexify()

  // TODO: support piping through a "split" stream like rabin

  proxy.setReadable(false)
  this._ensureContent(function (err) {
    if (err) return proxy.destroy(err)
    if (self._checkout) return proxy.destroy(new Error('Cannot write to a checkout'))
    if (proxy.destroyed) return

    self._lock(function (release) {
      if (proxy.destroyed) return release()

      // No one should mutate the content other than us
      var byteOffset = self.content.byteLength
      var offset = self.content.length

      self.emit('append', name, opts)

      // TODO: revert the content feed if this fails!!!! (add an option to the write stream for this (atomic: true))
      var stream = self.content.createWriteStream()
      var file = null

      if (!self._bare) {
        file = {
          start: self.content.byteLength,
          end: Infinity,
          storage: raf(self.storage + '/' + name, {readable: true, writable: !opts.indexing})
        }
        if (opts.indexing) file.storage.write = ignoreWrite
        self.content._storage.data.add(file)
      }

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
          proxy.uncork()
        })
      })

      function done () {
        if (file) file.storage.end = self.content.byteLength
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
        ctime: getTime(opts.ctime)
      }

      self.tree.put(name, st, function (err) {
        release(cb, err)
      })
    })
  })
}

Hyperdrive.prototype._statDirectory = function (name, cb) {
  this.tree.list(name, function (err, list) {
    if (err || !list.length) return cb(new Error(name + ' could not be found'))
    var st = stat()
    st.mode = stat.IFDIR | DEFAULT_DMODE
    cb(null, st)
  })
}

Hyperdrive.prototype.access = function (name, cb) {
  this.tree.list(name, function (err) {
    cb(err)
  })
}

Hyperdrive.prototype.exists = function (name, cb) {
  this.access(name, function (err) {
    cb(!err)
  })
}

Hyperdrive.prototype.lstat = function (name, cb) {
  var self = this

  this.tree.get(name, function (err, st) {
    if (err) return self._statDirectory(name, cb)
    cb(null, stat(st))
  })
}

Hyperdrive.prototype.stat = function (name, cb) {
  this.lstat(name, cb)
}

Hyperdrive.prototype.readdir = function (name, cb) {
  this.tree.list(name, cb)
}

Hyperdrive.prototype.unlink = function (name, cb) {
  this.tree.del(name, cb)
}

Hyperdrive.prototype.rmdir = function (name, cb) {
  var self = this

  this.readdir(name, function (err, list) {
    if (err) return cb(err)
    if (list.length) return cb(new Error('Directory is not empty'))
    self.tree.del(name, cb)
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

    var opts = {sparse: self.sparse, maxRequests: self.maxRequests}

    self.content = self._checkout ? self._checkout.content : hypercore(self._storages.content, index.content, opts)
    self.content.ready(function (err) {
      if (err) return cb(err)
      self.emit('content')
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

      self.version = tree.version
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

    if (!self.content) self.content = hypercore(self._storages.content, {sparse: self.sparse})

    self.content.ready(function () {
      if (self.metadata.has(0)) return cb(new Error('Index already written'))
      self.metadata.append(messages.Index.encode({type: 'hyperdrive', content: self.content.key}), function (err) {
        if (err) return cb(err)
        if (self.version === -1) self.version = 0 // TODO: perhaps fix in append-tree?
        cb()
      })
    })
  }
}

function isObject (val) {
  return !!val && typeof val !== 'string' && !Buffer.isBuffer(val)
}

function wrap (self, storage) {
  return {
    metadata: function (name) {
      return storage.metadata(name, self)
    },
    content: function (name) {
      return storage.content(name, self)
    }
  }
}

function defaultStorage (self, storage, opts) {
  var folder = ''

  if (typeof storage === 'object' && storage) return wrap(self, storage)

  if (typeof storage === 'string') {
    folder = storage + '/'
    storage = raf
  }

  return {
    metadata: function (name) {
      return storage(folder + 'metadata/' + name)
    },
    content: function (name) {
      return storage(folder + 'content/' + name)
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

function ignoreWrite (offset, data, cb) {
  cb(null)
}
