const tape = require('tape')
const tmp = require('temporary-directory')
const create = require('./helpers/create')
const hyperdrive = require('..')

tape('ram storage', function (t) {
  var archive = create()

  archive.ready(function () {
    t.ok(archive.metadata.writable, 'archive metadata is writable')
    t.ok(archive.contentWritable, 'archive content is writable')
    t.end()
  })
})

tape('dir storage with resume', function (t) {
  tmp(function (err, dir, cleanup) {
    t.ifError(err)
    var archive = hyperdrive(dir)
    archive.ready(function () {
      t.ok(archive.metadata.writable, 'archive metadata is writable')
      t.ok(archive.contentWritable, 'archive content is writable')
      t.same(archive.version, 1, 'archive has version 1')
      archive.close(function (err) {
        t.ifError(err)

        var archive2 = hyperdrive(dir)
        archive2.ready(function (err) {
          t.error(err, 'no error')
          t.ok(archive2.metadata.writable, 'archive2 metadata is writable')
          t.ok(archive2.contentWritable, 'archive2 content is writable')
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

      var clone = hyperdrive(dir, src.key)
      clone.ready(function () {
        t.ok(!clone.metadata.writable, 'clone metadata not writable')
        t.ok(!clone.contentWritable, 'clone content not writable')
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
  var archive = hyperdrive('/')
  archive.on('error', function (err) {
    t.ok(err, 'got error')
  })
})

tape('write and read (sparse)', function (t) {
  t.plan(3)

  tmp(function (err, dir, cleanup) {
    t.ifError(err)
    var archive = hyperdrive(dir)
    archive.on('ready', function () {
      var clone = create(archive.key, {sparse: true})
      clone.on('ready', function () {
        archive.writeFile('/hello.txt', 'world', function (err) {
          t.error(err, 'no error')
          var stream = clone.replicate({ live: true })
          stream.pipe(archive.replicate({ live: true })).pipe(stream)
          setTimeout(() => {
            var readStream = clone.createReadStream('/hello.txt')
            readStream.on('error', function (err) {
              t.error(err, 'no error')
            })
            readStream.on('data', function (data) {
              t.same(data.toString(), 'world')
            })
          }, 50)
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
        var stream = clone.replicate({ live: true })
        stream.pipe(archive.replicate({ live: true })).pipe(stream)
        clone.metadata.update(start)
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
