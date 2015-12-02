var subleveldown = require('subleveldown')
var pack = require('./lib/pack')
var feed = require('./lib/feed')
var swarm = require('./lib/swarm')
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

  this.swarm = swarm(this, opts)
}

Hyperdrive.prototype.list = function () {
  return this._links.createKeyStream()
}

Hyperdrive.prototype.get = function (link) {
  if (typeof link === 'string') link = new Buffer(link, 'hex')
  if (typeof link === 'object' && link.id) {
    return feed(link.id, this, {blocks: link.blocks, index: link.index})
  }
  return feed(link, this, {decode: true}) // TODO: be smarter about when to choose to decode? ext maybe?
}

Hyperdrive.prototype.add = function () {
  return pack(this)
}

if (require.main !== module) return

var drive = Hyperdrive(require('level')('test.db'), {name: 'local'})
var remote = Hyperdrive(require('memdb')(), {name: 'remote'})

var f = remote.get('0fc4a1644ec17df7e69a35a35fe1eb7e3823b41576dc2dab783ea41357a19487')

var s1 = drive.swarm.createStream()
var s2 = remote.swarm.createStream()

s1.pipe(s2).pipe(s1)

f.get(0, function (err, entry) {
  console.log(entry, '<-- metadata feed')
  var f2 = remote.get(entry.link)
  f2.get(0, function () {
    f2.get(4, function (err, blk) {
      console.log('-->', blk)
    })
  })
  // var nested = drive.get(entry.link)
})

// drive.list().on('data', function (data) {
//   console.log(data)
// })

// var pack = drive.add()

// var s = pack.entry({
//   name: 'hello.txt',
//   mode: 100
// })

// s.write('a')
// s.write('b')
// s.write('c')
// s.write('d')
// s.write('e')

// s.end()

// pack.finalize(function () {
//   console.log(pack.blocks, pack.id)
// })
