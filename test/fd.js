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

tape('fd basic write, creating file', function (t) {
  const drive = create()
  const content = Buffer.alloc(10000).fill('0123456789abcdefghijklmnopqrstuvwxyz')
  drive.open('hello', 'w+', function (err, fd) {
    t.error(err, 'no error')
    drive.write(fd, content, 0, content.length, 0, function (err, bytesWritten) {
      t.error(err, 'no error')
      t.same(bytesWritten, content.length)
      drive.close(fd, err => {
        t.error(err, 'no error')
        drive.readFile('hello', function (err, readContent) {
          t.error(err, 'no error')
          t.true(readContent.equals(content))
          t.end()
        })
      })
    })
  })
})

tape('fd basic write, appending file', function (t) {
  const drive = create()
  const content = Buffer.alloc(10000).fill('0123456789abcdefghijklmnopqrstuvwxyz')
  let first = content.slice(0, 2000)
  let second = content.slice(2000)

  drive.writeFile('hello', first, err => {
    t.error(err, 'no error')
    writeSecond()
  })

  function writeSecond () {
    drive.open('hello', 'a', function (err, fd) {
      t.error(err, 'no error')
      drive.write(fd, second, 0, second.length, first.length, function (err, bytesWritten) {
        t.error(err, 'no error')
        t.same(bytesWritten, second.length)
        drive.close(fd, err => {
          t.error(err, 'no error')
          drive.readFile('hello', function (err, readContent) {
            t.error(err, 'no error')
            t.true(readContent.equals(content))
            t.end()
          })
        })
      })
    })
  }
})

tape('fd basic write, overwrite file', function (t) {
  const drive = create()
  const content = Buffer.alloc(10000).fill('0123456789abcdefghijklmnopqrstuvwxyz')
  let first = content.slice(0, 2000)
  let second = content.slice(2000)

  drive.writeFile('hello', first, err => {
    t.error(err, 'no error')
    writeSecond()
  })

  function writeSecond () {
    drive.open('hello', 'w', function (err, fd) {
      t.error(err, 'no error')
      drive.write(fd, second, 0, second.length, 0, function (err, bytesWritten) {
        t.error(err, 'no error')
        t.same(bytesWritten, second.length)
        drive.close(fd, err => {
          t.error(err, 'no error')
          drive.readFile('hello', function (err, readContent) {
            t.error(err, 'no error')
            t.true(readContent.equals(second))
            t.end()
          })
        })
      })
    })
  }
})

tape('fd stateful write', function (t) {
  const drive = create()
  const content = Buffer.alloc(10000).fill('0123456789abcdefghijklmnopqrstuvwxyz')
  let first = content.slice(0, 2000)
  let second = content.slice(2000)

  drive.open('hello', 'w', function (err, fd) {
    t.error(err, 'no error')
    drive.write(fd, first, 0, first.length, 0, function (err) {
      t.error(err, 'no error')
      drive.write(fd, second, 0, second.length, first.length, function (err) {
        t.error(err, 'no error')
        drive.close(fd, err => {
          t.error(err, 'no error')
          drive.readFile('hello', function (err, readContent) {
            t.error(err, 'no error')
            t.true(readContent.equals(content))
            t.end()
          })
        })
      })
    })
  })
})

tape('huge stateful write + stateless read', function (t) {
  const NUM_SLICES = 1000
  const SLICE_SIZE = 4096
  const READ_SIZE = Math.floor(4096 * 2.75)

  const drive = create()

  const content = Buffer.alloc(SLICE_SIZE * NUM_SLICES).fill('0123456789abcdefghijklmnopqrstuvwxyz')
  let slices = new Array(NUM_SLICES).fill(0).map((_, i) => content.slice(SLICE_SIZE * i, SLICE_SIZE * (i + 1)))

  drive.open('hello', 'w+', function (err, fd) {
    t.error(err, 'no error')
    writeSlices(drive, fd, err => {
      t.error(err, 'no errors during write')
      drive.open('hello', 'r', function (err, fd) {
        t.error(err, 'no error')
        compareSlices(drive, fd)
      })
    })
  })

  function compareSlices (drive, fd) {
    let read = 0
    readNext()

    function readNext () {
      const buf = Buffer.alloc(READ_SIZE)
      const pos = read * READ_SIZE
      drive.read(fd, buf, 0, READ_SIZE, pos, (err, bytesRead) => {
        if (err) return t.fail(err)
        if (!buf.slice(0, bytesRead).equals(content.slice(pos, pos + READ_SIZE))) {
          return t.fail(`Slices do not match at position: ${read}`)
        }
        if (++read * READ_SIZE >= NUM_SLICES * SLICE_SIZE) {
          return t.end()
        }
        return readNext(drive, fd)
      })
    }
  }

  function writeSlices (drive, fd, cb) {
    let written = 0
    writeNext()

    function writeNext () {
      const buf = slices[written]
      drive.write(fd, buf, 0, SLICE_SIZE, err => {
        if (err) return cb(err)
        if (++written === NUM_SLICES) return drive.close(fd, cb)
        return writeNext()
      })
    }
  }
})

tape('fd random-access write fails', function (t) {
  const drive = create()
  const content = Buffer.alloc(10000).fill('0123456789abcdefghijklmnopqrstuvwxyz')
  let first = content.slice(0, 2000)
  let second = content.slice(2000)

  drive.open('hello', 'w', function (err, fd) {
    t.error(err, 'no error')
    drive.write(fd, first, 0, first.length, 0, function (err) {
      t.error(err, 'no error')
      drive.write(fd, second, 0, second.length, first.length - 500, function (err) {
        t.true(err)
        t.same(err.errno, 9)
        t.end()
      })
    })
  })
})
