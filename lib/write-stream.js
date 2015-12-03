var prefix = require('sublevel-prefixer')()
var merkleStream = require('merkle-tree-stream')
var rabin = require('rabin')
var bulk = require('bulk-write-stream')
var pumpify = require('pumpify')
var crypto = require('crypto')
var through = require('through2')
var hash = require('./hash')
var messages = require('./messages')

module.exports = writeStream

function writeStream (hyperdrive, opts) {
  if (!opts) opts = {}

  var pointer = opts.pointer || crypto.randomBytes(32)
  var space = pointer.toString('hex')
  var merkle = merkleStream(hash)
  var batcher = bulk.obj(write, flush)
  var indexer = opts.chunk ? indexStream() : null

  var ws = pumpify.obj(indexer ? [rabin(), indexer, merkle, batcher] : [merkle, batcher])

  ws.id = null
  ws.blocks = 0
  ws.index = null

  return ws

  function write (nodes, cb) {
    var batch = []
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i]

      batch.push({
        type: 'put',
        key: prefix('hashes', prefix(space, node.index.toString())),
        value: node.hash
      })

      if (node.data) {
        // TODO: store in fs
        // TODO: add deduplicator tree
        ws.blocks++
        batch.push({
          type: 'put',
          key: prefix('blocks', node.hash.toString('hex')),
          value: node.data
        })
      }
    }

    hyperdrive.db.batch(batch, cb)
  }

  function flush (cb) {
    if (!merkle.roots.length) return cb()

    ws.id = hash.root(merkle.roots)
    if (indexer) ws.index = indexer.list

    hyperdrive.db.batch([{
      type: 'put',
      key: prefix('links', ws.id.toString('hex')),
      value: messages.Link.encode({
        id: ws.id,
        pointer: pointer,
        blocks: ws.blocks,
        index: ws.index
      })
    }, {
      type: 'put',
      key: prefix('bitfields', ws.id.toString('hex')),
      value: fullBitfield(ws.blocks)
    }], cb)
  }
}

function fullBitfield (size) {
  var rem = size % 8
  var buf = new Buffer((size - rem) / 8 + (rem ? 1 : 0))
  buf.fill(255)
  if (rem) buf[buf.length - 1] = (255 << (8 - rem)) & 255
  return buf
}

function indexStream () {
  var pointer = 0
  var length = 0
  var buffer = new Buffer(16384)
  var list = []
  var stream = through.obj(write, flush)
  stream.blocks = 0
  stream.list = []
  return stream

  function write (data, enc, cb) {
    length += data.length
    buffer.writeUInt16BE(data.length === 65536 ? 0 : data.length, pointer)
    pointer += 2

    if (pointer === buffer.length) {
      list.push(buffer)
      stream.list.push(length)
      buffer = new Buffer(pointer)
      length = 0
      pointer = 0
    }

    stream.blocks++
    cb(null, data)
  }

  function flush (cb) {
    for (var i = 0; i < list.length; i++) stream.push(list[i])
    if (pointer) {
      stream.list.push(length)
      stream.push(buffer.slice(0, pointer))
    }
    cb()
  }
}
