var tape = require('tape')
var memdb = require('memdb')
var path = require('path')
var fs = require('fs')
var os = require('os')
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
  var tmp = path.join(os.tmpdir(), 'hyperdrive-test')
  try { fs.mkdirSync(tmp) } catch (e) { /* ignore error */ }

  var archive = drive.createArchive()

  archive.createFileWriteStream('empty.txt').end()

  archive.finalize(function (err) {
    t.error(err, 'no error')

    var clone = driveClone.createArchive(archive.key, {
      file: function (name) {
        return raf(path.join(tmp, name))
      }
    })

    clone.get(0, function (err, entry) {
      t.error(err, 'no error')
      // TODO: change these to t.same
      t.skip(entry.name, 'empty.txt')
      t.skip(entry.length, 0, 'empty')

      clone.download(entry, function (err) {
        var fileList = fs.readdirSync(tmp).join(' ')
        // TODO: change this to t.ok
        t.skip(fileList.indexOf('empty.txt') > -1, 'has empty file')
        t.error(err, 'no error')
        t.end()
      })
    })

    var stream = archive.replicate()
    var streamClone = clone.replicate()

    stream.pipe(streamClone).pipe(stream)
  })
})

tape('downloads empty directories to fs', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())
  var tmp = path.join(os.tmpdir(), 'hyperdrive-test-2')
  try { fs.mkdirSync(tmp) } catch (e) { /* ignore error */ }

  var archive = drive.createArchive()

  archive.append({
    type: 'directory',
    name: 'a-dir'
  })

  archive.finalize(function (err) {
    t.error(err, 'no error')

    var clone = driveClone.createArchive(archive.key, {
      file: function (name) {
        return raf(path.join(tmp, name))
      }
    })

    clone.get(0, function (err, entry) {
      t.error(err, 'no error')
        // TODO: change these to t.same
      t.skip(entry.type, 'directory')
      t.skip(entry.name, 'a-dir')
      t.skip(entry.length, 0, 'empty')

      clone.download(0, function (err) {
        var fileList = fs.readdirSync(tmp).join(' ')
        // TODO: change this to t.ok
        t.skip(fileList.indexOf('a-dir') > -1, 'has empty dir')
        t.error(err, 'no error')
        t.end()
      })
    })

    var stream = archive.replicate()
    var streamClone = clone.replicate()

    stream.pipe(streamClone).pipe(stream)
  })
})
