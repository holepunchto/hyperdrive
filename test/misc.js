var fs = require('fs')
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

tape('list offset', function (t) {
  t.plan(10)
  var drive = hyperdrive(memdb())

  var archive = drive.createArchive({
    file: function (name) {
      return raf(path.join(__dirname, name), {readable: true, writable: false})
    }
  })

  archive.append('misc.js')
  archive.append('replicates.js')
  archive.append('overwrite.js')

  archive.finalize(function () {
    archive.list({ offset: 1 }, function (err, list) {
      t.error(err, 'no error')
      t.same(list.length, 2, 'two entries with offset: 1')
      t.same(list[0].type, 'file')
      t.same(list[0].name, 'replicates.js')
      t.same(list[1].type, 'file')
      t.same(list[1].name, 'overwrite.js')
    })
    archive.list({ offset: 2 }, function (err, list) {
      t.error(err, 'no error')
      t.same(list.length, 1, 'one entry with offset: 2')
      t.same(list[0].type, 'file')
      t.same(list[0].name, 'overwrite.js')
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

tape('bytes/block offsets with one file', function (t) {
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive({
    file: function (name) {
      return raf(path.join(__dirname, name), {readable: true, writable: false})
    }
  })

  archive.append('misc.js', function (err) {
    t.error(err, 'no error')
    archive.list(function (err, entries) {
      t.error(err, 'no error')
      t.same(entries.length, 1, 'one entry')
      t.same(entries[0].content.blockOffset, 0, 'block offset is 0')
      t.same(entries[0].content.bytesOffset, 0, 'bytes offset is 0')
      t.pass('single-file bytes/block offset is correct')
      t.end()
    })
  })
})

tape('bytes/block offsets with two files', function (t) {
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive({
    file: function (name) {
      return raf(path.join(__dirname, name), {readable: true, writable: false})
    }
  })

  var correctBytes = fs.readFileSync(path.join(__dirname, 'misc.js')).length

  archive.append('misc.js', function (err) {
    t.error(err, 'no error')
    var correctBlocks = archive.content.blocks
    archive.append('misc.js', function (err) {
      t.error(err, 'no error')
      archive.list(function (err, entries) {
        t.error(err, 'no error')
        t.same(entries.length, 2, 'two entries')
        t.same(entries[1].content.bytesOffset, correctBytes, 'correct offset')
        t.same(entries[1].content.blockOffset, correctBlocks, 'correct blocks')
        t.pass('two files bytes/blocks offset is correct')
        t.end()
      })
    })
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
