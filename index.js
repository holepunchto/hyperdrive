const hyperdb = require('hyperdb')
const bulk = require('bulk-write-stream')
const from = require('from2')
const messages = require('./lib/messages')
const stat = require('./lib/stat')
const errors = require('./lib/errors')

const DEFAULT_FMODE = (4 | 2 | 0) << 6 | ((4 | 0 | 0) << 3) | (4 | 0 | 0) // rw-r--r--
const DEFAULT_DMODE = (4 | 2 | 1) << 6 | ((4 | 0 | 1) << 3) | (4 | 0 | 1) // rwxr-xr-x

module.exports = Hyperdrive

function Hyperdrive (storage, key, opts) {
  if (!(this instanceof Hyperdrive)) return new Hyperdrive(storage, key, opts)

  this._db = hyperdb(storage, key, {
    valueEncoding: messages.Stat,
    contentFeed: true,
    reduce // TODO: make configurable
  })
}

Hyperdrive.prototype.replicate = function (opts) {
  return this._db.replicate(opts)
}

Hyperdrive.prototype.lstat = function (path, cb) {
  this._db.get(path, function (err, node) {
    if (err) return cb(err)
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
  
  const db = this._db

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
  const db = this._db

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

Hyperdrive.prototype.readFile = function (path, cb) {
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
  const ite = this._db.iterator(path, {recursive, gt: true})
  
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

  this._db.list(path, {gt: true, recursive: false}, onlist)

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

  const db = this._db
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

  return bulk(write, flush)

  function open (batch, cb) {
    db.ready(function (err) {
      if (err) return cb(err)
      opened = true
      st.offset = db.localContent.length
      st.byteOffset = db.localContent.byteLength
      write(batch, cb)
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
}

Hyperdrive.prototype.ready = function (cb) {
  this.db.ready(cb)
}

// TODO: pick the one with the highest mtime
function reduce (a, b) {
  return a
}

function noop () {}

function getTime (date) {
  if (typeof date === 'number') return date
  if (!date) return Date.now()
  return date.getTime()
}
