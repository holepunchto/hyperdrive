const hyperdb = require('hyperdb')
const bulk = require('bulk-write-stream')
const from = require('from2')
const inherits = require('inherits')
const events = require('events')
const mutexify = require('mutexify')
const isOptions = require('is-options')
const messages = require('./lib/messages')
const stat = require('./lib/stat')
const errors = require('./lib/errors')

const DEFAULT_FMODE = (4 | 2 | 0) << 6 | ((4 | 0 | 0) << 3) | (4 | 0 | 0) // rw-r--r--
const DEFAULT_DMODE = (4 | 2 | 1) << 6 | ((4 | 0 | 1) << 3) | (4 | 0 | 1) // rwxr-xr-x
const DEFAULT_ROOT = stat({mode: stat.IFDIR | DEFAULT_DMODE})

module.exports = Hyperdrive

function Hyperdrive (storage, key, opts) {
  if (!(this instanceof Hyperdrive)) return new Hyperdrive(storage, key, opts)

  if (isOptions(key)) {
    opts = key
    key = null
  }
  
  if (!opts) opts = {}

  events.EventEmitter.call(this)

  const self = this
  const db = opts.checkout || hyperdb(storage, key, {
    valueEncoding: messages.Stat,
    contentFeed: true,
    sparse: this.sparse,
    reduce // TODO: make configurable
  })

  this.key = db.key
  this.discoveryKey = db.discoveryKey
  this.local = null
  this.localContent = null
  this.sparse = db.sparse
  this.feeds = db.feeds
  this.contentFeeds = db.contentFeeds
  this.db = db

  this._lock = mutexify()

  this.ready(onready)

  function onready () {
    self.key = db.key
    self.discoveryKey = db.discoveryKey
    self.local = db.local
    self.localContent = db.localContent
    self.emit('ready')
  }
}

inherits(Hyperdrive, events.EventEmitter)

Hyperdrive.prototype.download = function (path, cb) {
  if (typeof path === 'function') return this.download(null, path)
  if (!cb) cb = noop

  const db = this.db
  const ite = db.iterator(path)

  ite.next(loop)

  // TODO: parallelize a bit!
  function loop (err, node) {
    if (err) return cb(err)
    if (!node) return cb(null)
    if (!node.value || node.value.blocks === 0) return ite.next(loop)

    const feed = db.contentFeeds[node.feed]
    const start = node.value.offset
    const end = start + node.value.blocks

    if (feed.has(start, end)) return ondownload(null)
    feed.download({start, end}, ondownload)
  }

  function ondownload (err) {
    if (err) return cb(err)
    ite.next(loop)
  }
}

Hyperdrive.prototype.snapshot = function () {
  return new Hyperdrive(null, null, {
    checkout: this.db.checkout(snapshot)
  })
}

Hyperdrive.prototype.checkout = function (version) {
  return new Hyperdrive(null, null, {
    checkout: this.db.checkout(version)
  })
}

Hyperdrive.prototype.authenticate = function (key, cb) {
  this.db.authenticate(key, cb)
}

Hyperdrive.prototype.version = function (cb) {
  this.db.version(cb)
}

Hyperdrive.prototype.replicate = function (opts) {
  return this.db.replicate(opts)
}

Hyperdrive.prototype.lstat = function (path, cb) {
  if (path === '/') path = ''
  this.db.get(path, function (err, node) {
    if (err) return cb(err)
    if (!node && !path) return cb(null, DEFAULT_ROOT)
    if (!node) return cb(new errors.ENOENT('stat', path))
    cb(null, stat(node.value))
  })
}

Hyperdrive.prototype.stat = Hyperdrive.prototype.lstat

Hyperdrive.prototype.mkdir = function (path, opts, cb) {
  if (typeof opts === 'function') return this.mkdir(path, null, opts)
  if (typeof opts === 'number') opts = {mode: opts}
  if (!opts) opts = {}
  if (!cb) cb = noop

  const db = this.db

  db.ready(function (err) {
    if (err) return cb(err)

    const st = {
      mode: (opts.mode || DEFAULT_DMODE) | stat.IFDIR,
      uid: opts.uid,
      gid: opts.gid,
      mtime: getTime(opts.mtime),
      ctime: getTime(opts.ctime),
      offset: db.localContent.length,
      byteOffset: db.localContent.byteLength
    }

    db.put(path, st, cb)
  })
}

Hyperdrive.prototype.createReadStream = function (path) {
  const db = this.db

  var content = null
  var st = null
  var offset = 0
  var end = 0

  return from(read)

  function open (size, cb) {
    db.get(path, function (err, node) {
      if (err) return cb(err)
      if (!node) return cb(new errors.ENOENT('stat', path))

      content = db.contentFeeds[node.feed]
      if (!content) return cb(new errors.EPROTO('open_content', path))

      st = node.value
      offset = st.offset
      end = offset + st.blocks

      read(size, cb)
    })
  }

  function read (size, cb) {
    if (!content) return open(size, cb)
    if (offset >= end) return cb(null, null)
    content.get(offset++, cb)
  }
}

Hyperdrive.prototype.readFile = function (path, opts, cb) {
  if (typeof opts === 'function') return this.readFile(path, null, opts)

  const bufs = []
  const rs = this.createReadStream(path)

  rs.on('data', ondata)
  rs.once('error', cb)
  rs.once('end', onend)

  function ondata (data) {
    bufs.push(data)
  }

  function onend () {
    cb(null, bufs.length === 1 ? bufs[0] : Buffer.concat(bufs))
  }
}

Hyperdrive.prototype.createDirectoryStream = function (path, opts) {
  if (typeof path === 'object' && path) return this.createDirectoryStream(null, path)
  if (!path) path = ''

  const offset = directoryNameOffset(path)
  const recursive = !!(opts && opts.recursive)
  const ite = this.db.iterator(path, {recursive, gt: true})

  return from.obj(read)

  function read (size, cb) {
    ite.next(function (err, node) {
      if (err) return cb(err)
      if (!node) return cb(null, null)
      if (recursive) return cb(null, node.key)
      cb(null, directoryName(node, offset))
    })
  }
}

Hyperdrive.prototype.readdir = function (path, cb) {
  const offset = directoryNameOffset(path)

  this.db.list(path, {gt: true, recursive: false}, onlist)

  function onlist (err, nodes) {
    if (err) return cb(err)

    var names = new Array(nodes.length)

    for (var i = 0; i < nodes.length; i++) {
      names[i] = directoryName(nodes[i], offset)
    }

    cb(null, names)
  }
}

function directoryNameOffset (path) {
  if (path && path[path.length - 1] === '/') path = path.slice(0, -1)
  if (path && path[0] === '/') path = path.slice(1)

  return path.length ? path.length + 1 : 0
}

function directoryName (node, offset) {
  const key = node.key
  const idx = key.indexOf('/', offset)
  return key.slice(offset, idx > -1 ? idx : key.length)
}

Hyperdrive.prototype.writeFile = function (path, buf, opts, cb) {
  if (typeof opts === 'function') return this.writeFile(path, buf, null, opts)
  if (typeof buf === 'string') buf = Buffer.from(buf)
  if (!opts) opts = {}
  if (!cb) cb = noop

  // TODO: add fast path if buf.length < 64kb

  const ws = this.createWriteStream(path, opts)

  for (var i = 0; i < buf.length; i += 65536) {
    ws.write(buf.slice(i, i + 65536))
  }

  ws.once('finish', cb)
  ws.once('error', cb)
  ws.end()
}

Hyperdrive.prototype.createWriteStream = function (path, opts) {
  if (!opts) opts = {}

  const self = this
  const db = this.db
  const st = {
    size: 0,
    blocks: 0,
    offset: 0,
    byteOffset: 0,
    mode: (opts.mode || DEFAULT_FMODE) | stat.IFREG,
    uid: opts.uid,
    gid: opts.gid,
    mtime: getTime(opts.mtime),
    ctime: getTime(opts.ctime)
  }

  var opened = false
  var release = null

  return bulk(write, flush)
    .once('close', unlock)
    .once('finish', unlock)

  function open (batch, cb) {
    db.ready(function (err) {
      if (err) return cb(err)
      self._lock(function (r) {
        release = r
        opened = true
        st.offset = db.localContent.length
        st.byteOffset = db.localContent.byteLength
        write(batch, cb)
      })
    })
  }

  function write (batch, cb) {
    if (!opened) return open(batch, cb)
    db.localContent.append(batch, cb)
  }

  function flush (cb) {
    st.size = db.localContent.byteLength - st.byteOffset
    st.blocks = db.localContent.length - st.offset
    db.put(path, st, cb)
  }

  function unlock () {
    if (!release) return
    const r = release
    release = null
    r()
  }
}

Hyperdrive.prototype.unlink = function (path, cb) {
  if (!cb) cb = noop
  this.db.del(path, cb)
}

Hyperdrive.prototype.access = function (name, cb) {
  this.stat(name, function (err) {
    cb(err)
  })
}

Hyperdrive.prototype.exists = function (name, cb) {
  this.access(name, function (err) {
    cb(!err)
  })
}

Hyperdrive.prototype.ready = function (cb) {
  this.db.ready(cb)
}

function reduce (a, b) {
  if (!a.value) return b
  if (!b.value) return a
  return a.value.mtime < b.value.mtime
}

function noop () {}

function getTime (date) {
  if (typeof date === 'number') return date
  if (!date) return Date.now()
  return date.getTime()
}
