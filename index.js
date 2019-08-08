const path = require('path').posix
const { EventEmitter } = require('events')

const collect = require('stream-collector')
const thunky = require('thunky')
const unixify = require('unixify')
const duplexify = require('duplexify')
const through = require('through2')
const pump = require('pump')

const { Corestore } = require('corestore')
const coreByteStream = require('hypercore-byte-stream')
const MountableHypertrie = require('mountable-hypertrie')

const createFileDescriptor = require('./lib/fd')
const Stat = require('./lib/stat')
const errors = require('./lib/errors')
const defaultCorestore = require('./lib/storage')
const { contentKeyPair, contentOptions, ContentState } = require('./lib/content')
const { createStatStream, createMountStream } = require('./lib/iterator')

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

    this.opts = opts
    this.key = null
    this.discoveryKey = null
    this.live = true
    this.sparse = opts.sparse !== false
    this.sparseMetadata = opts.sparseMetadata !== false

    this._corestore = defaultCorestore(storage, {
      ...opts,
      valueEncoding: 'binary',
      // TODO: Support mixed sparsity.
      sparse: this.sparse || this.sparseMetadata,
      extensions: opts.extensions
    })

    const metadataOpts = {
      key,
      sparse: this.sparseMetadata,
      secretKey: (opts.keyPair) ? opts.keyPair.secretKey : opts.secretKey,
      extensions: opts.extensions
    }

    if (storage instanceof Corestore && storage.isDefaultSet()) {
      this.metadata = this._corestore.get({
        ...metadataOpts,
        discoverable: true
      })
    } else {
      this.metadata = this._corestore.default(metadataOpts)
    }

    this._db = opts._db || new MountableHypertrie(this._corestore, key, {
      feed: this.metadata,
      sparse: this.sparseMetadata
    })
    this._db.on('feed', feed => this.emit('metadata-feed', feed))

    this._contentStates = new Map()
    if (opts._content) this._contentStates.set(this._db, new ContentState(opts._content))

    this._fds = []
    this._writingFds = new Map()

    this.ready = thunky(this._ready.bind(this))
    this.ready(onReady)

    const self = this

    function onReady (err) {
      if (err) return self.emit('error', err)
      self.emit('ready')
    }
  }

  get version () {
    // TODO: The trie version starts at 1, so the empty hyperdrive version is also 1. This should be 0.
    return this._db.version
  }

  get writable () {
    return this.metadata.writable
  }

  get contentWritable () {
    const contentState = this._contentStates.get(this._db)
    if (!contentState) return false
    return contentState.feed.writable
  }

  _ready (cb) {
    const self = this

    self.metadata.on('error', onerror)
    self.metadata.on('append', update)
    self.metadata.on('extension', extension)
    self.metadata.on('peer-add', peeradd)
    self.metadata.on('peer-remove', peerremove)

    return self.metadata.ready(err => {
      if (err) return cb(err)

      const rootContentKeyPair = self.metadata.secretKey ? contentKeyPair(self.metadata.secretKey) : {}

      /**
       * TODO: Update comment to reflect mounts.
       *
       * If a db is provided as input, ensure that a contentFeed is also provided, then return (this is a checkout).
       * If the metadata feed is writable:
       *    If the metadata feed has length 0, then the db should be initialized with the content feed key as metadata.
       *    Else, initialize the db without metadata and load the content feed key from the header.
       * If the metadata feed is readable:
       *    Initialize the db without metadata and load the content feed key from the header.
       */
      if (self.opts._db) {
        if (!self._contentStates.get(self.opts._db)) return cb(new Error('Must provide a db and a content feed'))
        return done(null)
      } else if (self.metadata.writable && !self.metadata.length) {
        initialize(rootContentKeyPair)
      } else {
        restore(rootContentKeyPair)
      }
    })

    /**
     * The first time the hyperdrive is created, we initialize both the db (metadata feed) and the content feed here.
     */
    function initialize (keyPair) {
      self._db.setMetadata(keyPair.publicKey)
      self._db.ready(err => {
        if (err) return cb(err)
        self._getContent(self._db, { secretKey: keyPair.secretKey }, err => {
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
      if (self.metadata.writable) {
        self._db.ready(err => {
          if (err) return done(err)
          self._getContent(self._db, { secretKey: keyPair.secretKey }, done)
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

    function extension(name, message, peer) {
      self.emit('extension', name, message, peer)
    }

    function peeradd(peer) {
      self.emit('peer-add', peer)
    }

    function peerremove(peer) {
      self.emit('peer-remove', peer)
    }
  }

  _getContent (db, opts, cb) {
    if (typeof opts === 'function') return this._getContent(db, null, opts)
    const self = this

    const existingContent = self._contentStates.get(db)
    if (existingContent) return process.nextTick(cb, null, existingContent)

    // This should be a getter.
    const mountMetadata = db._trie.feed
    const mountContentKeyPair = mountMetadata.secretKey ? contentKeyPair(mountMetadata.secretKey) : {}

    db.getMetadata((err, publicKey) => {
      if (err) return cb(err)
      return onkey(publicKey)
    })

    function onkey (publicKey) {
      const contentOpts = { key: publicKey, ...contentOptions(self, (opts && opts.secretKey) || mountContentKeyPair.secretKey) }
      const feed = self._corestore.get(contentOpts)
      feed.ready(err => {
        if (err) return cb(err)
        self.emit('content-feed', feed)
        const state = new ContentState(feed)
        self._contentStates.set(db, state)
        feed.on('error', err => self.emit('error', err))
        return cb(null, state)
      })
    }
  }

  _putStat (name, stat, opts, cb) {
    if (typeof opts === 'function') return this._putStat(name, stat, null, opts)
    try {
      var encoded = stat.encode()
    } catch (err) {
      return cb(err)
    }
    this._db.put(name, encoded, opts, err => {
      if (err) return cb(err)
      return cb(null, stat)
    })
  }

  _update (name, stat, cb) {
    name = fixName(name)

    this._db.get(name, (err, st) => {
      if (err) return cb(err)
      if (!st) return cb(new errors.FileNotFound(name))
      try {
        var decoded = Stat.decode(st.value)
      } catch (err) {
        return cb(err)
      }
      const newStat = Object.assign(decoded, stat)
      return this._putStat(name, newStat, { flags: st.flags }, cb)
    })
  }

  open (name, flags, cb) {
    name = fixName(name)

    this.ready(err => {
      if (err) return cb(err)
      createFileDescriptor(this, name, flags, (err, fd) => {
        if (err) return cb(err)
        cb(null, STDIO_CAP + this._fds.push(fd) - 1)
      })
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
    const self = this

    name = fixName(name)

    const length = typeof opts.end === 'number' ? 1 + opts.end - (opts.start || 0) : typeof opts.length === 'number' ? opts.length : -1
    const stream = coreByteStream({
      ...opts,
      highWaterMark: opts.highWaterMark || 64 * 1024
    })

    this.ready(err => {
      if (err) return stream.destroy(err)
      return this.stat(name, { file: true }, (err, st, trie) => {
        if (err) return stream.destroy(err)
        return this._getContent(trie, (err, contentState) => {
          if (err) return stream.destroy(err)
          return oncontent(st, contentState)
        })
      })
    })

    function oncontent (st, contentState) {
      if (st.mount && st.mount.hypercore) {
        var byteOffset = 0
        var blockOffset = 0
        var blockLength = st.blocks
        var feed = self._corestore.get({
          key: st.mount.key,
          sparse: self.sparse
        })
        feed.once('ready', () => self.emit('content-feed', feed))
      } else {
        blockOffset = st.offset
        blockLength = st.blocks
        byteOffset = opts.start ? st.byteOffset + opts.start : (length === -1 ? -1 : st.byteOffset)
        feed = contentState.feed
      }

      const byteLength = length

      stream.start({
        feed,
        blockOffset,
        blockLength,
        byteOffset,
        byteLength
      })
    }

    return stream
  }

  // TODO: Update when support is added to MountableHypertrie
  /*
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
  */

  createDirectoryStream (name, opts) {
    if (!opts) opts = {}
    name = fixName(name)
    return createStatStream(this, this._db, name, opts)
  }

  createWriteStream (name, opts) {
    if (!opts) opts = {}
    name = fixName(name)

    const self = this
    var release

    const proxy = duplexify()
    proxy.setReadable(false)

    // TODO: support piping through a "split" stream like rabin

    this.ready(err => {
      if (err) return proxy.destroy(err)
      this.stat(name, { trie: true }, (err, stat, trie) => {
        if (err && (err.errno !== 2)) return proxy.destroy(err)
        this._getContent(trie, (err, contentState) => {
          if (err) return proxy.destroy(err)
          if (opts.wait === false && contentState.isLocked()) return cb(new Error('Content is locked.'))
          contentState.lock(_release => {
            release = _release
            append(contentState)
          })
        })
      })
    })

    return proxy

    function append (contentState) {
      if (proxy.destroyed) return release()

      const byteOffset = contentState.feed.byteLength
      const offset = contentState.feed.length

      self.emit('appending', name, opts)

      // TODO: revert the content feed if this fails!!!! (add an option to the write stream for this (atomic: true))
      const stream = contentState.feed.createWriteStream()

      proxy.on('close', ondone)
      proxy.on('finish', ondone)

      proxy.setWritable(stream)
      proxy.on('prefinish', function () {
        const stat = Stat.file({
          ...opts,
          offset,
          byteOffset,
          size: contentState.feed.byteLength - byteOffset,
          blocks: contentState.feed.length - offset
        })
        proxy.cork()
        self._putStat(name, stat, function (err) {
          if (err) return proxy.destroy(err)
          self.emit('append', name, opts)
          proxy.uncork()
        })
      })
    }

    function ondone () {
      proxy.removeListener('close', ondone)
      proxy.removeListener('finish', ondone)
      release()
    }
  }

  create (name, opts, cb) {
    if (typeof opts === 'function') return this.create(name, null, opts)

    name = fixName(name)

    this.ready(err => {
      if (err) return cb(err)
      this.lstat(name, { file: true, trie: true }, (err, stat) => {
        if (err && err.errno !== 2) return cb(err)
        if (stat) return cb(null, stat)
        const st = Stat.file(opts)
        return this._putStat(name, st, cb)
      })
    })
  }

  readFile (name, opts, cb) {
    if (typeof opts === 'function') return this.readFile(name, null, opts)
    if (typeof opts === 'string') opts = { encoding: opts }
    if (!opts) opts = {}

    name = fixName(name)

    collect(this.createReadStream(name, opts), function (err, bufs) {
      if (err) return cb(err)
      let buf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs)
      cb(null, opts.encoding && opts.encoding !== 'binary' ? buf.toString(opts.encoding) : buf)
    })
  }

  writeFile (name, buf, opts, cb) {
    if (typeof opts === 'function') return this.writeFile(name, buf, null, opts)
    if (typeof opts === 'string') opts = { encoding: opts }
    if (!opts) opts = {}
    if (typeof buf === 'string') buf = Buffer.from(buf, opts.encoding || 'utf-8')
    if (!cb) cb = noop

    name = fixName(name)

    let stream = this.createWriteStream(name, opts)

    // TODO: Do we need to maintain the error state? What's triggering 'finish' after 'error'?
    var errored = false

    stream.on('error', err => {
      errored = true
      return cb(err)
    })
    stream.on('finish', () => {
      if (!errored) return cb(null)
    })
    stream.end(buf)
  }

  truncate (name, size, cb) {
    name = fixName(name)

    this.lstat(name, { file: true, trie: true }, (err, st) => {
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
  }

  _createStat (name, opts, cb) {
    const self = this

    const statConstructor = (opts && opts.directory) ? Stat.directory : Stat.file
    this._db.get(name, (err, node, trie) => {
      if (err) return cb(err)
      onexisting(node, trie)
    })

    function onexisting (node, trie) {
      self.ready(err => {
        if (err) return cb(err)
        self._getContent(trie, (err, contentState) => {
          if (err) return cb(err)
          const st = statConstructor({
            ...opts,
            offset: contentState.feed.length,
            byteOffset: contentState.feed.byteLength
          })
          return cb(null, st)
        })
      })
    }
  }

  mkdir (name, opts, cb) {
    if (typeof opts === 'function') return this.mkdir(name, null, opts)
    if (typeof opts === 'number') opts = { mode: opts }
    if (!opts) opts = {}
    if (!cb) cb = noop

    name = fixName(name)
    opts.directory = true

    this._createStat(name, opts, (err, st) => {
      if (err) return cb(err)
      this._putStat(name, st, {
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
        st = Stat.decode(st.value)
      } catch (err) {
        return cb(err)
      }
      return cb(null, Stat.directory(st))
    })
  }

  lstat (name, opts, cb) {
    if (typeof opts === 'function') return this.lstat(name, null, opts)
    if (!opts) opts = {}
    const self = this
    name = fixName(name)

    this.ready(err => {
      if (err) return cb(err)
      this._db.get(name, opts, onstat)
    })

    function onstat (err, node, trie) {
      if (err) return cb(err)
      if (!node && opts.trie) return cb(null, null, trie)
      if (!node && opts.file) return cb(new errors.FileNotFound(name))
      if (!node) return self._statDirectory(name, opts, cb)
      try {
        var st = Stat.decode(node.value)
      } catch (err) {
        return cb(err)
      }
      const writingFd = self._writingFds.get(name)
      if (writingFd) {
        st.size = writingFd.stat.size
      }
      cb(null, st, trie)
    }
  }

  stat (name, opts, cb) {
    if (typeof opts === 'function') return this.stat(name, null, opts)
    if (!opts) opts = {}

    this.lstat(name, opts, (err, stat, trie) => {
      if (err) return cb(err)
      if (!stat) return cb(null, null, trie, name)
      if (stat.linkname) {
        if (path.isAbsolute(stat.linkname)) return this.stat(stat.linkname, opts, cb)
        const relativeStat = path.resolve('/', path.dirname(name), stat.linkname)
        return this.stat(relativeStat, opts, cb)
      }
      return cb(null, stat, trie, name)
    })
  }

  access (name, opts, cb) {
    if (typeof opts === 'function') return this.access(name, null, opts)
    if (!opts) opts = {}
    name = fixName(name)

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
    name = fixName(name)

    const recursive = !!(opts && opts.recursive)

    const nameStream = pump(
      createStatStream(this, this._db, name, { ...opts, recursive }),
      through.obj(({ path: statPath, stat }, enc, cb) => {
        const relativePath = (name === statPath) ? statPath : path.relative(name, statPath)
        if (relativePath === name) return cb(null)
        if (recursive) return cb(null, relativePath)
        return cb(null, relativePath.split('/')[0])
      })
    )
    return collect(nameStream, (err, entries) => {
      if (err) return cb(err)
      return cb(null, entries)
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
    name = fixName(name)
    this._del(name, cb || noop)
  }

  rmdir (name, cb) {
    if (!cb) cb = noop
    name = fixName(name)

    const self = this

    let stream = this._db.iterator(name, { gt: true })
    stream.next((err, val) => {
      if (err) return cb(err)
      if (val) return cb(new errors.DirectoryNotEmpty(name))
      self._del(name, cb)
    })
  }

  replicate (opts) {
    return this._corestore.replicate(opts)
  }

  checkout (version, opts) {
    const db = this._db.checkout(version)
    opts = {
      ...opts,
      _db: db,
      _content: this._contentStates.get(this._db)
    }
    return new Hyperdrive(this._corestore, this.key, opts)
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
      return this._corestore.close((err) => {
        this.emit('close')
        cb(err)
      })
    })
  }

  watch (name, onchange) {
    name = fixName(name)
    return this._db.watch(name, onchange)
  }

  mount (path, key, opts, cb) {
    if (typeof opts === 'function') return this.mount(path, key, null, opts)
    const self = this

    path = fixName(path)
    opts = opts || {}

    const statOpts = {
      uid: opts.uid,
      gid: opts.gid
    }
    statOpts.mount = {
      key,
      version: opts.version,
      hash: opts.hash,
      hypercore: !!opts.hypercore
    }
    statOpts.directory = !opts.hypercore

    if (opts.hypercore) {
      const core = this._corestore.get({
        key,
        ...opts,
        sparse: this.sparse
      })
      core.ready(err => {
        if (err) return cb(err)
        this.emit('content-feed', core)
        statOpts.size = core.byteLength
        statOpts.blocks = core.length
        return mountCore()
      })
    } else {
      return process.nextTick(mountTrie, null)
    }

    function mountCore () {
      self._createStat(path, statOpts, (err, st) => {
        if (err) return cb(err)
        return self._db.put(path, st.encode(), cb)
      })
    }

    function mountTrie () {
      self._createStat(path, statOpts, (err, st) => {
        if (err) return cb(err)
        self._db.mount(path, key, { ...opts, value: st.encode() }, err => {
          if (err) return cb(err)
          return self._db.loadMount(path, cb)
        })
      })
    }
  }

  unmount (path, cb) {
    this.stat(path, (err, st) => {
      if (err) return cb(err)
      if (!st.mount) return cb(new Error('Can only unmount mounts.'))
      if (st.mount.hypercore) {
        return this.unlink(path, cb)
      } else {
        return this._db.unmount(path, cb)
      }
    })
  }

  symlink (target, linkName, cb) {
    target = unixify(target)
    linkName = fixName(linkName)

    this.lstat(linkName, (err, stat) => {
      if (err && (err.errno !== 2)) return cb(err)
      if (!err) return cb(new errors.PathAlreadyExists(linkName))
      const st = Stat.symlink({
        linkname: target
      })
      return this._putStat(linkName, st, cb)
    })
  }

  createMountStream (opts) {
    return createMountStream(this, this._db, opts)
  }

  getAllMounts (opts, cb) {
    if (typeof opts === 'function') return this.getAllMounts(null, opts)
    const mounts = new Map()

    collect(this.createMountStream(opts), (err, mountList) => {
      if (err) return cb(err)
      for (const { path, metadata, content } of mountList) {
        mounts.set(path, { metadata, content })
      }
      return cb(null, mounts)
    })
  }

  extension (name, message) {
    this.metadata.extension(name, message)
  }

  get peers () {
    return this.metadata.peers
  }
}

function isObject (val) {
  return !!val && typeof val !== 'string' && !Buffer.isBuffer(val)
}

function ifNotExists (oldNode, newNode, cb) {
  if (oldNode) return cb(new errors.PathAlreadyExists(oldNode.key))
  return cb(null, true)
}

function fixName (name) {
  name = unixify(name)
  if (!name.startsWith('/')) name = '/' + name
  return name
}

function noop () {}
