var tape = require('tape')
var memdb = require('memdb')
var path = require('path')
var fs = require('fs')
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

  var ws = archive.createFileWriteStream('empty.txt')
  ws.end()

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
