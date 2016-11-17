var hypercore = require('hypercore')
var Archive = require('./archive')

module.exports = Drive

function Drive (db, opts) {
  if (!(this instanceof Drive)) return new Drive(db, opts)
  this.core = hypercore(db, opts)
  this.id = this.core.id
}

Drive.prototype.replicate = function (opts) {
  return this.core.replicate(opts)
}

Drive.prototype.unreplicate = function (opts) {
  return this.core.unreplicate(opts)
}

Drive.prototype.createArchive = function (key, opts) {
  if (typeof key === 'object' && !Buffer.isBuffer(key) && key) {
    opts = key
    key = null
  }

  if (typeof key === 'string') {
    key = Buffer(key, 'hex')
  }

  return new Archive(this, key, opts)
}
