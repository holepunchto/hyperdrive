const tape = require('tape')
const create = require('./helpers/create')
const Replicator = require('./helpers/replicator')

tape('simple checkout', function (t) {
  const drive = create()

  drive.writeFile('/hello', 'world', err => {
    t.error(err, 'no error')
    let version = drive.version
    drive.readFile('/hello', (err, data) => {
      t.error(err, 'no error')
      t.same(data, Buffer.from('world'))
      drive.unlink('/hello', err => {
        t.error(err, 'no error')
        drive.readFile('/hello', (err, data) => {
          t.true(err)
          t.same(err.code, 'ENOENT')
          testCheckout(version)
        })
      })
    })
  })

  function testCheckout (version) {
    let oldVersion = drive.checkout(version)
    oldVersion.readFile('/hello', (err, data) => {
      t.error(err, 'no error')
      t.same(data, Buffer.from('world'))
      t.end()
    })
  }
})

// TODO: Re-enable the following tests once the `download` and `fetchLatest` APIs are reimplemented.

tape.skip('download a version', function (t) {
  var src = create()
  var r = new Replicator(t)
  src.on('ready', function () {
    t.ok(src.writable)
    t.ok(src.metadata.writable)
    t.ok(src.content.writable)
    src.writeFile('/first.txt', 'number 1', function (err) {
      t.error(err, 'no error')
      src.writeFile('/second.txt', 'number 2', function (err) {
        t.error(err, 'no error')
        src.writeFile('/third.txt', 'number 3', function (err) {
          t.error(err, 'no error')
          t.same(src.version, 3)
          testDownloadVersion()
        })
      })
    })
  })

  function testDownloadVersion () {
    var clone = create(src.key, { sparse: true })
    clone.on('content', function () {
      t.same(clone.version, 3)
      clone.checkout(2).download(function (err) {
        t.error(err)
        clone.readFile('/second.txt', { cached: true }, function (err, content) {
          t.error(err, 'block not downloaded')
          t.same(content && content.toString(), 'number 2', 'content does not match')
          clone.readFile('/third.txt', { cached: true }, function (err, content) {
            t.same(err && err.message, 'Block not downloaded')
            r.end()
          })
        })
      })
    })
    r.replicate(clone, src)
  }
})

tape.skip('closing a read-only, latest clone', function (t) {
  // This is just a sample key of a dead dat
  var clone = create('1d5e5a628d237787afcbfec7041a16f67ba6895e7aa31500013e94ddc638328d', {
    latest: true
  })
  clone.on('error', function (err) {
    t.fail(err)
  })
  clone.close(function (err) {
    t.error(err)
    t.end()
  })
})
