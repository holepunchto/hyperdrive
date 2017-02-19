var tape = require('tape')
var memdb = require('memdb')
var hyperdrive = require('../')

tape('checkpoints', function (t) {
  var drive = hyperdrive(memdb())

  var archive = drive.createArchive({ live: true })

  // write 1.0.0
  var ws = archive.createFileWriteStream('hello.txt')
  ws.end('BEEP BOOP\n')
  ws.once('finish', function () {
    archive.checkpoint({ name: '1.0.0', description: 'The first commit' }, function (err) {
      t.error(err, 'no error')

      // write 2.0.0
      var ws = archive.createFileWriteStream('hello.txt')
      ws.end('BOOP BEEP\n')
      ws.once('finish', function () {
        archive.checkpoint({ name: '2.0.0', description: 'The second commit' }, function (err) {
          t.error(err, 'no error')

          archive.checkpoints(function (err, checkpoints) {
            t.error(err, 'no error')

            t.same(checkpoints.length, 2)
            t.same(checkpoints[0].name, '1.0.0')
            t.same(checkpoints[1].name, '2.0.0')
            t.same(checkpoints[0].description, 'The first commit')
            t.same(checkpoints[1].description, 'The second commit')
            t.end()
          })
        })
      })
    })
  })
})

tape('checkpoint locking', function (t) {
  t.plan(2)

  var drive = hyperdrive(memdb())
  var archive = drive.createArchive({ live: true })

  archive.checkpoint({ name: '1.0.0' }, function (err) {
    t.error(err, 'no error')
  })
  archive.checkpoint({ name: '1.0.1' }, function (err) {
    t.ok(err, 'lock was not available')
  })
})

tape('checkpoint name is not reusable', function (t) {
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive({ live: true })

  archive.checkpoint({ name: '1.0.0' }, function (err) {
    t.error(err, 'no error')

    archive.checkpoint({ name: '1.0.0' }, function (err) {
      t.ok(err, err.message)
      t.end()
    })
  })
})
