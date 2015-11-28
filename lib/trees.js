// TODO: move to new module once external file storage works

var merkleStream = require('merkle-tree-stream')
var pumpify = require('pumpify')
var flat = require('flat-tree')
var bulk = require('bulk-write-stream')
var crypto = require('crypto')
var equals = require('buffer-equals')
var bitfield = require('bitfield')
var low = require('last-one-wins')
var messages = require('./messages')

var BINARY = {valueEncoding: 'binary'}

var ENC = {
  buffer: true,
  decode: function (key) {
    return new Buffer(key.slice('!trees!'.length).toString(), 'hex')
  },
  encode: function (key) {
    return key
  }
}

module.exports = TreeStore

function TreeStore (db, opts) {
  if (!(this instanceof TreeStore)) return new TreeStore(db)
  if (!opts) opts = {}
  this.db = db
  this.hash = opts.hash || require('./hash')
}

TreeStore.prototype.list = function () {
  return this.db.createKeyStream({keyEncoding: ENC, gt: '!trees!', lt: '!trees!~'})
}

TreeStore.prototype.get = function (id, opts, cb) {
  if (typeof opts === 'function') return this.get(id, null, opts)
  if (!opts) opts = {}

  var self = this
  if (!id && typeof opts.blocks === 'number' && opts.root) id = this.hash.info(opts.root, opts.blocks)

  this.db.get('!trees!' + id.toString('hex'), {valueEncoding: 'binary'}, function (err, buf) {
    if (err && err.notFound && typeof opts.blocks === 'number' && opts.root) return create()
    if (err) return cb(err)
    self.db.get('!bitfield!' + id.toString('hex'), {valueEncoding: 'binary'}, function (err, bitfield) {
      if (err && !err.notFound) return cb(err)
      cb(null, new Tree(self, id, bitfield, messages.Tree.decode(buf)))
    })
  })

  function create () {
    self.db.put('!trees!' + id.toString('hex'), messages.Tree.encode(opts), function (err) {
      if (err) return cb(err)
      self.get(id, null, cb)
    })
  }
}

TreeStore.prototype.add = function (opts, cb) {
  if (typeof opts === 'function') return this.add(null, opts)
  if (!opts) opts = {}

  var self = this
  var pointer = opts.pointer || crypto.randomBytes(32)
  var ptr = '!hashes!' + pointer.toString('hex') + '!'
  var blks = '!blocks!' + pointer.toString('hex') + '!'
  var merkle = merkleStream(this.hash)
  var stream = pumpify.obj([merkle, bulk.obj(write, flush)])
  var blocks = 0

  stream.tree = null
  return stream

  function write (nodes, cb) {
    var batch = []

    for (var i = 0; i < nodes.length; i++) {
      batch.push({
        type: 'put',
        key: ptr + nodes[i].index,
        value:  nodes[i].hash
      })

      if (nodes[i].data) {
        batch.push({
          type: 'put',
          key: blks + blocks++,
          value: nodes[i].data
        })
      }
    }

    self.db.batch(batch, cb)
  }

  function flush (cb) {
    var roots = merkle.roots
    var right = null
    var batch = new Array(roots.length - 1 + 1 + 1)
    var i = 0

    while (roots.length) {
      var next = roots.pop()
      if (right) {
        right = self.hash.tree(next.hash, right)
        batch[i++] = {type: 'put', key: ptr + flat.parent(next.index), value: right}
      } else {
        right = next.hash
      }
    }

    var id = self.hash.info(right, blocks)

    var tree = {
      pointer: pointer,
      id: id,
      root: right,
      blocks: blocks
    }

    batch[i++] = {type: 'put', key: '!trees!' + id.toString('hex'), value: messages.Tree.encode(tree)}
    batch[i++] = {type: 'put', key: '!bitfield!' + pointer.toString('hex'), value: fullBitfield(blocks)}

    self.db.batch(batch, function (err) {
      if (err) return cb(err)
      stream.tree = tree
      cb()
    })
  }
}

function Tree (parent, id, bits, opts) {
  this.id = id
  this.root = opts.root
  this.blocks = opts.blocks
  this.bitfield = bitfield(bits || opts.blocks)

  this._db = parent.db
  this._hash = parent.hash
  this._max = this.blocks && 2 * (this.blocks - 1)
  this._root = this._max
  this._pointer = opts.pointer || this.id
  this._hashes = '!hashes!' + this._pointer.toString('hex') + '!'
  this._blks = '!blocks!' + this._pointer.toString('hex') + '!'

  while (flat.leftSpan(this._root)) {
    this._root = flat.parent(this._root)
  }

  var self = this
  var bitfieldKey = '!bitfield!' + this._pointer.toString('hex')

  this._update = low(update)

  function update (buf, cb) {
    self._db.put(bitfieldKey, buf, cb)
  }
}

Tree.prototype.insert = function (req, res, cb) {
  if (!cb) cb = noop
  if (!res.block || !res.hashes || req.hashes.length !== res.hashes.length) return cb(new Error('Checksum mismatch'))

  var self = this
  var offset = 0
  var want = 2 * req.block
  var sibling = 0
  var swap = false
  var sum = this._hash.data(res.block)

  var batch = new Array(res.hashes.length + 2)
  var i = 0

  batch[i++] = {type: 'put', key: this._blks + req.block, value: res.block}
  batch[i++] = {type: 'put', key: this._hashes + want, value: sum}
  loop(null, null)

  function loop (err, hash) {
    if (err) return cb(err)
    if (hash) sum = swap ? self._hash.tree(sum, hash) : self._hash.tree(hash, sum)

    if (offset === req.hashes.length) {
      if (want === self._root) return done(null, self.root)
      return self._db.get(self._hashes + want, BINARY, done)
    }

    sibling = flat.sibling(want)
    swap = sibling > want
    want = flat.parent(want)

    if (blank(sibling, self._max)) {
      return loop(null, null)
    }

    var resolved = resolve(sibling, self._max)
    if (req.hashes[offset] === resolved) {
      batch[i++] = {type: 'put', key: self._hashes + resolved, value: res.hashes[offset]}
      return loop(null, res.hashes[offset++])
    }

    self._db.get(self._hashes + resolved, BINARY, loop)
  }

  function done (err, trusted) {
    if (err) return cb(err)
    if (!equals(sum, trusted)) return cb(new Error('Checksum mismatch'))
    self._db.batch(batch, flush)
  }

  function flush (err) {
    if (err) return cb(err)
    self.bitfield.set(req.block)
    self._update(self.bitfield.buffer, cb)
  }
}

Tree.prototype.has = function (block) {
  return this.bitfield.get(block)
}

Tree.prototype.get = function (block, cb) {
  // TODO: make external
  this._db.get(this._blks + block, BINARY, cb)
}

Tree.prototype.response = function (req, cb) {
  var self = this
  var offset = 0
  var indexes = req.hashes
  var hashes = new Array(indexes.length)
  var error = null
  var response = {block: null, hashes: hashes}
  var missing = 2

  this.get(req.block, done)
  loop(null, null)

  function done (err, blk) {
    if (err) error = err
    if (blk) response.block = blk
    if (!--missing) cb(error, error ? null : response)
  }

  function loop (err, hash) {
    if (err) return cb(err)
    if (hash) hashes[offset++] = hash
    if (offset === hashes.length) return done(null, null)
    self._db.get(self._hashes + indexes[offset], BINARY, loop)
  }
}

Tree.prototype.request = function (block, cb) {
  var self = this
  var hashes = []
  var sibling = 0
  var want = 2 * block

  if (want > this._max) return cb(new Error('Block is out of bounds'))

  loop(null)

  function loop (err) {
    if (err && !err.notFound) return cb(err)
    if (err) hashes.push(sibling)
    if (want === self._root) return cb(null, {block: block, hashes: hashes})

    self._db.get(self._hashes + want, BINARY, function (err, hash) {
      if (!err) return cb(null, {block: block, hashes: hashes})

      sibling = flat.sibling(want)
      want = flat.parent(want)

      if (blank(sibling, self._max)) {
        loop(null)
      } else {
        sibling = resolve(sibling, self._max)
        self._db.get(self._hashes + sibling, BINARY, loop)
      }
    })
  }
}

function resolve (index, max) {
  while (flat.rightSpan(index) > max && blank(flat.rightChild(index), max)) {
    index = flat.leftChild(index)
  }
  return index
}

function blank (index, max) {
  return flat.leftSpan(index) > max
}

function noop () {}

function fullBitfield (size) {
  var rem = size % 8
  var buf = new Buffer((size - rem) / 8 + (rem ? 1 : 0))
  buf.fill(255)
  return buf
}
