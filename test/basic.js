const tape = require('tape')
const hypercoreCrypto = require('hypercore-crypto')
const Corestore = require('corestore')
const ram = require('random-access-memory')
const create = require('./helpers/create')
const Replicator = require('./helpers/replicator')

tape('close event', function (t) {
  t.plan(1)

  var drive = create()

  drive.on('close', function () {
    t.pass('close event')
    t.end()
  })

  drive.ready(function () {
    drive.close()
  })
})

tape('write and read', function (t) {
  var drive = create()

  drive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    drive.readFile('/hello.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('world'))
      t.end()
    })
  })
})

tape('write and read, with encoding', function (t) {
  var drive = create()

  drive.writeFile('/hello.txt', 'world', { encoding: 'utf8' }, function (err) {
    t.error(err, 'no error')
    drive.readFile('/hello.txt', { encoding: 'utf8' }, function (err, str) {
      t.error(err, 'no error')
      t.same(str, 'world')
      t.end()
    })
  })
})

tape('write and read (2 parallel)', function (t) {
  t.plan(6)

  var drive = create()

  drive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    drive.readFile('/hello.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('world'))
    })
  })

  drive.writeFile('/world.txt', 'hello', function (err) {
    t.error(err, 'no error')
    drive.readFile('/world.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('hello'))
    })
  })
})

tape('write and read (sparse)', function (t) {
  var drive = create()
  drive.on('ready', function () {
    var clone = create(drive.key)
    var r = new Replicator(t)

    r.replicate(clone, drive)

    drive.writeFile('/hello.txt', 'world', function (err) {
      t.error(err, 'no error')
      var readStream = clone.createReadStream('/hello.txt')
      readStream.on('data', function (data) {
        t.same(data.toString(), 'world')
        r.end()
      })
    })
  })
})

tape('root is always there', function (t) {
  var drive = create()

  drive.access('/', function (err) {
    t.error(err, 'no error')
    drive.readdir('/', function (err, list) {
      t.error(err, 'no error')
      t.same(list, [])
      t.end()
    })
  })
})

tape('provide keypair', function (t) {
  const keyPair = hypercoreCrypto.keyPair()
  var drive = create(keyPair.publicKey, { keyPair })

  drive.on('ready', function () {
    t.ok(drive.writable)
    t.ok(drive.metadata.writable)
    t.ok(keyPair.publicKey.equals(drive.key))

    drive.writeFile('/hello.txt', 'world', function (err) {
      t.error(err, 'no error')
      drive.readFile('/hello.txt', function (err, buf) {
        t.error(err, 'no error')
        t.same(buf, Buffer.from('world'))
        t.end()
      })
    })
  })
})

tape.skip('can reopen when providing a keypair', function (t) {
  const keyPair = hypercoreCrypto.keyPair()
  const store = new Corestore(ram)
  var drive = create(keyPair.publicKey, { keyPair, corestore: store })

  drive.on('ready', function () {
    t.ok(drive.writable)
    t.ok(drive.metadata.writable)
    t.ok(keyPair.publicKey.equals(drive.key))

    drive.writeFile('/hello.txt', 'world', function (err) {
      t.error(err, 'no error')
      console.log('CORE LENGTH BEFORE CLOSE:', drive.metadata.length)
      drive.close(err => {
        t.error(err, 'no error')
        drive = create(keyPair.publicKey, { keyPair, corestore: store })

        drive.on('ready', function () {
          console.log('CORE LENGTH:', drive.metadata.length)
          t.ok(drive.writable)
          t.ok(drive.metadata.writable)
          t.ok(keyPair.publicKey.equals(drive.key))

          drive.readFile('/hello.txt', function (err, buf) {
            t.error(err, 'no error')
            t.same(buf, Buffer.from('world'))
            t.end()
          })
        })
      })
    })
  })
})

tape('write and read, no cache', function (t) {
  var drive = create({
    metadataStorageCacheSize: 0,
    contentStorageCacheSize: 0,
    treeCacheSize: 0
  })

  drive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    drive.readFile('/hello.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('world'))
      t.end()
    })
  })
})

tape('can read a single directory', async function (t) {
  const drive = create(null)

  let files = ['a', 'b', 'c', 'd', 'e', 'f']
  let fileSet = new Set(files)

  for (let file of files) {
    await insertFile(file, 'a small file')
  }

  drive.readdir('/', (err, files) => {
    t.error(err, 'no error')
    for (let file of files) {
      t.true(fileSet.has(file), 'correct file was listed')
      fileSet.delete(file)
    }
    t.same(fileSet.size, 0, 'all files were listed')
    t.end()
  })

  function insertFile (name, content) {
    return new Promise((resolve, reject) => {
      drive.writeFile(name, content, err => {
        if (err) return reject(err)
        return resolve()
      })
    })
  }
})

tape.skip('can stream a large directory', async function (t) {
  const drive = create(null)

  let files = new Array(1000).fill(0).map((_, idx) => '' + idx)
  let fileSet = new Set(files)

  for (let file of files) {
    await insertFile(file, 'a small file')
  }

  let stream = drive.createDirectoryStream('/')
  stream.on('data', ({ path, stat }) => {
    if (!fileSet.has(path)) {
      return t.fail('an incorrect file was streamed')
    }
    fileSet.delete(path)
  })
  stream.on('end', () => {
    t.same(fileSet.size, 0, 'all files were streamed')
    t.end()
  })

  function insertFile (name, content) {
    return new Promise((resolve, reject) => {
      drive.writeFile(name, content, err => {
        if (err) return reject(err)
        return resolve()
      })
    })
  }
})

tape('can read sparse metadata', async function (t) {
  const r = new Replicator(t)
  const { read, write } = await getTestDrives()

  let files = ['a', 'b/a/b', 'b/c', 'c/b', 'd/e/f/g/h', 'd/e/a', 'e/a', 'e/b', 'f', 'g']

  for (let file of files) {
    await insertFile(file, 'a small file')
    await checkFile(file)
  }

  r.end()

  function checkFile (file) {
    return new Promise(resolve => {
      read.stat(file, (err, st) => {
        t.error(err, 'no error')
        t.true(st)
        return resolve()
      })
    })
  }

  function insertFile (name, content) {
    return new Promise((resolve, reject) => {
      write.writeFile(name, content, err => {
        if (err) return reject(err)
        return resolve()
      })
    })
  }

  function getTestDrives () {
    return new Promise(resolve => {
      let drive = create()
      drive.on('ready', () => {
        let clone = create(drive.key, { sparseMetadata: true, sparse: true })
        r.replicate(clone, drive)
        return resolve({ read: clone, write: drive })
      })
    })
  }
})

tape('unavailable drive becomes ready', function (t) {
  var drive1 = create()
  var drive2 = null

  drive1.ready(err => {
    t.error(err, 'no error')
    drive2 = create(drive1.key)
    drive2.ready(err => {
      t.error(err, 'no error')
      drive2.readFile('blah', (err, contents) => {
        t.true(err)
        t.same(err.errno, 2)
        t.end()
      })
    })
  })
})

tape('copy', function (t) {
  var drive = create()
  drive.ready(err => {
    t.error(err, 'no error')
    drive.writeFile('hello', 'world', err => {
      t.error(err, 'no error')
      drive.copy('hello', 'also_hello', err => {
        t.error(err, 'no error')
        drive.readFile('hello', { encoding: 'utf8' }, (err, contents) => {
          t.error(err, 'no error')
          t.same(contents, 'world')
          drive.readFile('also_hello', { encoding: 'utf8' }, (err, contents) => {
            t.error(err, 'no error')
            t.same(contents, 'world')
            t.end()
          })
        })
      })
    })
  })
})
