const hyperdb = require('hyperdb')
const bulk = require('bulk-write-stream')
const from = require('from2')
const inherits = require('inherits')
const path = require('path')
const events = require('events')
const mutexify = require('mutexify')
const isOptions = require('is-options')
const messages = require('./lib/messages')
const stat = require('./lib/stat')
const errors = require('./lib/errors')
const iterator = require('./lib/iterator')

const DEFAULT_FMODE = (4 | 2 | 0) << 6 | ((4 | 0 | 0) << 3) | (4 | 0 | 0) // rw-r--r--
const DEFAULT_DMODE = (4 | 2 | 1) << 6 | ((4 | 0 | 1) << 3) | (4 | 0 | 1) // rwxr-xr-x

module.exports = Hyperdrive

function contentStorage (storage, dir, name, opts) {
  if (name.endsWith('/data')) return require('./lib/storage')(dir, opts)
  return require('random-access-file')(name, {directory: storage})
  // () => require('./lib/storage')(storage)
}

function Hyperdrive (storage, key, opts) {
  if (!(this instanceof Hyperdrive)) return new Hyperdrive(storage, key, opts)

  if (isOptions(key)) {
    opts = key
    key = null
  }

  if (!opts) opts = {}
  if (opts.files) opts.latest = true

  events.EventEmitter.call(this)

  const self = this
  const db = opts.checkout || hyperdb(storage, key, {
    valueEncoding: messages.Stat,
    contentFeed: opts.files ? contentStorage.bind(this, storage, opts.files) : true,
    secretKey: opts.secretKey,
    sparse: opts.sparse,
    sparseContent: opts.sparse || opts.latest || opts.sparseContent,
    reduce, // TODO: make configurable
    onwrite: opts.latest && onwrite
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

  function onwrite (entry, peer, cb) {
    if (!peer) return cb(null) // we handle this case in onappend

    const data = self.localContentData
    if (!data.onunlink || !entry.key) return cb(null)

    // TODO: race condition here where the db can be updated while we do the
    // isLatest check. If that happens we need to recheck against new heads,
    // perhaps pausing replication inbetween

    isLatest(entry, function onlatest (err, latest) {
      if (err || !latest) return cb(err)
      data.onunlink(entry.key, function (err) {
        if (err) return cb(err)
        if (entry.value) downloadEntry(self.db, entry, noop)
        cb(null) // TODO: if to many downloads are in progress (say +64, wait for downloadEntry)
      })
    })
  }

  function isLatest (entry, cb) {
    self.db.get(entry.key, function (err, latest) {
      if (err) return cb(err)
      if (latest && (latest.seq !== entry.seq || latest.feed !== entry.feed)) return cb(null, false)
      // this is the latest entry ... delete the current file as it is gonna get updated
      cb(null, true)
    })
  }

  function onready () {
    self.key = db.key
    self.discoveryKey = db.discoveryKey
    self.local = db.local
    self.localContent = db.localContent
    // TODO: support feed.storage.data in hypercore
    self.localContentData = db.localContent._storage.data
    self.emit('ready')

    // TODO: if latest and not sparse start an iterator (and restart on append)
    // to trigger file downloads faster in the above onwrite hook
  }
}

inherits(Hyperdrive, events.EventEmitter)

Hyperdrive.prototype.iterator = function (path, opts) {
  return iterator(this, path, opts)
}

Hyperdrive.prototype.download = function (path, cb) {
  if (typeof path === 'function') return this.download(null, path)
  if (!cb) cb = noop

  path = normalizePath(path)

  const db = this.db
  const ite = db.iterator(path)

  ite.next(loop)
  return ite

  // TODO: parallelize a bit!
  function loop (err, node) {
    if (err) return cb(err)
    if (!node) return cb(null)
    if (!node.value || node.value.blocks === 0) return ite.next(loop)
    downloadEntry(db, node, ondownload)
  }

  function ondownload (err) {
    if (err) return cb(err)
    ite.next(loop)
  }
}

Hyperdrive.prototype.snapshot = function () {
  return new Hyperdrive(null, null, {
    checkout: this.db.snapshot()
  })
}

Hyperdrive.prototype.checkout = function (version) {
  return new Hyperdrive(null, null, {
    checkout: this.db.checkout(version)
  })
}

Hyperdrive.prototype.authorize = function (key, cb) {
  this.db.authorize(key, cb)
}

Hyperdrive.prototype.version = function (cb) {
  this.db.version(cb)
}

Hyperdrive.prototype.replicate = function (opts) {
  return this.db.replicate(opts)
}

Hyperdrive.prototype.lstat = function (path, cb) {
  path = normalizePath(path)

  this.db.get(path, {prefix: true}, function (err, node) {
    if (err) return cb(err)

    if (!node) {
      if (!path) return cb(null, statRoot(node))
      return cb(new errors.ENOENT('stat', path))
    }

    if (node.key !== path) { // is prefix, ie implicit dir
      const implicit = stat(node.value, node, true)
      implicit.mode = DEFAULT_DMODE | stat.IFDIR
      return cb(null, implicit)
    }

    cb(null, stat(node.value, node, false))
  })
}

Hyperdrive.prototype.stat = Hyperdrive.prototype.lstat

Hyperdrive.prototype.mkdir = function (path, opts, cb) {
  if (typeof opts === 'function') return this.mkdir(path, null, opts)
  if (typeof opts === 'number') opts = {mode: opts}
  if (!opts) opts = {}
  if (!cb) cb = noop

  path = normalizePath(path)

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

Hyperdrive.prototype.rmdir = function (path, cb) {
  if (!cb) cb = noop

  path = normalizePath(path)

  const db = this.db

  this.stat(path, function (err, st) {
    if (err) return cb(err)
    if (!st) return cb(new errors.ENOENT('stat', path))
    if (!st.isDirectory()) return cb(new errors.ENOTDIR('rmdir', path))

    db.iterator(path).next(function (err, node) {
      if (err) return cb(err)
      if (node) return cb(new errors.ENOTEMPTY('rmdir', path))
      if (st.implicit) return cb(null)

      db.del(path, cb)
    })
  })
}

Hyperdrive.prototype.createReadStream = function (path, opts) {
  if (!opts) opts = {}

  path = normalizePath(path)

  const db = this.db
  const slicing = opts.start || typeof opts.end === 'number'

  var content = null
  var st = null
  var offset = 0
  var end = 0
  var rel = 0
  var bytesMissing = 0
  var missing = 1
  var range = null
  var ended = false
  var downloaded = false

  const stream = from(slicing ? readSlice : read)
    .on('end', cleanup)
    .on('close', cleanup)

  return stream

  function cleanup () {
    if (range && content) content.undownload(range, noop)
    range = null
    ended = true
  }

  function open (size, cb) {
    db.get(path, function (err, node) {
      if (err) return cb(err)
      if (ended || stream.destroyed) return cb(null)
      if (!node) return cb(new errors.ENOENT('stat', path))

      content = db.contentFeeds[node.feed]
      if (!content) return cb(new errors.EPROTO('open_content', path))

      st = node.value
      offset = st.offset
      end = offset + st.blocks

      if (!slicing || !st.size) {
        range = content.download({start: offset, end, linear: true})
        return read(size, cb)
      }

      const bytesStart = opts.start || 0
      const bytesEnd = Math.max(bytesStart, typeof opts.end === 'number' ? opts.end : st.size - 1)
      bytesMissing = bytesEnd - bytesStart + 1

      if (bytesStart) content.seek(st.byteOffset + bytesStart, {start: offset, end}, onstart)
      else onstart(null, bytesStart, 0)

      function onend (err, end) {
        if (err || !range) return
        if (ended || stream.destroyed) return

        missing++
        content.undownload(range)
        range = content.download({start: offset, end, linear: true}, ondownload)
      }

      function onstart (err, index, relativeOffset) {
        if (err) return cb(err)
        if (ended || stream.destroyed) return

        rel = relativeOffset
        offset = index
        range = content.download({start: offset, end, linear: true}, ondownload)
        if (bytesEnd < st.size) content.seek(st.byteOffset + bytesEnd, {start: offset, end}, onend)

        readSlice(size, cb)
      }

      function ondownload (err) {
        if (--missing) return
        if (err && !ended && !downloaded) stream.destroy(err)
        else downloaded = true
      }
    })
  }

  function readSlice (size, cb) {
    if (!content) return open(size, cb)
    if (!bytesMissing) return cb(null, null)
    content.get(offset++, onget)

    function onget (err, data) {
      if (err) return cb(err)

      if (rel) {
        data = data.slice(rel)
        rel = 0
      }

      if (bytesMissing) {
        if (bytesMissing < data.length) data = data.slice(0, bytesMissing)
        bytesMissing -= data.length
      }

      cb(null, data)
    }
  }

  function read (size, cb) {
    if (!content) return open(size, cb)
    if (offset >= end) return cb(null, null)
    content.get(offset++, cb)
  }
}

Hyperdrive.prototype.readFile = function (path, opts, cb) {
  if (typeof opts === 'function') return this.readFile(path, null, opts)
  if (typeof opts === 'string') opts = {encoding: opts}

  path = normalizePath(path)

  const enc = opts && opts.encoding
  const bufs = []
  const rs = this.createReadStream(path)

  rs.on('data', ondata)
  rs.once('error', cb)
  rs.once('end', onend)

  function ondata (data) {
    bufs.push(data)
  }

  function onend () {
    const buf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs)
    cb(null, enc && enc !== 'binary' ? buf.toString(enc) : buf)
  }
}

Hyperdrive.prototype.createDirectoryStream = function (path, opts) {
  if (isOptions(path)) return this.createDirectoryStream(null, path)

  path = normalizePath(path)

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
  path = normalizePath(path)

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
  if (typeof opts === 'string') opts = {encoding: opts}
  if (!opts) opts = {}
  if (!cb) cb = noop

  if (typeof buf === 'string') buf = Buffer.from(buf, opts.encoding)

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

  path = normalizePath(path)

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

        const data = self.localContentData
        if (data.onappend) data.onappend(path, st)

        if (batch) write(batch, cb)
        else flush(cb)
      })
    })
  }

  function write (batch, cb) {
    if (!opened) return open(batch, cb)
    db.localContent.append(batch, cb)
  }

  function flush (cb) {
    if (!opened) return open(null, cb)
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

  const self = this
  path = normalizePath(path)

  this.ready(function (err) {
    if (err) return cb(err)
    const data = self.localContentData
    if (!data.onunlink) return del(null)
    data.onunlink(path, del)
  })

  function del (err) {
    if (err) return cb(err)
    self.db.del(path, cb)
  }
}

Hyperdrive.prototype.access = function (path, cb) {
  this.stat(path, function (err) {
    cb(err)
  })
}

Hyperdrive.prototype.exists = function (path, cb) {
  this.access(path, function (err) {
    const exists = !err
    cb(exists)
  })
}

Hyperdrive.prototype.ready = function (cb) {
  this.db.ready(cb)
}

function reduce (a, b) {
  if (!a.value) return b
  if (!b.value) return a
  return a.value.mtime > b.value.mtime ? a : b
}

function noop () {}

function getTime (date) {
  if (typeof date === 'number') return date
  if (!date) return Date.now()
  return date.getTime()
}

function normalizePath (p) {
  return path.resolve('/', p || '').slice(1)
}

function statRoot (source) {
  const opts = {
    mode: stat.IFDIR | DEFAULT_DMODE,
    uid: 0,
    gid: 0,
    size: 0,
    offset: 0,
    byteOffset: 0,
    blocks: 0,
    atime: 0,
    mtime: 0,
    ctime: 0
  }

  return stat(opts, source, true)
}

function downloadEntryWhenReady (feed, db, node, cb) {
  feed.ready(function (err) {
    if (err) return cb(err)
    downloadEntry(db, node, cb)
  })
}

function downloadEntry (db, node, cb) {
  const feed = db.contentFeeds[node.feed]
  if (!feed.bitfield) return downloadEntryWhenReady(feed, db, node, cb)

  const start = node.value.offset
  const end = start + node.value.blocks
  console.log('downloading', node.key)
  if (start === end || feed.has(start, end)) return cb(null)
  feed.download({start, end}, cb)
}
