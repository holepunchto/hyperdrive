var octal = require('octal')
var events = require('events')
var util = require('util')
var constants = require('constants')
var messages = require('./messages')
var hash = require('./hash')
var treeStream = require('./tree-stream')

module.exports = Archive

function Archive (drive) {
  if (!(this instanceof Archive)) return new Archive(drive)
  events.EventEmitter.call(this)

  var self = this

  this.pending = []
  this.node = null
  this.drive = drive

  this.stream = treeStream(drive.db)
  this.stream.on('finish', onfinish)
  this.stream.on('error', onerror)

  function onerror (err) {
    self.emit('error', err)
  }

  function onfinish () {
    self.value = self.stream.value
    self.key = self.stream.key
  }
}

util.inherits(Archive, events.EventEmitter)

Archive.prototype.entry = function (entry, cb) {
  var self = this

  if (!entry.mode) entry.mode = entry.type === 'directory' ? octal(755) | constants.S_IFDIR : octal(644)

  if (constants.S_IFDIR & entry.mode) return add(null)

  var content = createWriteStream(this.drive.db, {
    filename: entry.external && entry.name,
    index: true,
    rabin: true
  })

  this.pending.push(content)

  if (cb) content.on('error', cb)
  content.on('finish', function () {
    var link = content.value
    self.pending.splice(self.pending.indexOf(content), 1)
    entry.size = 0
    for (var i = 0; i < link.index.length; i++) entry.size += link.index[i]
    if (!entry.size) return add(null)

    add({
      tree: link.tree,
      blocks: link.blocks,
      index: link.index
    })
  })

  return content

  function add (link) {
    var node = {
      type: null,
      value: messages.FileNode.encode(entry),
      link: link
    }

    self.stream.write(messages.NodeDB.encode(node), function () {
      if (cb) cb(null, {type: 'file', value: entry, link: link})
    })

    return null
  }
}

Archive.prototype.finalize = function (cb) {
  var self = this
  kick()

  function kick () {
    if (!self.pending.length) self.stream.end(cb)
    else self.pending[0].once('finish', kick)
  }
}

if (require.main !== module) return

var level = require('level')
var db = level('test2.db')

var Hyperdrive = require('../')
var drive = Hyperdrive(db)

var b = Archive(drive)

b.entry({
  name: 'foo',
  type: 'directory'
})

var stream = b.entry({
  name: 'hello.txt'
})

stream.write('hello')
stream.write(' ')
stream.write('world')
stream.end()

var stream2 = b.entry({
  name: 'hi.txt'
})

var stream3 = b.entry({
  name: 'hello-empty.txt'
})

stream3.end()


b.finalize(function () {
  drive.db.createReadStream({
    gt: '!links!',
    lt: '!links!\xff'
  }).on('data', console.log)
})

stream2.write('hej')
stream2.write(' med ')
stream2.write('dig')
stream2.end()

// b.add({
//   type: 'file',
//   value: {
//     name: '/tmp/test.js',
//     mode: 0100644,
//     size: 1024
//   }
// })

// b.add({
//   type: 'file',
//   value: {
//     name: '/tmp/test.js',
//     mode: 0100644,
//     size: 1024
//   }
// })

// b.add({
//   type: 'file',
//   value: {
//     name: '/tmp/test.js',
//     mode: 0100644,
//     size: 1024
//   }
// })

// b.end(console.log)
