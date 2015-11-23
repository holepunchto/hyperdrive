var level = require('level')
var fs = require('fs')
var equals = require('buffer-equals')
var path = require('path')
var bitfield = require('bitfield')
var messages = require('./lib/messages')
var protocol = require('./lib/protocol')
var hyperdrive = require('./')

var treeStream = require('./lib/tree-stream')
var hash = require('./lib/hash')

try {
  fs.mkdirSync('remote')
} catch (err) {}

var drive = hyperdrive(level('test.db'), storage('.'))
var remote = hyperdrive(level('remote/test.db'), storage('remote'))

// fs.createReadStream('test.mp4').pipe(treeStream(drive.db, {filename: 'test.mp4', index: true, rabin: true})).on('finish', function () {
//   console.log(this.tree)
// })

// return

// fs.createReadStream('test.mp4')
//   .pipe(drive.createFileWriteStream('test.mp4', console.log))

// return

var a = protocol(function (peer) {
  console.log('joined swarm:', peer.link)

  lookupTree(drive, peer.link, function (err, info) {
    if (err) return peer.leave(err)

    peer.on('request', function (req) {
      get(info.pointer, req.block, function (err, blk) {
        if (err) return peer.leave(err)

        var hashes = new Array(req.hashes.length)
        var i = 0
        loop(null, null)

        function loop (err, hash) {
          if (err) return peer.leave(err)
          if (hash) hashes[i - 1] = hash
          if (i === req.hashes.length) return peer.response(req, blk, hashes)
          drive._byIndex.get(info.pointer + '!' + req.hashes[i++], loop)
        }
      })
    })

    peer.unchoke(info.blocks, info.bitfield)
  })

  function get (ptr, block, cb) {
    drive._byIndex.get(ptr + '!' + (2 * block), function (err, hash) {
      if (err) return cb(err)
      drive._byHash.get(hash.toString('hex'), function (err, result) {
        if (err) return cb(err)
        if (result.block) return cb(null, result.block)
        var f = result.external
        drive._readAndVerify(f.filename, f.offset, f.length, hash, cb)
      })
    })
  }
})

var b = protocol(function (remote) {

})

a.pipe(b).pipe(a)

var flat = require('flat-tree')

drive.list().on('data', function (tree) {
  var peer = b.join(tree.root)
  var ptr = (tree.pointer || tree.root).toString('hex')
  var filename = 'test.mp4'

  peer.on('unchoke', function () {
    if (!peer.blocks) throw new Error('should handle no blocks (root is blank)')
    console.log('not choked')

    var max = 2 * (peer.blocks - 1)
    var root = max
    while (flat.leftSpan(root)) root = flat.parent(root)

    console.log('root', root, 'using', peer.blocks, 'blocks')
    var i = tree.blocks - 1
    loop()

    function loop (err) {
      if (err) throw err
      if (i < 0) return
      get(i--, loop)
    }
  })

  function map (index, max) {
    while (flat.rightSpan(index) > max && isBlank(flat.rightChild(index), max)) {
      index = flat.leftChild(index)
    }
    return index
  }

  function isBlank (index, max) {
    return flat.leftSpan(index) > max
  }

  function addTree (batch, index, hash, external, block) {
    batch.push({
      type: 'put',
      key: '!by-hash!' + hash.toString('hex'),
      value: messages.TreeNode.encode({
        pointer: ptr,
        index: index,
        external: external,
        block: block
      })
    })
    batch.push({
      type: 'put',
      key: '!by-index!' + ptr + '!' + index,
      value: hash
    })
  }

  function getOffset (block, cb) { // TODO: use some shared abstraction for this (using iterator?)
    var offset = 0
    var rel = Math.floor(block / 8192)
    var idx = tree.blocks - tree.index.length + rel
    var rem = block % 8192

    for (var i = 0; i < rel; i++) {
      offset += tree.index[i]
    }

    remote._byIndex.get(ptr + '!' + (2 * idx), function (err, hash) {
      if (err) return cb(err)
      remote._byHash.get(hash.toString('hex'), function (err, result) {
        if (err) return cb(err)
        var i = 0
        while (rem--) {
          offset += result.block.readUInt16BE(i)
          i += 2
        }
        cb(null, offset, result.block.readUInt16BE(i))
      })
    })
  }

  function get (block, cb) {
    var hashes = []
    var trusted = tree.root
    var max = 2 * (tree.blocks - 1)
    var root = max
    while (flat.leftSpan(root)) root = flat.parent(root)

    loop(2 * block)

    function done () {
      peer.request(block, hashes, function (err, res) {
        if (err) return cb(err)

        var offset = 0
        var start = 0
        var sum = hash.data(res.block)
        var batch = []
        var isIndex = tree.index && block >= (tree.blocks - tree.index.length)
        var wasBlank = true

        if (isIndex) {
          addTree(batch, 2 * block, sum, null, res.block)
          loop(2 * block)
        } else {
          getOffset(block, function (err, offset, length) {
            // TODO: check that res.block.length is === length in index
            start = offset
            addTree(batch, 2 * block, sum, {filename: filename, start: offset, length: length}, null)
            loop(2 * block)
          })
        }

        function addBatch (err) {
          if (err) return cb(err)
          console.log('batch is', batch.length, 'for block', block)
          remote.db.batch(batch, function (err) {
            if (err) return cb(err)
            cb(null, res.block)
          })
        }

        function loop (want) {
          if (offset === res.hashes.length) {
            if (!equals(sum, trusted)) return cb(new Error('Checksum mismatch'))
            if (isIndex) return addBatch()
            remote._write(filename, start, res.block, addBatch)
            return
          }

          if (!wasBlank) {
            addTree(batch, want, sum, null, null)
          }

          var sibling = flat.sibling(want)
          wasBlank = false

          if (isBlank(sibling, max)) {
            wasBlank = true
            next(null, hash.blank)
          } else {
            sibling = map(sibling, max)
            if (sibling === hashes[offset]) next(null, res.hashes[offset++], true)
            else remote._byIndex.get(ptr + '!' + sibling, next)
          }

          function next (err, sib, add) {
            if (err) return cb(err)

            if (add) {
              addTree(batch, hashes[offset - 1], res.hashes[offset - 1], null, null)
            }

            if (want < flat.sibling(want)) sum = hash.tree(sum, sib)
            else sum = hash.tree(sib, sum)

            loop(flat.parent(want))
          }
        }
      })
    }


    function loop (want) {
      if (want === root) return done() // is root
      remote._byIndex.get(ptr + '!' + want, function (err, hash) {
        if (!err) {
          trusted = hash
          done()
          return
        }

        var sibling = flat.sibling(want)

        if (isBlank(sibling, max)) {
          next(null)
        } else {
          sibling = map(sibling, max)
          remote._byIndex.get(ptr + '!' + sibling, next)
        }

        function next (err) {
          if (err) hashes.push(sibling)
          loop(flat.parent(want))
        }
      })
    }
  }

  // var iterator = require('./lib/block-iterator')
  // var ite = iterator(drive, tree)
  // var size = 0

  // ite.read(size, function loop (err, buf) {
  //   if (!buf) return
  //   console.log(size += buf.length, buf)
  //   ite.next(loop)
  // })
})

function lookupTree (drive, link, cb) {
  var field = bitfield(0, {grow: Infinity})
  drive._trees.get(link.toString('hex'), function (err, tree) {
    var ptr = (tree.pointer || tree.root).toString('hex')
    var rs = drive._byIndex.createKeyStream({
      gt: ptr + '!',
      lt: ptr + '!~'
    })

    rs.on('data', function (key) {
      var index = parseInt(key.split('!').pop(), 10)
      if (index % 2 === 0) field.set(index / 2)
    })
    rs.on('end', function () {
      cb(null, {
        pointer: ptr,
        bitfield: field,
        blocks: tree.blocks || 0,
        roots: flat.fullRoots(2 * (tree.blocks || 0))
      })
    })
  })
}

function storage (folder) {
  return {
    read: function (name, offset, length, cb) {
      fs.open(path.join(folder, name), 'r', function (err, fd) {
        if (err) return cb(err)

        var buf = new Buffer(length)
        loop(null, 0)

        function loop (err, read) {
          if (err) return done(err)
          length -= read
          offset += read
          if (!length) return done()
          fs.read(fd, buf, buf.length - length, length, offset, loop)
        }

        function done (error) {
          fs.close(fd, function (err) {
            if (err) error = err
            if (error) return cb(error)
            cb(null, buf)
          })
        }
      })
    },
    write: function (name, offset, buf, cb) {
      fs.open(path.join(folder, name), 'a', function (err, fd) {
        if (err) return cb(err)

        var length = buf.length
        loop(null, 0)

        function loop (err, written) {
          if (err) return done(err)
          length -= written
          offset += written
          if (!length) return done()
          fs.write(fd, buf, buf.length - length, length, offset, loop)
        }

        function done (error) {
          fs.close(fd, function (err) {
            if (err) error = err
            if (error) return cb(error)
            cb(null, buf)
          })
        }
      })
    }
  }
}
