var tape = require('tape')
var create = require('./helpers/create')
var crypto = require('crypto')

tape('basic cursor', function (t) {
  var drive = create()
  var buf = crypto.randomBytes(100 * 1024)

  drive.writeFile('/data', buf, function (err) {
    t.error(err, 'no error')

    var cursor = drive.createCursor('/data')
    var bufs = []

    cursor.next(loop)

    function loop (err, next) {
      t.error(err, 'no error')

      if (!next) {
        t.same(Buffer.concat(bufs), buf)
        t.end()
        return
      } else {
        bufs.push(next)
      }

      cursor.next(loop)
    }
  })
})

tape('basic cursor bigger', function (t) {
  var drive = create()
  var buf = crypto.randomBytes(1024 * 1024)

  drive.writeFile('/data', buf, function (err) {
    t.error(err, 'no error')

    var cursor = drive.createCursor('/data')
    var bufs = []

    cursor.next(loop)

    function loop (err, next) {
      t.error(err, 'no error')

      if (!next) {
        t.same(Buffer.concat(bufs), buf)
        t.end()
        return
      } else {
        bufs.push(next)
      }

      cursor.next(loop)
    }
  })
})

tape('cursor random access', function (t) {
  var drive = create()
  var buf = crypto.randomBytes(1024 * 1024)

  drive.writeFile('/data', buf, function (err) {
    t.error(err, 'no error')

    var cursor = drive.createCursor('/data')

    cursor.seek(1024 * 1024 - 10).next(function (err, next) {
      t.error(err, 'no error')
      t.same(next, buf.slice(1024 * 1024 - 10))

      cursor.seek(400 * 1024).next(function (err, next) {
        t.error(err, 'no error')
        t.same(next.slice(0, 1000), buf.slice(400 * 1024, 400 * 1024 + 1000))

        cursor.next(function (err, nextNext) {
          t.error(err, 'no error')
          var offset = 400 * 1024 + next.length
          t.same(nextNext, buf.slice(offset, offset + nextNext.length))
          t.end()
        })
      })
    })
  })
})
