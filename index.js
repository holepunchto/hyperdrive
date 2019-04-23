const path = require('path')
const { EventEmitter } = require('events')

const collect = require('stream-collector')
const thunky = require('thunky')
const unixify = require('unixify')
const mutexify = require('mutexify')
const duplexify = require('duplexify')
const through = require('through2')
const pumpify = require('pumpify')
const pump = require('pump')

const hypercore = require('hypercore')
const hypertrie = require('hypertrie')
const coreByteStream = require('hypercore-byte-stream')

const createFileDescriptor = require('./lib/fd')
const Stat = require('./lib/stat')
const errors = require('./lib/errors')
const messages = require('./lib/messages')
const defaultStorage = require('./lib/storage')
const { contentKeyPair, contentOptions } = require('./lib/content')

// 20 is arbitrary, just to make the fds > stdio etc
const STDIO_CAP = 20

module.exports = (...args) => new Hyperdrive(...args)
module.exports.constants = require('filesystem-constants').linux

class Hyperdrive extends EventEmitter {
  constructor (storage, key, opts) {
    super()

    if (isObject(key)) {
      opts = key
      key = null
    }
    if (!opts) opts = {}

    this.key = null
    this.discoveryKey = null
    this.live = true
    this.latest = !!opts.latest
    this.sparse = !!opts.sparse
    this.sparseMetadata = !!opts.sparseMetadata

    this._factory = opts.factory ? storage : null
    this._storages = !this.factory ? defaultStorage(this, storage, opts) : null

    this.metadata = opts.metadata || this._createHypercore(this._storages.metadata, key, {
      secretKey: opts.secretKey,
      sparse: this.sparseMetadata,
      createIfMissing: opts.createIfMissing,
      storageCacheSize: opts.metadataStorageCacheSize,
      valueEncoding: 'binary'
    })
    this._db = opts._db
    this.content = opts.content || null
    this.storage = storage
    this.contentStorageCacheSize = opts.contentStorageCacheSize

    this._contentOpts = null
    this._contentFeedLength = null
    this._contentFeedByteLength = null
    this._lock = mutexify()
    this._fds = []
    this._writingFd = null

    this.ready = thunky(this._ready.bind(this))
    this.contentReady = thunky(this._contentReady.bind(this))

    this.ready(onReady)
    this.contentReady(onContentReady)

    const self = this

    function onReady (err) {
      if (err) return self.emit('error', err)
      self.emit('ready')
    }

    function onContentReady (err) {
      if (err) return self.emit('error', err)
      self.emit('content')
    }
  }

  _createHypercore (storage, key, opts) {
    if (this._factory) return this._factory(key, opts)
    return hypercore(storage, key, opts)
  }

  get version () {
    // TODO: The trie version starts at 1, so the empty hyperdrive version is also 1. This should be 0.
    return this._db.version
  }

  get writable () {
    return this.metadata.writable && this.content.writable
  }

  _ready (cb) {
    const self = this

    this.metadata.on('error', onerror)
    this.metadata.on('append', update)

    this.metadata.ready(err => {
      if (err) return cb(err)

      if (this.sparseMetadata) {
        this.metadata.update(function loop () {
          self.metadata.update(loop)
        })
      }

      this._contentKeyPair = this.metadata.secretKey ? contentKeyPair(this.metadata.secretKey) : {}
      this._contentOpts = contentOptions(this, this._contentKeyPair.secretKey)
      this._contentOpts.keyPair = this._contentKeyPair

      /**
       * If a db is provided as input, ensure that a contentFeed is also provided, then return (this is a checkout).
       * If the metadata feed is writable:
       *    If the metadata feed has length 0, then the db should be initialized with the content feed key as metadata.
       *    Else, initialize the db without metadata and load the content feed key from the header.
       * If the metadata feed is readable:
       *    Initialize the db without metadata and load the content feed key from the header.
       */
      if (this._db) {
        if (!this.content || !this.metadata) return cb(new Error('Must provide a db and both content/metadata feeds'))
        return done(null)
      } else if (this.metadata.writable && !this.metadata.length) {
        initialize(this._contentKeyPair)
      } else {
        restore(this._contentKeyPair)
      }
    })

    /**
     * The first time the hyperdrive is created, we initialize both the db (metadata feed) and the content feed here.
     */
    function initialize (keyPair) {
      self._ensureContent(keyPair.publicKey, err => {
        if (err) return cb(err)
        self._db = hypertrie(null, {
          feed: self.metadata,
          metadata: self.content.key
        })

        self._db.ready(function (err) {
          if (err) return cb(err)
          return done(null)
        })
      })
    }

    /**
     * If the hyperdrive has already been created, wait for the db (metadata feed) to load.
     * If the metadata feed is writable, we can immediately load the content feed from its private key.
     * (Otherwise, we need to read the feed's metadata block first)
     */
    function restore (keyPair) {
      self._db = hypertrie(null, {
        feed: self.metadata
      })
      if (self.metadata.writable) {
        self._db.ready(err => {
          if (err) return done(err)
          self._ensureContent(null, done)
        })
      } else {
        self._db.ready(done)
      }
    }

    function done (err) {
      if (err) return cb(err)
      self.key = self.metadata.key
      self.discoveryKey = self.metadata.discoveryKey
      return cb(null)
    }

    function onerror (err) {
      if (err) self.emit('error', err)
    }

    function update () {
      self.emit('update')
    }
  }

  _ensureContent (publicKey, cb) {
    let self = this

    if (publicKey) return onkey(publicKey)
    else loadkey()

    function loadkey () {
      self._db.getMetadata((err, contentKey) => {
        if (err) return cb(err)
        return onkey(contentKey)
      })
    }

    function onkey (publicKey) {
      self.content = self._createHypercore(self._storages.content, publicKey, self._contentOpts)
      self.content.ready(err => {
        if (err) return cb(err)

        self._contentFeedByteLength = self.content.byteLength
        self._contentFeedLength = self.content.length

        self.content.on('error', err => self.emit('error', err))
        return cb(null)
      })
    }
  }

  _contentReady (cb) {
    this.ready(err => {
      if (err) return cb(err)
      if (this.content) return cb(null)
      this._ensureContent(null, cb)
    })
  }

  _update (name, stat, cb) {
    name = unixify(name)

    this._db.get(name, (err, st) => {
      if (err) return cb(err)
      if (!st) return cb(new errors.FileNotFound(name))
      try {
        var decoded = messages.Stat.decode(st.value)
        const newStat = Object.assign(decoded, stat)
        var encoded = messages.Stat.encode(newStat)
      } catch (err) {
        return cb(err)
      }
      this._db.put(name, encoded, err => {
        if (err) return cb(err)
        return cb(null)
      })
    })
  }

  open (name, flags, cb) {
    name = unixify(name)

    createFileDescriptor(this, name, flags, (err, fd) => {
      if (err) return cb(err)
      cb(null, STDIO_CAP + this._fds.push(fd) - 1)
    })
  }

  read (fd, buf, offset, len, pos, cb) {
    if (typeof pos === 'function') {
      cb = pos
      pos = null
    }

    const desc = this._fds[fd - STDIO_CAP]
    if (!desc) return process.nextTick(cb, new errors.BadFileDescriptor(`Bad file descriptor: ${fd}`))
    if (pos == null) pos = desc.position
    desc.read(buf, offset, len, pos, cb)
  }

  write (fd, buf, offset, len, pos, cb) {
    if (typeof pos === 'function') {
      cb = pos
      pos = null
    }

    const desc = this._fds[fd - STDIO_CAP]
    if (!desc) return process.nextTick(cb, new errors.BadFileDescriptor(`Bad file descriptor: ${fd}`))
    if (pos == null) pos = desc.position
    desc.write(buf, offset, len, pos, cb)
  }

  createReadStream (name, opts) {
    if (!opts) opts = {}

    name = unixify(name)

    const length = typeof opts.end === 'number' ? 1 + opts.end - (opts.start || 0) : typeof opts.length === 'number' ? opts.length : -1
    const stream = coreByteStream({
      ...opts,
      highWaterMark: opts.highWaterMark || 64 * 1024
    })

    this.contentReady(err => {
      if (err) return stream.destroy(err)

      this._db.get(name, (err, st) => {
        if (err) return stream.destroy(err)
        if (!st) return stream.destroy(new errors.FileNotFound(name))

        try {
          st = messages.Stat.decode(st.value)
        } catch (err) {
          return stream.destroy(err)
        }

        const byteOffset = opts.start ? st.byteOffset + opts.start : st.byteOffset
        const byteLength = length !== -1 ? length : (opts.start ? st.size - opts.start : st.size)

        stream.start({
          feed: this.content,
          blockOffset: st.offset,
          blockLength: st.blocks,
          byteOffset,
          byteLength
        })
      })
    })

    return stream
  }

  createDiffStream (other, prefix, opts) {
    if (other instanceof Hyperdrive) other = other.version
    if (typeof prefix === 'object') return this.createDiffStream(other, '/', prefix)
    prefix = prefix || '/'

    const proxy = duplexify.obj()
    proxy.setWritable(false)

    this.ready(err => {
      if (err) return proxy.destroy(err)

      const decoder = through.obj((chunk, enc, cb) => {
        let obj = { type: !chunk.left ? 'del' : 'put', name: chunk.key }
        if (chunk.left) {
          try {
            obj.stat = messages.Stat.decode(chunk.left.value)
          } catch (err) {
            return cb(err)
          }
        }
        return cb(null, obj)
      })
      proxy.setReadable(pumpify.obj(this._db.createDiffStream(other, prefix, opts), decoder))
    })

    return proxy
  }

  createDirectoryStream (name, opts) {
    if (!opts) opts = {}

    name = unixify(name)

    const proxy = duplexify.obj()
    proxy.setWritable(false)

    this.ready(err => {
      if (err) return
      const stream = pump(
        this._db.createReadStream(name, opts),
        through.obj((chunk, enc, cb) => {
          try {
            var stat = messages.Stat.decode(chunk.value)
          } catch (err) {
            return cb(err)
          }
          return cb(null, {
            path: chunk.key,
            stat: new Stat(stat)
          })
        })
      )
      proxy.setReadable(stream)
    })

    return proxy
  }

  createWriteStream (name, opts) {
    if (!opts) opts = {}
    name = unixify(name)

    const self = this
    var release

    const proxy = duplexify()
    proxy.setReadable(false)

    // TODO: support piping through a "split" stream like rabin

    this.contentReady(err => {
      if (err) return proxy.destroy(err)
      this._lock(_release => {
        release = _release
        append()
      })
    })

    return proxy

    function append (err) {
      if (err) return proxy.destroy(err)
      if (proxy.destroyed) return release()

      const byteOffset = self.content.byteLength
      const offset = self.content.length

      self.emit('appending', name, opts)

      // TODO: revert the content feed if this fails!!!! (add an option to the write stream for this (atomic: true))
      const stream = self.content.createWriteStream()

      proxy.on('close', ondone)
      proxy.on('finish', ondone)

      proxy.setWritable(stream)
      proxy.on('prefinish', function () {
        const stat = Stat.file({
          ...opts,
          offset,
          byteOffset,
          size: self.content.byteLength - byteOffset,
          blocks: self.content.length - offset
        })

        try {
          var encoded = messages.Stat.encode(stat)
        } catch (err) {
          return proxy.destroy(err)
        }

        proxy.cork()
        self._db.put(name, encoded, function (err) {
          if (err) return proxy.destroy(err)
          self.emit('append', name, opts)
          proxy.uncork()
        })
      })
    }

    function ondone () {
      proxy.removeListener('close', ondone)
      proxy.removeListener('finish', ondone)
      self._contentFeedLength = self.content.length
      self._contentFeedByteLength = self.content.byteLength
      release()
    }
  }

  create (name, opts, cb) {
    if (typeof opts === 'function') return this.create(name, null, opts)

    name = unixify(name)

    this.ready(err => {
      if (err) return cb(err)
      this.lstat(name, (err, stat) => {
        if (err && err.errno !== 2) return cb(err)
        if (stat) return cb(null, stat)
        try {
          var st = Stat.file(opts)
          var buf = messages.Stat.encode(st)
        } catch (err) {
          return cb(err)
        }
        this._db.put(name, buf, err => {
          if (err) return cb(err)
          return cb(null, st)
        })
      })
    })
  }

  readFile (name, opts, cb) {
    if (typeof opts === 'function') return this.readFile(name, null, opts)
    if (typeof opts === 'string') opts = {encoding: opts}
    if (!opts) opts = {}

    name = unixify(name)

    collect(this.createReadStream(name, opts), function (err, bufs) {
      if (err) return cb(err)
      let buf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs)
      cb(null, opts.encoding && opts.encoding !== 'binary' ? buf.toString(opts.encoding) : buf)
    })
  }

  writeFile (name, buf, opts, cb) {
    if (typeof opts === 'function') return this.writeFile(name, buf, null, opts)
    if (typeof opts === 'string') opts = {encoding: opts}
    if (!opts) opts = {}
    if (typeof buf === 'string') buf = Buffer.from(buf, opts.encoding || 'utf-8')
    if (!cb) cb = noop

    name = unixify(name)

    let stream = this.createWriteStream(name, opts)
    stream.on('error', cb)
    stream.on('finish', cb)
    stream.end(buf)
  }

  truncate (name, size, cb) {
    name = unixify(name)

    this.contentReady(err => {
      if (err) return cb(err)
      this.lstat(name, (err, st) => {
        if (err && err.errno !== 2) return cb(err)
        if (!st) return this.create(name, cb)
        if (size === st.size) return cb(null)
        if (size < st.size) {
          const readStream = this.createReadStream(name, { length: size })
          const writeStream = this.createWriteStream(name)
          return pump(readStream, writeStream, cb)
        } else {
          this.open(name, 'a', (err, fd) => {
            if (err) return cb(err)
            const length = size - st.size
            this.write(fd, Buffer.alloc(length), 0, length, st.size, err => {
              if (err) return cb(err)
              this.close(fd, cb)
            })
          })
        }
      })
    })
  }

  mkdir (name, opts, cb) {
    if (typeof opts === 'function') return this.mkdir(name, null, opts)
    if (typeof opts === 'number') opts = {mode: opts}
    if (!opts) opts = {}
    if (!cb) cb = noop

    name = unixify(name)

    this.contentReady(err => {
      if (err) return cb(err)
      try {
        var st = messages.Stat.encode(Stat.directory({
          ...opts,
          offset: this._contentFeedLength,
          byteOffset: this._contentFeedByteLength
        }))
      } catch (err) {
        return cb(err)
      }
      this._db.put(name, st, {
        condition: ifNotExists
      }, cb)
    })
  }

  _statDirectory (name, opts, cb) {
    const ite = this._db.iterator(name)
    ite.next((err, st) => {
      if (err) return cb(err)
      if (name !== '/' && !st) return cb(new errors.FileNotFound(name))
      if (name === '/') return cb(null, Stat.directory())
      try {
        st = messages.Stat.decode(st.value)
      } catch (err) {
        return cb(err)
      }
      return cb(null, Stat.directory(st))
    })
  }

  lstat (name, opts, cb) {
    if (typeof opts === 'function') return this.lstat(name, null, opts)
    if (!opts) opts = {}
    name = unixify(name)

    this.ready(err => {
      if (err) return cb(err)

      this._db.get(name, opts, (err, node) => {
        if (err) return cb(err)
        if (!node) return this._statDirectory(name, opts, cb)
        try {
          var st = messages.Stat.decode(node.value)
        } catch (err) {
          return cb(err)
        }
        if (this._writingFd && name === this._writingFd.path) {
          st.size = this._writingFd.stat.size
        }
        cb(null, new Stat(st))
      })
    })
  }

  stat (name, opts, cb) {
    if (typeof opts === 'function') return this.stat(name, null, opts)
    if (!opts) opts = {}

    this.lstat(name, opts, cb)
  }

  access (name, opts, cb) {
    if (typeof opts === 'function') return this.access(name, null, opts)
    if (!opts) opts = {}
    name = unixify(name)

    this.stat(name, opts, err => {
      cb(err)
    })
  }

  exists (name, opts, cb) {
    if (typeof opts === 'function') return this.exists(name, null, opts)
    if (!opts) opts = {}

    this.access(name, opts, err => {
      cb(!err)
    })
  }

  readdir (name, opts, cb) {
    if (typeof opts === 'function') return this.readdir(name, null, opts)

    name = unixify(name)
    if (name !== '/' && name.startsWith('/')) name = name.slice(1)

    const recursive = !!(opts && opts.recursive)

    this._db.list(name, { gt: true, recursive }, (err, list) => {
      if (err) return cb(err)
      return cb(null, list.map(st => {
        if (name === '/') return st.key.split('/')[0]
        return path.relative(name, st.key).split('/')[0]
      }))
    })
  }

  _del (name, cb) {
    this.ready(err => {
      if (err) return cb(err)
      this._db.del(name, (err, node) => {
        if (err) return cb(err)
        if (!node) return cb(new errors.FileNotFound(name))
        return cb(null)
      })
    })
  }

  unlink (name, cb) {
    name = unixify(name)
    this._del(name, cb || noop)
  }

  rmdir (name, cb) {
    if (!cb) cb = noop
    name = unixify(name)

    const self = this

    let stream = this._db.iterator(name)
    stream.next((err, val) => {
      if (err) return cb(err)
      if (val) return cb(new errors.DirectoryNotEmpty(name))
      self._del(name, cb)
    })
  }

  replicate (opts) {
    if (!opts) opts = {}
    opts.expectedFeeds = 2

    const stream = this.metadata.replicate(opts)

    this.contentReady(err => {
      if (err) return stream.destroy(err)
      if (stream.destroyed) return
      this.content.replicate({
        live: opts.live,
        download: opts.download,
        upload: opts.upload,
        stream: stream
      })
    })

    return stream
  }

  checkout (version, opts) {
    opts = {
      ...opts,
      metadata: this.metadata,
      content: this.content,
      _db: this._db.checkout(version)
    }
    return new Hyperdrive(this.storage, this.key, opts)
  }

  _closeFile (fd, cb) {
    const desc = this._fds[fd - STDIO_CAP]
    if (!desc) return process.nextTick(cb, new Error('Invalid file descriptor'))
    this._fds[fd - STDIO_CAP] = null
    while (this._fds.length && !this._fds[this._fds.length - 1]) this._fds.pop()
    desc.close(cb)
  }

  close (fd, cb) {
    if (typeof fd === 'number') return this._closeFile(fd, cb || noop)
    else cb = fd
    if (!cb) cb = noop

    this.ready(err => {
      if (err) return cb(err)
      this.metadata.close(err => {
        if (!this.content) return cb(err)
        this.content.close(cb)
      })
    })
  }

  watch (name, onchange) {
    name = unixify(name)
    return this._db.watch(name, onchange)
  }
}

function isObject (val) {
  return !!val && typeof val !== 'string' && !Buffer.isBuffer(val)
}

function ifNotExists (oldNode, newNode, cb) {
  if (oldNode) return cb(new errors.PathAlreadyExists(oldNode.key))
  return cb(null, true)
}

function noop () {}
