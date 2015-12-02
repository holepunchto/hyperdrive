var constants = require('constants')
var events = require('events')
var util = require('util')
var octal = require('octal')
var writeStream = require('./write-stream')
var messages = require('./messages')

module.exports = Archive

function Archive (drive) {
  if (!(this instanceof Archive)) return new Archive(drive)
  events.EventEmitter.call(this)

  this.id = null
  this.blocks = 0

  this.drive = drive
  this.pending = []

  this.stream = writeStream(drive)
  this.stream.on('finish', onfinish)
  this.stream.on('error', onerror)

  var self = this

  function onerror (err) {
    self.emit('error', err)
  }

  function onfinish () {
    self.id = self.stream.id
    self.blocks = self.stream.blocks
  }
}

util.inherits(Archive, events.EventEmitter)

Archive.prototype.entry = function (file, cb) {
  var self = this

  if (!file) file = {}
  if (!file.mode) file.mode = file.type === 'directory' ? octal(755) | constants.S_IFDIR : octal(644)

  if (constants.S_IFDIR & file.mode) return add(null)

  var content = writeStream(this.drive, {chunk: true})
  if (cb) content.on('error', cb)

  this.pending.push(content)
  content.on('finish', onfinish)

  return content

  function onfinish () {
    self.pending.splice(self.pending.indexOf(content), 1)

    file.size = 0
    for (var i = 0; i < content.index.length; i++) file.size += content.index[i]
    if (!file.size) return add(null)

    add({
      id: content.id,
      blocks: content.blocks,
      index: content.index
    })
  }

  function add (link) {
    var entry = {
      type: 'file',
      value: messages.File.encode(file),
      link: link
    }

    var buf = messages.Entry.encode(entry)
    self.stream.write(buf, function () {
      if (cb) cb(null, entry)
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
