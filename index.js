var subleveldown = require('subleveldown')
var pack = require('./lib/pack')
var feed = require('./lib/feed')
var swarm = require('./lib/swarm')
var feedState = require('./lib/feed-state')
var messages = require('./lib/messages')

module.exports = Hyperdrive

function Hyperdrive (db, opts) {
  if (!(this instanceof Hyperdrive)) return new Hyperdrive(db, opts)
  if (!opts) opts = {}

  this.db = db
  this._hashes = subleveldown(db, 'hashes', {valueEncoding: 'binary'})
  this._blocks = subleveldown(db, 'blocks', {valueEncoding: 'binary'})
  this._bitfields = subleveldown(db, 'bitfields', {valueEncoding: 'binary'})
  this._links = subleveldown(db, 'links', {valueEncoding: messages.Link})
  this._opened = {}

  this.swarm = swarm(this, opts)
}

Hyperdrive.prototype.createPeerStream = function () {
  return this.swarm.createStream()
}

Hyperdrive.prototype.list = function () {
  return this._links.createKeyStream()
}

Hyperdrive.prototype.get = function (link) {
  if (typeof link === 'string') link = new Buffer(link, 'hex')
  if (typeof link === 'object' && (link.id || link.link)) {
    var entry = null
    if (link.link) {
      entry = link
      link = entry.link
    }
    return feed(link.id, this, {blocks: link.blocks, index: link.index, entry: entry})
  }
  return feed(link, this, {decode: true}) // TODO: be smarter about when to choose to decode? ext maybe?
}

Hyperdrive.prototype.add = function () {
  return pack(this)
}

Hyperdrive.prototype._close = function (link) {
  var id = link.toString('hex')
  delete this._opened[id]
}

Hyperdrive.prototype._open = function (link, opts) {
  var id = link.toString('hex')
  var state = this._opened[id]
  if (state) return state
  state = this._opened[id] = feedState(this, link, opts)
  return state
}
