const tape = require('tape')
const tmp = require('temporary-directory')
const create = require('./helpers/create')
const hyperdrive = require('..')

tape('ram storage', function (t) {
  var drive = create()

  drive.ready(function () {
    t.ok(drive.metadata.writable, 'drive metadata is writable')
    t.ok(drive.contentWritable, 'drive content is writable')
    t.end()
  })
})

tape('dir storage with resume', function (t) {
  tmp(function (err, dir, cleanup) {
    t.ifError(err)
    var drive = hyperdrive(dir)
    drive.ready(function () {
      t.ok(drive.metadata.writable, 'drive metadata is writable')
      t.ok(drive.contentWritable, 'drive content is writable')
      t.same(drive.version, 1, 'drive has version 1')
      drive.close(function (err) {
        t.ifError(err)

        var drive2 = hyperdrive(dir)
        drive2.ready(function (err) {
          t.error(err, 'no error')
          t.ok(drive2.metadata.writable, 'drive2 metadata is writable')
          t.ok(drive2.contentWritable, 'drive2 content is writable')
          t.same(drive2.version, 1, 'drive has version 1')

          cleanup(function (err) {
            t.ifError(err)
            t.end()
          })
        })
      })
    })
  })
})

tape('dir storage for non-writable drive', function (t) {
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
  var drive = hyperdrive('/')
  drive.on('error', function (err) {
    t.ok(err, 'got error')
  })
})

tape('write and read (sparse)', function (t) {
  t.plan(3)

  tmp(function (err, dir, cleanup) {
    t.ifError(err)
    var drive = hyperdrive(dir)
    drive.on('ready', function () {
      var clone = create(drive.key, { sparse: true })
      clone.on('ready', function () {
        drive.writeFile('/hello.txt', 'world', function (err) {
          t.error(err, 'no error')
          var stream = clone.replicate({ live: true, encrypt: false })
          stream.pipe(drive.replicate({ live: true, encrypt: false })).pipe(stream)
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
  var drive = create()
  drive.on('ready', function () {
    var clone = create(drive.key, { sparse: true })
    drive.writeFile('/hello.txt', 'world', function (err) {
      t.error(err, 'no error')
      drive.writeFile('/hello2.txt', 'world', function (err) {
        t.error(err, 'no error')
        var stream = clone.replicate({ live: true, encrypt: false })
        stream.pipe(drive.replicate({ live: true, encrypt: false })).pipe(stream)
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
