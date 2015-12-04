var events = require('events')
var equals = require('buffer-equals')
var flat = require('flat-tree')
var bitfield = require('bitfield')
var thunky = require('thunky')
var prefix = require('sublevel-prefixer')()
var low = require('last-one-wins')
var util = require('util')
var messages = require('./messages')
var hash = require('./hash')

var BITFIELD_OPTIONS = {grow: 5 * 1024 * 1024}

module.exports = FeedInfo

function FeedInfo (drive, id, opts) {
  if (!(this instanceof FeedInfo)) return new FeedInfo(drive, id, opts)
  if (!opts) opts = {}

  events.EventEmitter.call(this)

  var self = this

  this.id = id
  this.blocks = opts.blocks || 0
  this.bitfield = null
  this.index = opts.index || null
  this.pointer = null
  this.prefix = ''
  this.want = []
  this.peers = []

  this.drive = drive
  this.opened = false

  this.open = thunky(function (cb) {
    self.drive._links.get(id.toString('hex'), function (_, link) {
      if (link) {
        self.blocks = link.blocks
        if (link.index) self.index = link.index
        self.pointer = link.pointer || link.id
      } else {
        self.pointer = id
      }
      self.prefix = prefix(self.pointer.toString('hex'), '')
      self.drive._bitfields.get(id.toString('hex'), function (_, bits) {
        self.bitfield = bitfield(bits || self.blocks || 1, BITFIELD_OPTIONS)
        cb()
      })
    })
  })

  this._sync = low(function (link, cb) {
    if (link) {
      self.drive.db.batch([{
        type: 'put',
        key: prefix('links', id.toString('hex')),
        value: messages.Link.encode({
          pointer: self.pointer,
          id: self.id,
          blocks: self.blocks,
          index: self.index
        })
      }, {
        type: 'put',
        key: prefix('bitfield', id.toString('hex')),
        value: self.bitfield.buffer
      }], cb)
    } else {
      self.drive._bitfields.put(id.toString('hex'), self.bitfield.buffer, cb)
    }
  })
}

util.inherits(FeedInfo, events.EventEmitter)

FeedInfo.prototype.proof = function (block, have, cb) {
  if (block >= this.blocks) return cb(null, [])

  var proof = []
  var limit = 2 * this.blocks

  if (!have.get(2 * block)) {
    var want = flat.sibling(2 * block)
    var needsRoots = true

    while (flat.rightSpan(want) < limit) {
      if (!have.get(want)) {
        proof.push({
          index: want,
          hash: null
        })
      }

      var parent = flat.parent(want)
      if (have.get(parent)) {
        needsRoots = false
        break
      }

      want = flat.sibling(parent)
    }

    if (needsRoots) {
      var roots = flat.fullRoots(limit)
      for (var i = 0; i < roots.length; i++) {
        proof.push({
          index: roots[i],
          hash: null
        })
      }
    }
  }

  getHashes(this.drive._hashes, this.prefix, proof, cb)
}

function getHashes (hashes, prefix, proof, cb) {
  var i = 0
  loop()

  function loop () {
    if (i === proof.length) return cb(null, proof)
    hashes.get(prefix + proof[i].index, next)
  }

  function next (err, hash) {
    if (err) return cb(err)
    proof[i++].hash = hash
    loop()
  }
}

FeedInfo.prototype.putRoots = function (block, data, proof, cb) {
  if (!cb) cb = noop

  var self = this
  var roots = this._verifyRoots(proof)
  if (!roots) return cb(new Error('Validation failed'))

  var proofRoots = proof.slice(-roots.length)
  var batch = new Array(proofRoots.length)

  for (var i = 0; i < proofRoots.length; i++) {
    var next = proofRoots[i]
    batch[i] = {type: 'put', key: this.prefix + next.index, value: next.hash}
  }

  this.drive._hashes.batch(batch, function (err) {
    if (err) return cb(err)
    self._sync(true, function (err) {
      if (err) return cb(err)

      var remove = []
      for (var i = 0; i < self.want.length; i++) {
        if (self.want[i].block >= self.blocks) {
          remove.push(i)
        }
      }
      for (var j = remove.length - 1; j >= 0; j--) {
        var want = self.want[remove[j]]
        self.want.splice(remove[j], 1)
        want.callback(new Error('Block out of bounds')) // null,null instead?
      }

      self.put(block, data, proof, cb)
    })
  })
}

FeedInfo.prototype.put = function (block, data, proof, cb) {
  if (!cb) cb = noop
  if (!this.blocks) return this.putRoots(block, data, proof, cb)

  var self = this
  var top = hash.data(data)
  var want = 2 * block
  var offset = 0
  var swap = false
  var hashes = this.drive._hashes
  var roots = null

  var digest = {
    index: want,
    hash: top
  }

  hashes.get(this.prefix + want, loop)

  function finalize (err) {
    if (err) return cb(err)
    self.bitfield.set(block)

    var remove = []
    for (var i = 0; i < self.want.length; i++) {
      if (self.want[i].block === block) remove.push(i)
    }
    for (var j = remove.length - 1; j >= 0; j--) {
      var want = self.want[remove[j]]
      self.want.splice(remove[j], 1)
      want.callback(null, data)
    }

    self._sync(false, cb)
  }

  function write (err) {
    if (err) return cb(err)
    self.drive._blocks.put(digest.hash.toString('hex'), data, finalize)
  }

  function validated () {
    if (want === digest.index) return write(null)

    var batch = new Array(1 + offset)
    var i = 0
    batch[i++] = {type: 'put', key: self.prefix + digest.index, value: digest.hash}
    for (i = 0; i < offset; i++) {
      var next = proof[i]
      batch[i + 1] = {type: 'put', key: self.prefix + next.index, value: next.hash}
    }

    hashes.batch(batch, write)
  }

  function loop (_, trusted) {
    if (trusted && equals(trusted, top)) return validated()

    var sibling = flat.sibling(want)
    swap = sibling < want
    want = flat.parent(sibling)

    if (offset < proof.length && proof[offset].index === sibling) {
      next(null, proof[offset++].hash)
    } else {
      hashes.get(self.prefix + sibling, next)
    }
  }

  function next (err, sibling) {
    if (err) return cb(err)
    if (swap) top = hash.tree(sibling, top)
    else top = hash.tree(top, sibling)
    hashes.get(self.prefix + want, loop)
  }
}

FeedInfo.prototype._verifyRoots = function (proof) {
  if (!proof.length) return null

  var blocks = (flat.rightSpan(proof[proof.length - 1].index) + 2) / 2
  var roots = flat.fullRoots(2 * blocks)

  if (proof.length < roots.length) return null

  var proofRoots = proof.slice(-roots.length)
  for (var i = 0; i < roots.length; i++) {
    if (proofRoots[i].index !== roots[i]) return null
  }

  if (!equals(this.id, hash.root(proofRoots))) return null

  this.blocks = blocks
  return roots
}

FeedInfo.prototype.get = function (block, cb) {
  if (this.blocks && block >= this.blocks) return cb(new Error('Block out of bounds'))

  if (!this.bitfield.get(block)) {
    this.want.push({block: block, callback: cb})
    this.emit('want', block)
    return
  }

  var self = this
  this.drive._hashes.get(self.prefix + (2 * block), function (err, hash) {
    if (err) return cb(err)
    self.drive._blocks.get(hash.toString('hex'), cb)
  })
}

function noop () {}
