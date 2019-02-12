const tape = require('tape')
const create = require('./helpers/create')

tape('basic fd read', function (t) {
  const drive = create()
  const content = Buffer.alloc(10000).fill('0123456789abcdefghijklmnopqrstuvwxyz') 

  drive.writeFile('hi', content, function (err) {
    t.error(err, 'no error')

    drive.open('hi', 'r', function (err, fd) {
      t.error(err, 'no error')
      t.same(typeof fd, 'number')
      t.ok(fd > 5)

      const underflow = 37
      const buf = Buffer.alloc(content.length - underflow)
      let pos = 0

      drive.read(fd, buf, 0, buf.length, 0, function (err, bytesRead) {
        t.error(err, 'no error')
        pos += bytesRead
        t.same(bytesRead, buf.length, 'filled the buffer')
        t.same(buf, content.slice(0, buf.length))

        drive.read(fd, buf, 0, buf.length, pos, function (err, bytesRead) {
          t.error(err, 'no error')
          pos += bytesRead
          t.same(bytesRead, underflow, 'read missing bytes')
          t.same(buf.slice(0, underflow), content.slice(content.length - underflow))
          t.same(pos, content.length, 'read full file')

          drive.read(fd, buf, 0, buf.length, pos, function (err, bytesRead) {
            t.error(err, 'no error')
            t.same(bytesRead, 0, 'no more to read')

            drive.close(fd, function (err) {
              t.error(err, 'no error')
              t.end()
            })
          })
        })
      })
    })
  })
})

tape('basic fd read with implicit position', function (t) {
  const drive = create()
  const content = Buffer.alloc(10000).fill('0123456789abcdefghijklmnopqrstuvwxyz') 

  drive.writeFile('hi', content, function (err) {
    t.error(err, 'no error')

    drive.open('hi', 'r', function (err, fd) {
      t.error(err, 'no error')
      t.same(typeof fd, 'number')
      t.ok(fd > 5)

      const underflow = 37
      const buf = Buffer.alloc(content.length - underflow)
      let pos = 0

      drive.read(fd, buf, 0, buf.length, function (err, bytesRead) {
        t.error(err, 'no error')
        pos += bytesRead
        t.same(bytesRead, buf.length, 'filled the buffer')
        t.same(buf, content.slice(0, buf.length))

        drive.read(fd, buf, 0, buf.length, function (err, bytesRead) {
          t.error(err, 'no error')
          pos += bytesRead
          t.same(bytesRead, underflow, 'read missing bytes')
          t.same(buf.slice(0, underflow), content.slice(content.length - underflow))
          t.same(pos, content.length, 'read full file')

          drive.read(fd, buf, 0, buf.length, function (err, bytesRead) {
            t.error(err, 'no error')
            t.same(bytesRead, 0, 'no more to read')

            drive.close(fd, function (err) {
              t.error(err, 'no error')
              t.end()
            })
          })
        })
      })
    })
  })
})

tape('fd read with zero length', function (t) {
  const drive = create()
  const content = Buffer.alloc(10000).fill('0123456789abcdefghijklmnopqrstuvwxyz') 

  drive.writeFile('hi', content, function (err) {
    t.error(err, 'no error')

    drive.open('hi', 'r', function (err, fd) {
      t.error(err, 'no error')

      const buf = Buffer.alloc(content.length)

      drive.read(fd, buf, 0, 0, function (err, bytesRead) {
        t.error(err, 'no error')
        t.same(bytesRead, 0)
        t.end()
      })
    })
  })
})

tape('fd read with out-of-bounds offset', function (t) {
  const drive = create()
  const content = Buffer.alloc(10000).fill('0123456789abcdefghijklmnopqrstuvwxyz') 

  drive.writeFile('hi', content, function (err) {
    t.error(err, 'no error')

    drive.open('hi', 'r', function (err, fd) {
      t.error(err, 'no error')

      const buf = Buffer.alloc(content.length)

      drive.read(fd, buf, content.length, 10, function (err, bytesRead) {
        t.error(err, 'no error')
        t.same(bytesRead, 0)
        t.end()
      })
    })
  })
})

tape('fd read with out-of-bounds length', function (t) {
  const drive = create()
  const content = Buffer.alloc(10000).fill('0123456789abcdefghijklmnopqrstuvwxyz') 

  drive.writeFile('hi', content, function (err) {
    t.error(err, 'no error')

    drive.open('hi', 'r', function (err, fd) {
      t.error(err, 'no error')

      const buf = Buffer.alloc(content.length)

      drive.read(fd, buf, 0, content.length + 1, function (err, bytesRead) {
        t.error(err, 'no error')
        t.same(bytesRead, content.length)
        t.end()
      })
    })
  })
})

tape('fd read of empty drive', function (t) {
  const drive = create()
  const content = Buffer.alloc(10000).fill('0123456789abcdefghijklmnopqrstuvwxyz') 

  drive.open('hi', 'r', function (err, fd) {
    t.true(err)
    t.same(err.errno, 2)
    t.end()
  })
})

tape('fd read of invalid file', function (t) {
  const drive = create()
  const content = Buffer.alloc(10000).fill('0123456789abcdefghijklmnopqrstuvwxyz') 

  drive.writeFile('hi', content, function (err) {
    t.error(err, 'no error')
    drive.open('hello', 'r', function (err, fd) {
      t.true(err)
      t.same(err.errno, 2)
      t.end()
    })
  })
})
