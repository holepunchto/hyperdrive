var tape = require('tape')
var tmp = require('temporary-directory')
var create = require('./helpers/create')
var Hyperdrive = require('..')

tape('ram storage', function (t) {
  var archive = create()

  archive.ready(function () {
    t.ok(archive.metadataFeed.writable, 'archive metadata is writable')
    t.ok(archive.contentFeed.writable, 'archive content is writable')
    t.end()
  })
})

tape('dir storage with resume', function (t) {
  tmp(function (err, dir, cleanup) {
    t.ifError(err)
    var archive = new Hyperdrive(dir)
    archive.ready(function () {
      t.ok(archive.metadataFeed.writable, 'archive metadata is writable')
      t.ok(archive.contentFeed.writable, 'archive content is writable')
      t.same(archive.version, 1, 'archive has version 1')
      archive.close(function (err) {
        t.ifError(err)

        var archive2 = new Hyperdrive(dir)
        archive2.ready(function (err) {
          t.ok(archive2.metadataFeed.writable, 'archive2 metadata is writable')
          t.ok(archive2.contentFeed.writable, 'archive2 content is writable')
          t.same(archive2.version, 1, 'archive has version 1')

          cleanup(function (err) {
            t.ifError(err)
            t.end()
          })
        })
      })
    })
  })
})

tape('dir storage for non-writable archive', function (t) {
  var src = create()
  src.ready(function () {
    tmp(function (err, dir, cleanup) {
      t.ifError(err)

      var clone = new Hyperdrive(dir, src.key)
      clone.on('content', function () {
        t.ok(!clone.metadataFeed.writable, 'clone metadata not writable')
        t.ok(!clone.contentFeed.writable, 'clone content not writable')
        t.same(clone.key, src.key, 'keys match')
        cleanup(function (err) {
          t.ifError(err)
          t.end()
        })
      })

      var stream = clone.replicate()
      stream.pipe(src.replicate()).pipe(stream)
    })
  })
})

tape('dir storage without permissions emits error', function (t) {
  t.plan(1)
  var archive = new Hyperdrive('/')
  archive.on('error', function (err) {
    t.ok(err, 'got error')
  })
})

tape('write and read (sparse)', function (t) {
  t.plan(3)

  tmp(function (err, dir, cleanup) {
    t.ifError(err)
    var archive = new Hyperdrive(dir)
    archive.on('ready', function () {
      var clone = create(archive.key, {sparse: true})
      clone.on('ready', function () {
        archive.writeFile('/hello.txt', 'world', function (err) {
          t.error(err, 'no error')
          var stream = clone.replicate()
          stream.pipe(archive.replicate()).pipe(stream)
          var readStream = clone.createReadStream('/hello.txt')
          readStream.on('error', function (err) {
            t.error(err, 'no error')
          })
          readStream.on('data', function (data) {
            t.same(data.toString(), 'world')
          })
        })
      })
    })
  })
})

tape('sparse read/write two files', function (t) {
  var archive = create()
  archive.on('ready', function () {
    var clone = create(archive.key, {sparse: true})
    archive.writeFile('/hello.txt', 'world', function (err) {
      t.error(err, 'no error')
      archive.writeFile('/hello2.txt', 'world', function (err) {
        t.error(err, 'no error')
        var stream = clone.replicate()
        stream.pipe(archive.replicate()).pipe(stream)
        clone.metadataFeed.update(start)
      })
    })

    function start () {
      clone.stat('/hello.txt', function (err, stat) {
        t.error(err, 'no error')
        t.ok(stat, 'has stat')
        clone.readFile('/hello.txt', function (err, data) {
          t.error(err, 'no error')
          t.same(data.toString(), 'world', 'data ok')
          clone.stat('/hello2.txt', function (err, stat) {
            t.error(err, 'no error')
            t.ok(stat, 'has stat')
            clone.readFile('/hello2.txt', function (err, data) {
              t.error(err, 'no error')
              t.same(data.toString(), 'world', 'data ok')
              t.end()
            })
          })
        })
      })
    }
  })
})
