var test = require('tape')
var hyperdrive = require('../')
var memdb = require('memdb')
var concat = require('concat-stream')

test('write and read', function (t) {
  t.plan(1)
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive()

  archive.createFileWriteStream('hello.txt').end('BEEP BOOP\n')
  archive.finalize(function () {
    archive.createFileReadStream('hello.txt')
      .pipe(concat(function (body) {
        t.equal(body.toString(), 'BEEP BOOP\n')
      }))
  })
})

test('write and read after replication', function (t) {
  t.plan(1)
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive()

  archive.createFileWriteStream('hello.txt').end('BEEP BOOP\n')
  archive.finalize(function () {
    var reader = drive.createArchive(archive.key)
    reader.createFileReadStream('hello.txt')
      .pipe(concat(function (body) {
        t.equal(body.toString(), 'BEEP BOOP\n')
      }))
    var r = reader.replicate()
    r.pipe(archive.replicate()).pipe(r)
  })
})
