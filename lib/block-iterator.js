var BLOCKS_PER_DIRECTORY = 8192

module.exports = Iterator

function Iterator (drive, tree) {
  if (!(this instanceof Iterator)) return new Iterator(drive, tree)

  this.drive = drive
  this.tree = tree
  this.position = {bytes: 0, block: 0, offset: 0}

  this._end = this.tree.blocks - this.tree.index.length
  this._pointer = (tree.pointer || tree.root).toString('hex')
}

Iterator.prototype.read = function (offset, cb) {
  if (this.position.bytes === offset) this.next(cb)
  else this.seekAndRead(offset, cb)
}

Iterator.prototype.seekAndRead = function (offset, cb) {
  var self = this
  this.seek(offset, function (err) {
    if (err) return cb(err)
    self.next(cb)
  })
}

Iterator.prototype.next = function (cb) {
  var self = this
  var block = this.position.block
  var bytes = this.position.bytes
  var offset = this.position.offset

  if (block >= this._end) return cb(null, null)

  this._block(block, function (err, blk) {
    if (err) return cb(err)
    if (!blk) return cb(null, null)
    if (offset) blk = blk.slice(offset)
    self.position.block++
    self.position.offset = 0
    self.position.bytes = bytes + blk.length
    cb(null, blk)
  })
}

Iterator.prototype.seek = function (offset, cb) {
  // TODO: do binary search through the indexes instead ...
  var self = this
  var pos = this.position
  var bytes = offset

  for (var i = 0; i < this.tree.index.length; i++) {
    if (offset < this.tree.index[i]) break
    offset -= this.tree.index[i]
  }

  this._block(this._end + i, function (err, dir) {
    if (err) return cb(err)
    if (!dir) return cb(new Error('Missing block directory'))

    var len = 0
    for (var j = 0; j < BLOCKS_PER_DIRECTORY; j++) {
      len = dir.readUInt16BE(2 * j)
      if (offset < len) break
      offset -= len
    }

    pos.block = i * BLOCKS_PER_DIRECTORY + j
    pos.bytes = bytes - offset
    pos.offset = offset

    cb()
  })
}

Iterator.prototype._block = function (index, cb) {
  if (index >= this.tree.blocks) return cb(null, null)
  var self = this
  this.drive._byIndex.get(this._pointer + '!' + (2 * index), function (err, hash) {
    if (err) return cb(err)
    self.drive._byHash.get(hash.toString('hex'), function (err, node) {
      if (err) return cb(err)
      if (node.block) return cb(null, node.block)
      var ext = node.external
      self.drive._readAndVerify(ext.filename, ext.start, ext.length, hash, cb)
    })
  })
}
