var equals = require('buffer-equals')
var subleveldown = require('subleveldown')
var hash = require('./lib/hash')
var messages = require('./lib/messages')
var archive = require('./lib/archive')

module.exports = Hyperdrive

function noop () {}

function Hyperdrive (db, opts) {
  if (!(this instanceof Hyperdrive)) return new Hyperdrive(db, opts)
  if (!opts) opts = {}

  this.db = db
  this._read = opts.read || noop
  this._write = opts.write || noop

  this._trees = subleveldown(db, 'trees', {valueEncoding: messages.TreeInfo})
  this._byHash = subleveldown(db, 'by-hash', {valueEncoding: messages.TreeNode})
  this._byIndex = subleveldown(db, 'by-index', {valueEncoding: 'binary'})
}

Hyperdrive.prototype._readAndVerify = function (name, offset, length, checksum, cb) {
  this._read(name, offset, length, function (err, buf) {
    if (err) return cb(err)
    if (!equals(hash.data(buf), checksum)) return cb(new Error('Checksum mismatch'))
    cb(null, buf)
  })
}

Hyperdrive.prototype.list = function () {
  return this._trees.createValueStream()
}

Hyperdrive.prototype.get = function (key) {
  // stuff ...
}

Hyperdrive.prototype.add = function () {
  return archive(this)
}
