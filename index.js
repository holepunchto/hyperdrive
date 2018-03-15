var hyperdb = require('hyperdb')
var bulk = require('bulk-write-stream')

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

Hyperdrive.prototype.createWriteStream = function (key) {
  var content = this._db.localContent
  var opened = false

  var stat = {
    size: 0,
    blocks: 0,
    offset: 0,
    byteOffset: 0
  }

  return bulk(write, flush)

  function open (batch, cb) {
    content.ready(function (err) {
      if (err) return cb(err)
      opened = true
      stat.offset = content.length
      stat.byteOffset = content.byteLength
      write(batch, cb)
    })
  }

  function write (batch, cb) {
    if (!opened) return open(batch, cb)
    content.append(batch, cb)
  }

  function flush (cb) {
    stat.size = content.byteLength - stat.byteOffset
    stat.blocks = content.length - stat.offset
    self._db.put(key, stat, cb)
  }
}

// TODO: pick the one with the highest mtime
function reduce (a, b) {
  return a
}
