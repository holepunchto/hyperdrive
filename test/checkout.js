var test = require('tape')
var hyperdrive = require('../')
var memdb = require('memdb')
var concat = require('concat-stream')

test('checkout', function (t) {
  var contents = [
    { 'hello.txt': 'HI' },
    { 'hello.txt': 'HELLO', 'msg.txt': 'WHAT' },
    { 'hello.txt': 'HEY', 'msg.txt': 'SMITHEREENS' },
    { 'hello.txt': 'HOWDY', 'msg.txt': 'AMETHYST' }
  ]
  t.plan(11)
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive(undefined, { live: true })
  var hashes = []
  ;(function next (i) {
    if (i === contents.length) return ready()
    var files = contents[i]
    var pending = 1
    Object.keys(files).forEach(function (file) {
      pending++
      var w = archive.createFileWriteStream(file)
      w.end(files[file])
      w.once('finish', function () {
        if (--pending === 0) done()
      })
    })
    if (--pending === 0) done()

    function done () {
      archive.metadata.head(function (err, hash) {
        t.error(err)
        hashes.push(hash)
        next(i + 1)
      })
    }
  })(0)

  function ready () {
    hashes.forEach(function (hash, i) {
      var ch = archive.checkout(hash)
      verify(ch, contents[i], hash.toString('hex'))
    })
  }

  function verify (ch, files, hash) {
    Object.keys(files).forEach(function (file) {
      var r = ch.createFileReadStream(file)
      r.pipe(concat({ encoding: 'string' }, function (body) {
        t.equal(body, files[file], 'verify ' + hash + ':' + file)
      }))
    })
  }
})
