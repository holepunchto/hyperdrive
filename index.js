const path = require('path')
const { EventEmitter } = require('events')

const collect = require('stream-collector')
const thunky = require('thunky')
const unixify = require('unixify')
const raf = require('random-access-file')
const mutexify = require('mutexify')
const duplexify = require('duplexify')
const sodium = require('sodium-universal')

const hypercore = require('hypercore')
const hypertrie = require('hypertrie')
const coreByteStream = require('hypercore-byte-stream')

const Stat = require('./lib/stat')
const errors = require('./lib/errors')
const messages = require('./lib/messages')

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

    this._storages = defaultStorage(this, storage, opts)

    this.metadataFeed = opts.metatadataFeed || hypercore(this._storages.metadata, key, {
      secretKey: opts.secretKey,
      sparse: opts.sparseMetadata,
      createIfMissing: opts.createIfMissing,
      storageCacheSize: opts.metadataStorageCacheSize,
      valueEncoding: 'binary'
    })
    this.trie = opts.trie
    this.contentFeed = opts.contentFeed || null
    this.storage = storage

    this._checkout = opts._checkout
    this._contentOpts = null
    this._lock = mutexify()

    this.ready = thunky(this._ready.bind(this))
    this.contentReady = thunky(this._contentReady.bind(this))

    this.ready(onReady)
    this.contentReady(onContentReady)

    var self = this

    function onReady (err) {
      if (err) return self.emit('error', err)
      self.emit('ready')
      /*
      if (self.latest && !self.metadata.writable) {
        self._trackLatest(function (err) {
          if (self._closed) return
          onerror(err)
        })
      }
      */
    }

    function onContentReady (err) {
      if (err) return self.emit('error', err)
      self.emit('content')
    }
  }

  get version () {
    return this._checkout ? this.trie.version : (this.metadataFeed.length ? this.metadataFeed.length - 1 : 0)
  }

  get writable () {
    return this.metadataFeed.writable && this.contentFeed.writable
  }

  _ready (cb) {
    var self = this

    this.metadataFeed.on('error', onerror)
    this.metadataFeed.on('append', update)

    this.metadataFeed.ready(err => {
      if (err) return cb(err)

      var keyPair = this.metadataFeed.secretKey ? contentKeyPair(this.metadataFeed.secretKey) : {}
      this._contentOpts = contentOptions(this, keyPair.secretKey)

      /**
       * If a trie is provided as input, ensure that a contentFeed is also provided, then return (this is a checkout).
       * If the metadata feed is writable:
       *    If the metadata feed has length 0, then the trie should be initialized with the content feed key as metadata.
       *    Else, initialize the trie without metadata and load the content feed key from the header.
       * If the metadata feed is readable:
       *    Initialize the trie without metadata and load the content feed key from the header.
       */
      if (this.trie) {
        if (!this.contentFeed || !this.metadataFeed) return cb(new Error('Must provide a trie and both content/metadata feeds'))
        return done(null)
      } else if (this.metadataFeed.writable && !this.metadataFeed.length) {
        initialize(keyPair)
      } else {
        restore(keyPair)
      }
    })

    /**
     * The first time the hyperdrive is created, we initialize both the trie (metadata feed) and the content feed here.
     */
    function initialize (keyPair) {
      self.contentFeed = hypercore(self._storages.content, keyPair.publicKey, self._contentOpts)
      self.contentFeed.on('error', function (err) {
        self.emit('error', err)
      })
      self.contentFeed.ready(function (err) {
        if (err) return cb(err)

        self.trie = hypertrie(null, {
          feed: self.metadataFeed,
          metadata: self.contentFeed.key,
          valueEncoding: messages.Stat
        })

        self.trie.ready(function (err) {
          if (err) return cb(err)
          return done(null)
        })
      })
    }

    /**
     * If the hyperdrive has already been created, wait for the trie (metadata feed) to load.
     * If the metadata feed is writable, we can immediately load the content feed from its private key.
     * (Otherwise, we need to read the feed's metadata block first)
     */
    function restore (keyPair) {
      self.trie = hypertrie(null, {
        feed: self.metadataFeed,
        valueEncoding: messages.Stat
      })
      if (self.metadataFeed.writable) {
        self.trie.ready(err => {
          if (err) return done(err)
          self._ensureContent(done)
        })
      } else {
        self.trie.ready(done)
      }
    }

    function done (err) {
      if (err) return cb(err)
      self.key = self.metadataFeed.key
      self.discoveryKey = self.metadataFeed.discoveryKey
      return cb(null)
    }

    function onerror (err) {
      if (err) self.emit('error', err)
    }

    function update () {
      self.emit('update')
    }
  }

  _ensureContent (cb) {
    this.trie.getMetadata((err, contentKey) => {
      if (err) return cb(err)

      this.contentFeed = hypercore(this._storages.content, contentKey, this._contentOpts)
      this.contentFeed.ready(err => {
        if (err) return cb(err)

        this.contentFeed.on('error', err => this.emit('error', err))
        return cb(null)
      })
    })
  }

  _contentReady (cb) {
    this.ready(err => {
      if (err) return cb(err)
      this._ensureContent(cb)
    })
  }

  createReadStream (name, opts) {
    if (!opts) opts = {}

    name = unixify(name)

    var stream = coreByteStream({
      ...opts,
      highWaterMark: opts.highWaterMark || 64 * 1024 
    })

    this.contentReady(err => {
      if (err) return stream.destroy(err)

      this.trie.get(name, (err, st) => {
        if (err) return stream.destroy(err)
        if (!st) return stream.destroy(new errors.FileNotFound(name))

        st = st.value

        var byteOffset = (opts.start) ? st.byteOffset + opts.start : st.byteOffset
        var byteLength = (opts.start) ? st.size - opts.start : st.size

        stream.start({
          feed: this.contentFeed,
          blockOffset: st.offset,
          blockLength: st.blocks,
          byteOffset,
          byteLength
        })
      })
    })

    return stream
  }

  createWriteStream (name,  opts) {
    if (!opts) opts = {}

    name = unixify(name)

    var self = this
    var proxy = duplexify()
    var release = null
    proxy.setReadable(false)

    // TODO: support piping through a "split" stream like rabin

    this.contentReady(err => {
      if (err) return proxy.destroy(err)
      this._lock(_release => {
        release = _release
        this.trie.get(name, (err, st) => {
          if (err) return proxy.destroy(err)
          if (!st) return append(null)
          this.contentFeed.clear(st.offset, st.offset + st.blocks, append)
        })
      })
    })

    return proxy

    function append (err) {
      if (err) proxy.destroy(err)
      if (proxy.destroyed) return release()

      // No one should mutate the content other than us
      var byteOffset = self.contentFeed.byteLength
      var offset = self.contentFeed.length

      self.emit('appending', name, opts)

      // TODO: revert the content feed if this fails!!!! (add an option to the write stream for this (atomic: true))
      var stream = self.contentFeed.createWriteStream()

      proxy.on('close', done)
      proxy.on('finish', done)

      proxy.setWritable(stream)
      proxy.on('prefinish', function () {
        var st = Stat.file({
          ...opts,
          size: self.contentFeed.byteLength - byteOffset,
          blocks: self.contentFeed.length - offset,
          offset: offset,
          byteOffset: byteOffset,
        })

        proxy.cork()
        self.trie.put(name, st, function (err) {
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
  }

  readFile (name, opts, cb) {
    if (typeof opts === 'function') return this.readFile(name, null, opts)
    if (typeof opts === 'string') opts = {encoding: opts}
    if (!opts) opts = {}

    name = unixify(name)

    collect(this.createReadStream(name, opts), function (err, bufs) {
      if (err) return cb(err)
      var buf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs)
      cb(null, opts.encoding && opts.encoding !== 'binary' ? buf.toString(opts.encoding) : buf)
    })
  }

  writeFile (name, buf, opts, cb) {
    if (typeof opts === 'function') return this.writeFile(name, buf, null, opts)
    if (typeof opts === 'string') opts = {encoding: opts}
    if (!opts) opts = {}
    if (typeof buf === 'string') buf = new Buffer(buf, opts.encoding || 'utf-8')
    if (!cb) cb = noop

    name = unixify(name)

    var bufs = split(buf) // split the input incase it is a big buffer.
    var stream = this.createWriteStream(name, opts)
    stream.on('error', cb)
    stream.on('finish', cb)
    for (var i = 0; i < bufs.length; i++) stream.write(bufs[i])
    stream.end()
  }

  mkdir (name, opts, cb) {
    if (typeof opts === 'function') return this.mkdir(name, null, opts)
    if (typeof opts === 'number') opts = {mode: opts}
    if (!opts) opts = {}
    if (!cb) cb = noop

    name = unixify(name)

    this.ready(err => {
      if (err) return cb(err)

      this._lock(release => {
        var st = Stat.directory({
          ...opts,
          offset: this.contentFeed.length,
          byteOffset: this.contentFeed.byteLength
        })
        this.trie.put(name, st, err => {
          release(cb, err)
        })
      })
    })
  }

  _statDirectory (name, opts, cb) {
    var ite = this.trie.iterator(name)
    ite.next((err, st) => {
      if (err) return cb(err)
      if (name !== '/' && !st) return cb(new errors.FileNotFound(name))
      st = Stat.directory()
      return cb(null, st)
    })
  }

  lstat (name, opts, cb) {
    if (typeof opts === 'function') return this.lstat(name, null, opts)
    if (!opts) opts = {}
    name = unixify(name)

    this.ready(err => {
      if (err) return cb(err)

      this.trie.get(name, opts, (err, node) => {
        if (err) return cb(err)
        if (!node) return this._statDirectory(name, opts, cb)
        cb(null, new Stat(node.value))
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

    return this.trie.list(name, opts, cb)
  }

  _del (name, cb) {
    var _release = null
    var self = this

    this.contentReady(err => {
      if (err) return cb(err)
      this._lock(release => {
        _release = release
        this.trie.get(name, (err, node) => {
          if (err) return done(err)
          var st = node.value
          this.contentFeed.clear(st.offset, st.offset + st.blocks, del)
        })
      })
    })

    function del (err) {
      if (err) return done(err)
      self.trie.del(name, done)
    }

    function done (err) {
      _release(cb, err)
    }
  }

  unlink (name, cb) {
    name = unixify(name)

    this._del(name, cb || noop)
  }

  rmdir (name, cb) {
    if (!cb) cb = noop
    name = unixify(name)

    this.readdir(name, function (err, list) {
      if (err) return cb(err)
      if (list.length) return cb(new errors.DirectoryNotEmpty(name))
      self._del(name, cb)
    })
  }

  replicate (opts) {
    if (!opts) opts = {}
    opts.expectedFeeds = 2

    var stream = this.metadataFeed.replicate(opts)

    this.contentReady(err => {
      if (err) return stream.destroy(err)
      if (stream.destroyed) return
      this.contentFeed.replicate({
        live: opts.live,
        download: opts.download,
        upload: opts.upload,
        stream: stream
      })
    })

    return stream
  }

  checkout (version, opts) {
    var versionedTrie = this.trie.checkout(version) 
    opts = {
      ...opts,
      metadataFeed: this.metadataFeed,
      contentFeed: this.contentFeed,
      trie: versionedTrie,
    }
    return new Hyperdrive(this.storage, this.key, opts)
  }

  _closeFile (fd, cb) {
    // TODO: implement
    process.nextTick(cb, null)
  }

  close (fd, cb) {
    if (typeof fd === 'number') return this._closeFile(fd, cb || noop)
    else cb = fd
    if (!cb) cb = noop

    this.contentReady(err => {
      if (err) return cb(err)
      this.metadataFeed.close(err => {
        if (!this.contentFeed) return cb(err)
        this.contentFeed.close(cb)
      })
    })
  }
}

module.exports = Hyperdrive

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

function contentOptions (self, secretKey) {
  return {
    sparse: self.sparse || self.latest,
    maxRequests: self.maxRequests,
    secretKey: secretKey,
    storeSecretKey: false,
    indexing: self.metadataFeed.writable && self.indexing,
    storageCacheSize: self.contentStorageCacheSize
  }
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

function split (buf) {
  var list = []
  for (var i = 0; i < buf.length; i += 65536) {
    list.push(buf.slice(i, i + 65536))
  }
  return list
}

function noop () {}
