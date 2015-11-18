var crypto = require('crypto')
var rabin = require('rabin')
var through = require('through2')
var bulk = require('bulk-write-stream')
var pumpify = require('pumpify')
var merkleStream = require('merkle-tree-stream')
var hash = require('./hash')
var messages = require('./messages')

var BATCH_OPTIONS = {highWaterMark: 64}

module.exports = function (drive, name) {
  var pointer = crypto.randomBytes(32).toString('hex')
  var merkle = merkleStream(hash)
  var deltas = deltaStream()
  var offset = 0

  var stream = pumpify(rabin(), deltas, merkle, bulk.obj(BATCH_OPTIONS, write, flush))
  stream.result = null
  return stream

  function write (datas, cb) {
    var batch = new Array(2 * datas.length)

    for (var i = 0; i < datas.length; i++) {
      var block = datas[i].data
      var index = datas[i].index
      var hash = datas[i].hash
      var directory = !!block && index / 2 >= deltas.blocks
      var file = !!block && !directory

      batch[2 * i] = {
        type: 'put',
        key: '!tree-by-hash!' + hash.toString('hex'),
        value: messages.TreeDB.encode({
          pointer: pointer,
          index: index,
          block: file ? {filename: name, start: offset, length: block.length} : null,
          directory: directory ? block : null
        })
      }

      batch[2 * i + 1] = {
        type: 'put',
        key: '!tree-by-index!' + pointer + '!' + index,
        value: hash
      }

      if (block) offset += block.length
    }

    db.batch(batch, cb)
  }

  function flush (cb) {
    var roots = merkle.roots
    var right = hash.blank

    while (roots.length) right = hash.tree(roots.pop().hash, right)

    var file = {
      name: name,
      pointer: new Buffer(pointer, 'hex'),
      tree: right,
      blocks: deltas.blocks,
      directories: deltas.list
    }

    drive._files.put(right.toString('hex'), file, function (err) {
      if (err) return (err)
      stream.result = file
      cb()
    })
  }
}

function deltaStream () {
  var pointer = 0
  var length = 0
  var buffer = new Buffer(16384)
  var list = []
  var stream = through.obj(write, flush)
  stream.list = []
  stream.blocks = 0
  return stream

  function write (data, enc, cb) {
    stream.blocks++
    length += data.length
    buffer.writeUInt16BE(data.length, pointer)
    pointer += 2

    if (pointer === buffer.length) {
      list.push(buffer)
      stream.list.push(length)
      buffer = new Buffer(pointer)
      length = 0
      pointer = 0
    }

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
