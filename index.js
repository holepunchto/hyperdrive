var hyperdb = require('hyperdb')
var bulk = require('bulk-write-stream')
var from = require('from2')

module.exports = Hyperdrive

function Hyperdrive (storage, key, opts) {
  if (!(this instanceof Hyperdrive)) return new Hyperdrive(storage, key, opts)

  this._db = hyperdb(storage, key, {
    valueEncoding: 'json',
    contentFeed: true,
    reduce // TODO: make configurable
  })
}

Hyperdrive.prototype.replicate = function (opts) {
  return this._db.replicate(opts)
}

Hyperdrive.prototype.stat = function (path, cb) {
  this._db.get(path, function (err, node) {
    if (err) return cb(err)
    if (!node) return cb(new Error('Not found'))
    cb(null, node.value)
  })
}

Hyperdrive.prototype.createReadStream = function (path) {
  var db = this._db
  var content = null
  var st = null
  var offset = 0
  var end = 0

  return from(read)

  function open (size, cb) {
    db.get(path, function (err, node) {
      if (err) return cb(err)
      if (!node) return cb(new Error('Not found'))

      content = db.contentFeeds[node.feed]
      if (!content) return cb(new Error('No content feed attached'))

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
  var bufs = []
  var rs = this.createReadStream(path)

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

  var offset = directoryNameOffset(path)
  var recursive = !!(opts && opts.recursive)
  console.log(opts, recursive)
  var ite = this._db.iterator(path, {recursive, gt: true})
  
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
  var offset = directoryNameOffset(path)

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
  var key = node.key
  var idx = key.indexOf('/', offset)
  return key.slice(offset, idx > -1 ? idx : key.length)
}

Hyperdrive.prototype.writeFile = function (path, buf, cb) {
  if (typeof buf === 'string') buf = Buffer.from(buf)
  if (!cb) cb = noop

  // TODO: add fast path if buf.length < 64kb

  var ws = this.createWriteStream(path)

  for (var i = 0; i < buf.length; i += 65536) {
    ws.write(buf.slice(i, i + 65536))
  }

  ws.once('finish', cb)
  ws.once('error', cb)
  ws.end()
}

Hyperdrive.prototype.createWriteStream = function (path) {
  var db = this._db
  var opened = false

  var stat = {
    size: 0,
    blocks: 0,
    offset: 0,
    byteOffset: 0
  }

  return bulk(write, flush)

  function open (batch, cb) {
    db.ready(function (err) {
      if (err) return cb(err)
      db.localContent.ready(function (err) {
        if (err) return cb(err)
        opened = true
        stat.offset = db.localContent.length
        stat.byteOffset = db.localContent.byteLength
        write(batch, cb)
      })
    })
  }

  function write (batch, cb) {
    if (!opened) return open(batch, cb)
    db.localContent.append(batch, cb)
  }

  function flush (cb) {
    stat.size = db.localContent.byteLength - stat.byteOffset
    stat.blocks = db.localContent.length - stat.offset
    db.put(path, stat, cb)
  }
}

// TODO: pick the one with the highest mtime
function reduce (a, b) {
  return a
}

function noop () {}
