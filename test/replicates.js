var tape = require('tape')
var memdb = require('memdb')
var path = require('path')
var fs = require('fs')
var tmp = require('tmp')
var raf = require('random-access-file')
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

tape('replicates file after update without raf opts', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())

  var archive = drive.createArchive({
    file: function (name) {
      return raf(path.join(__dirname, name))
    }
  })

  var testFile = path.join(__dirname, 'test.txt')

  fs.writeFile(testFile, 'hello', function (err) {
    t.error(err, 'no err')

    archive.append('test.txt', function (err) {
      t.error(err, 'no error')

      fs.appendFile(testFile, '\nworld', function (err) {
        t.error(err, 'no err')

        archive.append('test.txt', function (err) {
          t.error(err, 'no error')
          doClone()
        })
      })
    })
  })

  function doClone () {
    var clone = driveClone.createArchive(archive.key)
    var buf = []

    clone.open(function () {
      clone.content.on('download-finished', function () {
        clone.createFileReadStream(0)
        .on('data', function (data) {
          buf.push(data)
        })
        .on('end', function () {
          t.same(Buffer.concat(buf), fs.readFileSync(testFile))
          fs.unlink(testFile, function () {
            t.end()
          })
        })
      })
    })

    var stream = archive.replicate()
    var streamClone = clone.replicate()

    stream.pipe(streamClone).pipe(stream)
  }
})

tape('replicates file after update with raf opts', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())

  var archive = drive.createArchive({
    file: function (name, opts) {
      return raf(path.join(__dirname, name), opts && typeof opts.length === 'number' && {length: opts.length})
    }
  })

  var testFile = path.join(__dirname, 'test.txt')

  fs.writeFile(testFile, 'hello', function (err) {
    t.error(err, 'no err')

    archive.append('test.txt', function (err) {
      t.error(err, 'no error')

      fs.appendFile(testFile, '\nworld', function (err) {
        t.error(err, 'no err')

        archive.append('test.txt', function (err) {
          t.error(err, 'no error')
          doClone()
        })
      })
    })
  })

  function doClone () {
    var clone = driveClone.createArchive(archive.key, {
      verifyReplicationReads: true
    })
    var buf = []

    clone.open(function () {
      t.pass('open')
      clone.content.on('download-finished', function () {
        clone.createFileReadStream(0)
        .on('data', function (data) {
          buf.push(data)
        })
        .on('end', function () {
          t.same(Buffer.concat(buf), fs.readFileSync(testFile))
          fs.unlink(testFile, function () {
            t.end()
          })
        })
      })
    })

    var stream = archive.replicate()
    var streamClone = clone.replicate()

    stream.pipe(streamClone).pipe(stream)
  }
})

tape('replicates file after update via download with raf opts', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())

  var archive = drive.createArchive({
    file: function (name, opts) {
      return raf(path.join(__dirname, name), opts && typeof opts.length === 'number' && {length: opts.length})
    }
  })

  var testFile = path.join(__dirname, 'test.txt')

  fs.writeFile(testFile, 'hello', function (err) {
    t.error(err, 'no err')

    archive.append('test.txt', function (err) {
      t.error(err, 'no error')

      fs.appendFile(testFile, '\nworld', function (err) {
        t.error(err, 'no err')

        archive.append('test.txt', function (err) {
          t.error(err, 'no error')
          doClone()
        })
      })
    })
  })

  function doClone () {
    var clone = driveClone.createArchive(archive.key, {
      verifyReplicationReads: true
    })
    var buf = []

    clone.open(function () {
      clone.download(0, function () {
        clone.createFileReadStream(0)
        .on('data', function (data) {
          buf.push(data)
        })
        .on('end', function () {
          console.log([Buffer.concat(buf).toString(), fs.readFileSync(testFile, 'utf8')])
          t.same(Buffer.concat(buf), fs.readFileSync(testFile))
          fs.unlink(testFile, function () {
            t.end()
          })
        })
      })
    })

    var stream = archive.replicate()
    var streamClone = clone.replicate()

    stream.pipe(streamClone).pipe(stream)
  }
})

tape('replicates file with sparse mode and raf opts', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())

  var archive = drive.createArchive({
    file: function (name) {
      return raf(path.join(__dirname, name))
    }
  })

  var testFile = path.join(__dirname, 'test.txt')

  fs.writeFile(testFile, 'hello', function (err) {
    t.error(err, 'no err')

    archive.append('test.txt', function (err) {
      t.error(err, 'no error')

      fs.appendFile(testFile, '\nworld', function (err) {
        t.error(err, 'no err')

        archive.append('test.txt', function (err) {
          t.error(err, 'no error')
          doClone()
        })
      })
    })
  })

  function doClone () {
    var clone = driveClone.createArchive(archive.key, {
      sparse: true,
      verifyReplicationReads: true,
      file: function (name, opts) {
        return raf(path.join(__dirname, name), opts && typeof opts.length === 'number' && {length: opts.length})
      }
    })
    var buf = []

    clone.open(function () {
      clone.list(function (_, entries) {
        t.pass('open')
        clone.content.on('download-finished', function () {
          clone.createFileReadStream(entries[entries.length - 1])
          .on('data', function (data) {
            buf.push(data)
          })
          .on('end', function () {
            t.same(Buffer.concat(buf), fs.readFileSync(testFile))
            fs.unlink(testFile, function () {
              clone.list(function (_, entries) {
                console.log(entries)
                t.end()
              })
            })
          })
        })
      })
    })

    var stream = archive.replicate()
    var streamClone = clone.replicate()

    stream.pipe(streamClone).pipe(stream)
  }
})
