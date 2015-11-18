var from = require('from2')

var BLOCKS_PER_DIRECTORY = 8192

module.exports = function (drive, tree, opts) {
  if (!opts) opts = {}

  var next = 0
  var blocks = 0
  var pointer = null

  return from.obj(function (size, cb) {
    if (pointer) read(next++, false, cb)
    else start(cb)
  })

  function start (cb) {
    drive._files.get(tree.toString('hex'), function (err, file) {
      if (err) return cb(err)

      blocks = file.blocks
      pointer = file.pointer.toString('hex')
      var start = opts.start

      // TODO: binary instead of for-loops below

      if (!start) return read(next++, cb)
      for (var i = 0; i < file.directories.length; i++) {
        if (start < file.directories[i]) break
        start -= file.directories[i]
      }

      read(blocks + i, true, function (err, dir) {
        if (err) return cb(err)

        for (var j = 0; j < BLOCKS_PER_DIRECTORY; j++) {
          var len = dir.readUInt16BE(2 * j)
          if (start < len) break
          start -= len
        }

        next = i * BLOCKS_PER_DIRECTORY + j
        read(next++, false, function (err, block) {
          if (err) return cb(err)
          block = block.slice(start)
          start = 0
          cb(null, block)
        })
      })
    })
  }

  function read (index, dir, cb) {
    if (!dir && index === blocks) return cb(null, null)
    drive._byIndex.get(pointer + '!' + (2 * index), function (err, hash) {
      if (err) return cb(err)
      drive._byHash.get(hash.toString('hex'), function (err, tree) {
        if (err) return cb(err)
        if (tree.directory) return cb(null, tree.directory)
        var blk = tree.block
        drive._readAndVerify(blk.filename, blk.start, blk.length, hash, cb)
      })
    })
  }
}
