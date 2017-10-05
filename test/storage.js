var fs = require('fs')
var path = require('path')
var tape = require('tape')
var tmp = require('temporary-directory')
var datStore = require('dat-storage')
var create = require('./helpers/create')
var hyperdrive = require('..')

tape('ram storage', function (t) {
  var archive = create()

  archive.ready(function () {
    t.ok(archive.metadata.writable, 'archive metadata is writable')
    t.ok(archive.content.writable, 'archive content is writable')
    t.end()
  })
})

tape('dir storage with resume', function (t) {
  tmp(function (err, dir, cleanup) {
    t.ifError(err)
    var archive = hyperdrive(dir)
    archive.ready(function () {
      t.ok(archive.metadata.writable, 'archive metadata is writable')
      t.ok(archive.content.writable, 'archive content is writable')
      t.same(archive.version, 0, 'archive has version 0')
      archive.close(function (err) {
        t.ifError(err)

        var archive2 = hyperdrive(dir)
        archive2.ready(function () {
          t.ok(archive2.metadata.writable, 'archive2 metadata is writable')
          t.ok(archive2.content.writable, 'archive2 content is writable')
          t.same(archive2.version, 0, 'archive has version 0')

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
      clone.on('content', function () {
        t.ok(!clone.metadata.writable, 'clone metadata not writable')
        t.ok(!clone.content.writable, 'clone content not writable')
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

tape('change indexing of content (t -> f)', function (t) {
  tmp(function (err, dir, cleanup) {
    t.ifError(err)
    var archive = hyperdrive(datStore(dir), {indexing: true, latest: true})
    archive.ready(function () {
      archive.writeFile('yay.txt', 'yay', 'utf8', function (err) {
        t.error(err, 'no error')
        fs.readFile(path.join(dir, 'yay.txt'), 'utf8', function (err, data) {
          t.skip(err, 'errors reading from fs') // TODO: should hyperdrive be creating the file on indexing: false
          t.notOk(data, 'no data in file')
          switchIndexing()
        })
      })
    })

    function switchIndexing () {
      archive.content.defaults({indexing: false})
      archive.writeFile('yay2.txt', 'yay', 'utf8', function (err) {
        t.error(err, 'no error')
        fs.readFile(path.join(dir, 'yay2.txt'), 'utf8', function (err, data) {
          t.error(err, 'no error')
          t.same(data, 'yay', 'writes content to fs')
          cleanup(function () {
            t.end()
          })
        })
      })
    }
  })
})

tape('change indexing of content (f -> t)', function (t) {
  tmp(function (err, dir, cleanup) {
    t.ifError(err)
    var archive = hyperdrive(datStore(dir), {indexing: false, latest: true})
    archive.ready(function () {
      archive.writeFile('yay.txt', 'yay', 'utf8', function (err) {
        t.error(err, 'no error')
        fs.readFile(path.join(dir, 'yay.txt'), 'utf8', function (err, data) {
          t.error(err, 'no error')
          t.same(data, 'yay', 'writes content to fs')
          switchIndexing()
        })
      })
    })

    function switchIndexing () {
      archive.content.defaults({indexing: true})
      archive.writeFile('yay2.txt', 'yay', 'utf8', function (err) {
        t.error(err, 'no error')
        fs.readFile(path.join(dir, 'yay2.txt'), 'utf8', function (err, data) {
          t.skip(err, 'errors reading from fs') // TODO: should hyperdrive be creating the file on indexing: false
          t.notOk(data, 'no data in file')
          cleanup(function () {
            t.end()
          })
        })
      })
    }
  })
})
