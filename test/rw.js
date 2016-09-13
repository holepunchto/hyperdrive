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

test('write and read with start offset', function (t) {
  t.plan(1)
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive()

  archive.createFileWriteStream('hello.txt').end('BEEP BOOP\n')
  archive.finalize(function () {
    archive.createFileReadStream('hello.txt', {start: 1})
      .pipe(concat(function (body) {
        t.equal(body.toString(), 'EEP BOOP\n')
      }))
  })
})

test('write and read with start, end offset', function (t) {
  t.plan(1)
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive()

  archive.createFileWriteStream('hello.txt').end('BEEP BOOP\n')
  archive.finalize(function () {
    archive.createFileReadStream('hello.txt', {start: 1, end: 4})
      .pipe(concat(function (body) {
        t.equal(body.toString(), 'EEP')
      }))
  })
})

test('random access read in-bounds', function (t) {
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive()

  var testString = 'BEEP BOOP\n'

  archive.createFileWriteStream('hello.txt').end(testString)
  archive.finalize(function () {
    var cursor = archive.createByteCursor('hello.txt', 0)
    cursor.next(function (err, data) {
      t.error(err, 'no error')
      t.notEquals(data, null, 'data is not null')
      t.same(data.length, 10, 'data length is valid')
      t.pass('in-bounds random access read passes')
      t.end()
    })
  })
})

test('random access read no more data', function (t) {
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive()

  var testString = 'BEEP BOOP\n'

  archive.createFileWriteStream('hello.txt').end(testString)
  archive.finalize(function () {
    var cursor = archive.createByteCursor('hello.txt', 5)
    cursor.next(function (err, data) {
      t.error(err, 'no error')
      t.notEquals(data, null, 'data is not null')
      t.same(data.length, 5, 'data length is valid')
      cursor.next(function (err, data) {
        t.error(err, 'no error')
        t.equals(data, null, 'returns null when data is not available')
        t.pass('random access read passes when no more data is available')
        t.end()
      })
    })
  })
})

test('random access read with two files', function (t) {
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive()

  var testString = 'BEEP BOOP\n'

  archive.createFileWriteStream('hello.txt').end(testString)
  archive.createFileWriteStream('world.txt').end(testString)
  archive.finalize(function () {
    var cursor = archive.createByteCursor('hello.txt', 0)
    cursor.next(function (err, data) {
      t.error(err, 'no error')
      t.notEquals(data, null, 'data is not null')
      t.same(data.length, 10, 'data length is valid')
      cursor.next(function (err, data) {
        t.error(err, 'no error')
        t.equals(data, null, 'returns null when file boundary is reached')
        t.pass('random access read passes when file boundary is reached')
        t.end()
      })
    })
  })
})

test('random access read spanning multiple blocks', function (t) {
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive()

  var arr = []
  for (var i = 0; i < 10000 * 4; i++) {
    arr.push(Math.floor(Math.random() * 100))
  }
  var testBuffer = new Buffer(arr)

  function verifyBlock (idx, cursor, core, cb) {
    cursor.next(function (err, cursorData) {
      t.error(err, 'no error')
      core.get(idx, function (err, coreData) {
        t.error(err, 'no error')
        t.same(coreData, cursorData, 'cursor/block data is the same')
        cb()
      })
    })
  }

  archive.createFileWriteStream('hello.txt').end(testBuffer)
  archive.finalize(function () {
    var cursor = archive.createByteCursor('hello.txt', 0)
    archive.get('hello.txt', function (err, entry) {
      t.error(err, 'no error')
      verifyBlock(0, cursor, archive.content, function () {
        verifyBlock(1, cursor, archive.content, function () {
          t.pass('cursor data is always the same as block data')
          t.end()
        })
      })
    })
  })
})

test('random access read with offset', function (t) {
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive()

  var testString1 = 'BEEP BOOP\n'
  var testString2 = 'BOOP BEEP\n'

  archive.createFileWriteStream('hello.txt').end(testString1)
  archive.createFileWriteStream('world.txt').end(testString2)
  archive.finalize(function () {
    var cursor = archive.createByteCursor('world.txt', 5)
    cursor.next(function (err, data) {
      t.error(err, 'no error')
      t.same(data.toString('utf8'), 'BEEP\n', 'data at offset equals BEEP')
      cursor.next(function (err, data) {
        t.error(err, 'no error')
        t.equals(data, null, 'returns null when file boundary is reached')
        t.pass('random access read passes with nonzero starting offset')
        t.end()
      })
    })
  })
})

test('random access read with huge first offset', function (t) {
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive()

  var testString1 = 'BEEP BOOP\n'

  archive.createFileWriteStream('hello.txt').end(testString1)
  archive.finalize(function () {
    var cursor = archive.createByteCursor('hello.txt', 5000000)
    cursor.next(function (err, data) {
      t.error(err, 'no error')
      t.same(data, null, 'data for huge offset should be null')
      t.pass('next returned null for large offset')
      t.end()
    })
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

test('read previous entries', function (t) {
  t.plan(9)
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive(null, { live: true })
  var data = [
    { 'hello.txt': 'HI' },
    { 'hello.txt': 'WHAT', 'index.html': '<h1>hey</h1>' },
    { 'hello.txt': '!' }
  ]
  var expectedHistory = [
    { name: 'hello.txt', body: 'HI' },
    { name: 'hello.txt', body: 'WHAT' },
    { name: 'index.html', body: '<h1>hey</h1>' },
    { name: 'hello.txt', body: '!' }
  ]
  var expectedListing = {
    'index.html': { body: '<h1>hey</h1>' },
    'hello.txt': { body: '!' }
  }
  ;(function next () {
    if (data.length === 0) return check()
    var files = data.shift()
    var pending = 1
    Object.keys(files).forEach(function (key) {
      pending++
      archive.createFileWriteStream(key)
        .once('finish', done)
        .end(files[key])
    })
    done()
    function done () { if (--pending === 0) next() }
  })()
  function check () {
    archive.history({ live: false }, function (err, files) {
      t.error(err)
      files.forEach(function (file) {
        checkFile(expectedHistory.shift(), file, 'history: ' + file.name)
      })
    })
    archive.list({ live: false }, function (err, files) {
      t.error(err)
      t.equal(files.length, 2)
      files.forEach(function (file) {
        checkFile(expectedListing[file.name], file, 'list: ' + file.name)
      })
    })
  }
  function checkFile (e, file, msg) {
    archive.createFileReadStream(file).pipe(concat(function (body) {
      t.equal(body.toString(), e.body, msg)
    }))
  }
})

test('write and unlink', function (t) {
  t.plan(5)
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive()

  var ws = archive.createFileWriteStream('hello.txt')
  ws.end('BEEP BOOP\n')
  ws.on('finish', function () {
    archive.unlink('hello.txt', function (err) {
      t.error(err)
      archive.list(function (err, files) {
        t.error(err)
        t.equal(files.length, 0, 'list() should provide no files')
      })
      archive.lookup('hello.txt', function (err, result) {
        t.ok(err, 'lookup() should fail')
      })
      var rs = archive.createFileReadStream('hello.txt')
      rs.on('error', function (err) {
        t.ok(err, 'createFileReadStream() should fail')
      })
      rs.on('data', function (data) {
        throw new Error('createFileReadStream() should not give unlinked data')
      })
    })
  })
})

test('write and unlink, then write again', function (t) {
  t.plan(2)
  var drive = hyperdrive(memdb())
  var archive = drive.createArchive()

  var ws = archive.createFileWriteStream('hello.txt')
  ws.end('BEEP BOOP\n')
  ws.on('finish', function () {
    archive.unlink('hello.txt', function (err) {
      t.error(err)
      archive.createFileWriteStream('hello.txt').end('BEEP BEEP\n')
      archive.finalize(function () {
        archive.createFileReadStream('hello.txt')
          .pipe(concat(function (body) {
            t.equal(body.toString(), 'BEEP BEEP\n')
          }))
      })
    })
  })
})
