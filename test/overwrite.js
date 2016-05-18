var test = require('tape')
var hyperdrive = require('../')
var memdb = require('memdb')
var concat = require('concat-stream')

test('overwrite', function (t) {
  t.plan(2)
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive(undefined, { live: true })

  var w1 = archive.createFileWriteStream('hello.txt')
  w1.end('BEEP BOOP\n')
  w1.once('finish', function () {
    check('BEEP BOOP\n', function () {
      var w2 = archive.createFileWriteStream('hello.txt')
      w2.end('HEY WHATEVER\n')
      w2.once('finsih', function () {
        check('HEY WHATEVER\n')
      })
    })
  })
  function check (msg, cb) {
    archive.createFileReadStream('hello.txt')
      .pipe(concat(function (body) {
        t.equal(body.toString(), msg)
        if (cb) cb()
      }))
  }
})
