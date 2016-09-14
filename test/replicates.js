var tape = require('tape')
var memdb = require('memdb')
var path = require('path')
var fs = require('fs')
var tmp = require('tmp')
var raf = require('random-access-file')
var concat = require('concat-stream')
var hyperdrive = require('../')

tape('replicates file', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())

  var archive = drive.createArchive({
    file: function (name) {
      return raf(path.join(__dirname, name))
    }
  })

  archive.append('replicates.js', function (err) {
    t.error(err, 'no error')
  })

  archive.finalize(function (err) {
    t.error(err, 'no error')

    var clone = driveClone.createArchive(archive.key)
    var buf = []

    clone.download(0, function (err) {
      t.error(err, 'no error')

      clone.createFileReadStream(0)
        .on('data', function (data) {
          buf.push(data)
        })
        .on('end', function () {
          t.same(Buffer.concat(buf), fs.readFileSync(__filename))
          t.end()
        })
    })

    var stream = archive.replicate()
    var streamClone = clone.replicate()

    stream.pipe(streamClone).pipe(stream)
  })
})

tape('replicates file with sparse mode', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())

  var archive = drive.createArchive({
    file: function (name) {
      return raf(path.join(__dirname, name))
    }
  })

  archive.append('replicates.js', function (err) {
    t.error(err, 'no error')
  })

  archive.finalize(function (err) {
    t.error(err, 'no error')

    var clone = driveClone.createArchive(archive.key, {sparse: true})
    var buf = []

    clone.download(0, function (err) {
      t.error(err, 'no error')

      clone.createFileReadStream(0)
        .on('data', function (data) {
          buf.push(data)
        })
        .on('end', function () {
          t.same(Buffer.concat(buf), fs.readFileSync(__filename))
          t.end()
        })
    })

    var stream = archive.replicate()
    var streamClone = clone.replicate()

    stream.pipe(streamClone).pipe(stream)
  })
})

tape('replicates empty files', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())

  var archive = drive.createArchive()

  archive.createFileWriteStream('empty.txt').end()

  archive.finalize(function (err) {
    t.error(err, 'no error')

    var clone = driveClone.createArchive(archive.key)

    clone.get(0, function (err, entry) {
      t.error(err, 'no error')
      t.same(entry.name, 'empty.txt')
      t.same(entry.length, 0, 'empty')

      clone.download(0, function (err) {
        t.error(err, 'no error')
        t.end()
      })
    })

    var stream = archive.replicate()
    var streamClone = clone.replicate()

    stream.pipe(streamClone).pipe(stream)
  })
})

tape('replicates empty directories', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())

  var archive = drive.createArchive()

  archive.append({
    type: 'directory',
    name: 'a-dir'
  })

  archive.finalize(function (err) {
    t.error(err, 'no error')

    var clone = driveClone.createArchive(archive.key)

    clone.get(0, function (err, entry) {
      t.error(err, 'no error')
      t.same(entry.type, 'directory')
      t.same(entry.name, 'a-dir')
      t.same(entry.length, 0, 'empty')

      clone.download(0, function (err) {
        t.error(err, 'no error')
        t.end()
      })
    })

    var stream = archive.replicate()
    var streamClone = clone.replicate()

    stream.pipe(streamClone).pipe(stream)
  })
})

tape('downloads empty files to fs', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())
  var tmpdir = tmp.dirSync()

  var archive = drive.createArchive()

  archive.createFileWriteStream('empty.txt').end()

  archive.finalize(function (err) {
    t.error(err, 'no error')

    var clone = driveClone.createArchive(archive.key, {
      file: function (name) {
        return raf(path.join(tmpdir.name, name))
      }
    })

    clone.get(0, function (err, entry) {
      t.error(err, 'no error')
      t.same(entry.name, 'empty.txt')
      t.same(entry.length, 0, 'empty')

      clone.download(entry, function (err) {
        var fileList = fs.readdirSync(tmpdir.name).join(' ')
        t.ok(fileList.indexOf('empty.txt') > -1, 'has empty file')
        t.error(err, 'no error')
        t.end()
      })
    })

    var stream = archive.replicate()
    var streamClone = clone.replicate()

    stream.pipe(streamClone).pipe(stream)
  })
})

tape('replicates static archives', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())

  var archive = drive.createArchive({
    live: false
  })

  archive.createFileWriteStream('empty.txt').end(function () {
    archive.finalize(function () {
      var clone = driveClone.createArchive(archive.key)

      clone.download(0, function () {
        t.pass('archive replicated')
        t.end()
      })

      var stream = archive.replicate()
      var streamClone = clone.replicate()

      stream.pipe(streamClone).pipe(stream)
    })
  })
})

tape('downloads empty directories to fs', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())
  var tmpdir = tmp.dirSync()

  var archive = drive.createArchive()

  archive.append({
    type: 'directory',
    name: 'a-dir'
  })

  archive.finalize(function (err) {
    t.error(err, 'no error')

    var clone = driveClone.createArchive(archive.key, {
      file: function (name) {
        return raf(path.join(tmpdir.name, name))
      }
    })

    clone.get(0, function (err, entry) {
      t.error(err, 'no error')
        // TODO: change these to t.same
      t.same(entry.type, 'directory')
      t.same(entry.name, 'a-dir')
      t.same(entry.length, 0, 'empty')

      clone.download(entry, function (err) {
        var fileList = fs.readdirSync(tmpdir.name).join(' ')
        // TODO: change this to t.ok
        t.skip(fileList.indexOf('a-dir') > -1, 'has empty dir')
        // TODO: test a-dir is actually a directory
        t.error(err, 'no error')
        t.end()
      })
    })

    var stream = archive.replicate()
    var streamClone = clone.replicate()

    stream.pipe(streamClone).pipe(stream)
  })
})

tape('replicates unlinks', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())
  var tmpdir1 = tmp.dirSync()
  var tmpdir2 = tmp.dirSync()

  var archive = drive.createArchive({
    file: function (name) {
      return raf(path.join(tmpdir1.name, name))
    }
  })

  var clone = driveClone.createArchive(archive.key, {
    file: function (name) {
      return raf(path.join(tmpdir2.name, name))
    }
  })

  var stream = archive.replicate()
  var streamClone = clone.replicate()

  stream.pipe(streamClone).pipe(stream)

  // write hello.txt to original
  var ws = archive.createFileWriteStream('hello.txt')
  ws.end('BEEP BOOP\n')
  ws.on('finish', function () {
    // replicate and ensure content
    clone.download(0, function (err) {
      t.error(err, 'no error')

      clone.createFileReadStream('hello.txt').pipe(concat(function (body) {
        t.equal(body.toString(), 'BEEP BOOP\n')

        // unlink hello.txt from original
        archive.unlink('hello.txt', function (err) {
          t.error(err, 'no error')

          ensureDeleted(path.join(tmpdir1.name, 'hello.txt'), 'original')

          // replicate and ensure deletion
          clone.download(1, function (err) {
            t.error(err, 'no error')

            ensureDeleted(path.join(tmpdir2.name, 'hello.txt'), 'clone')
            t.end()
          })
        })
      }))
    })
  })

  function ensureDeleted (filepath, archiveName) {
    var notFound = true
    try {
      var stat = fs.statSync(filepath)
      // file may not be deleted fully yet due to open handles, but it has been unlinked
      // in this case, the stat.blocks will be zero
      notFound = stat.blocks === 0
    } catch (e) {}
    if (notFound) t.pass(path.basename(filepath) + ' was deleted in ' + archiveName)
    else t.fail(path.basename(filepath) + ' should have been deleted in ' + archiveName)
  }
})
