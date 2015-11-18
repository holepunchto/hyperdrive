var through = require('through2')

module.exports = function () {
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
