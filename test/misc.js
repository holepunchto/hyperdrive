var tape = require('tape')
var memdb = require('memdb')
var path = require('path')
var raf = require('random-access-file')
var hyperdrive = require('../')

tape('list', function (t) {
  var drive = hyperdrive(memdb())

  var archive = drive.createArchive({
    file: function (name) {
      return raf(path.join(__dirname, name), {readable: true, writable: false})
    }
  })

  archive.append('misc.js')
  archive.append('replicates.js')

  archive.finalize(function () {
    archive.list(function (err, list) {
      t.error(err, 'no error')
      t.same(list.length, 2, 'two entries')
      t.same(list[0].type, 'file')
      t.same(list[0].name, 'misc.js')
      t.same(list[1].type, 'file')
      t.same(list[1].name, 'replicates.js')
      t.end()
    })
  })
})

tape('download file', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())

  var archive = drive.createArchive({
    file: function (name) {
      return raf(path.join(__dirname, name), {readable: true, writable: false})
    }
  })

  archive.append('misc.js', function (err) {
    t.error(err, 'no error')
  })

  archive.finalize(function (err) {
    t.error(err, 'no error')

    var clone = driveClone.createArchive(archive.key)

    clone.download(0, function (err) {
      t.error(err, 'no error')
      t.pass('file was downloaded')
      t.end()
    })

    var stream = archive.replicate()
    var streamClone = clone.replicate()

    stream.pipe(streamClone).pipe(stream)
  })
})

tape('empty write stream', function (t) {
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive()

  var ws = archive.createFileWriteStream('empty.txt')

  ws.end(function () {
    t.pass('stream ended')
    t.end()
  })
})
