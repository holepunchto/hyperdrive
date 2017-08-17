var tape = require('tape')
var signatures = require('sodium-signatures')
var create = require('./helpers/create')

tape('write and read', function (t) {
  var archive = create()

  archive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    archive.readFile('/hello.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, new Buffer('world'))
      t.end()
    })
  })
})

tape('write and read (2 parallel)', function (t) {
  t.plan(6)

  var archive = create()

  archive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    archive.readFile('/hello.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, new Buffer('world'))
    })
  })

  archive.writeFile('/world.txt', 'hello', function (err) {
    t.error(err, 'no error')
    archive.readFile('/world.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, new Buffer('hello'))
    })
  })
})

tape('write and read (sparse)', function (t) {
  t.plan(2)

  var archive = create()
  archive.on('ready', function () {
    var clone = create(archive.key, {sparse: true})

    archive.writeFile('/hello.txt', 'world', function (err) {
      t.error(err, 'no error')
      var stream = clone.replicate()
      stream.pipe(archive.replicate()).pipe(stream)

      var readStream = clone.createReadStream('/hello.txt')
      readStream.on('data', function (data) {
        t.same(data.toString(), 'world')
      })
    })
  })
})

tape('write and unlink', function (t) {
  var archive = create()

  archive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    archive.unlink('/hello.txt', function (err) {
      t.error(err, 'no error')
      archive.readFile('/hello.txt', function (err) {
        t.ok(err, 'had error')
        t.end()
      })
    })
  })
})

tape('root is always there', function (t) {
  var archive = create()

  archive.access('/', function (err) {
    t.error(err, 'no error')
    archive.readdir('/', function (err, list) {
      t.error(err, 'no error')
      t.same(list, [])
      t.end()
    })
  })
})

tape('owner is writable', function (t) {
  var archive = create()

  archive.on('ready', function () {
    t.ok(archive.writable)
    t.ok(archive.metadata.writable)
    t.ok(archive.content.writable)
    t.end()
  })
})

tape('provide keypair', function (t) {
  var keyPair = signatures.keyPair()
  var archive = create(keyPair.publicKey, {secretKey: keyPair.secretKey})

  archive.on('ready', function () {
    t.ok(archive.writable)
    t.ok(archive.metadata.writable)
    t.ok(archive.content.writable)
    t.ok(keyPair.publicKey.equals(archive.key))

    archive.writeFile('/hello.txt', 'world', function (err) {
      t.error(err, 'no error')
      archive.readFile('/hello.txt', function (err, buf) {
        t.error(err, 'no error')
        t.same(buf, new Buffer('world'))
        t.end()
      })
    })
  })
})
