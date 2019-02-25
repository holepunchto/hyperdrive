var tape = require('tape')
var sodium = require('sodium-universal')
var create = require('./helpers/create')

tape('write and read', function (t) {
  var archive = create()

  archive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    console.log('reading')
    archive.readFile('/hello.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('world'))
      t.end()
    })
  })
})

tape('write and read, with encoding', function (t) {
  var archive = create()

  archive.writeFile('/hello.txt', 'world', { encoding: 'utf8' }, function (err) {
    t.error(err, 'no error')
    archive.readFile('/hello.txt', { encoding: 'utf8' }, function (err, str) {
      t.error(err, 'no error')
      t.same(str, 'world')
      t.end()
    })
  })
})

tape('write and read (2 parallel)', function (t) {
  t.plan(6)

  var archive = create()

  archive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    archive.readFile('/hello.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('world'))
    })
  })

  archive.writeFile('/world.txt', 'hello', function (err) {
    t.error(err, 'no error')
    archive.readFile('/world.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('hello'))
    })
  })
})

tape('write and read (sparse)', function (t) {
  t.plan(2)

  var archive = create()
  archive.on('ready', function () {
    var clone = create(archive.key, {sparse: true})

    archive.writeFile('/hello.txt', 'world', function (err) {
      t.error(err, 'no error')
      var stream = clone.replicate()
      stream.pipe(archive.replicate()).pipe(stream)

      var readStream = clone.createReadStream('/hello.txt')
      readStream.on('data', function (data) {
        t.same(data.toString(), 'world')
      })
    })
  })
})

tape('write and unlink', function (t) {
  var archive = create()

  archive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    archive.unlink('/hello.txt', function (err) {
      t.error(err, 'no error')
      archive.readFile('/hello.txt', function (err) {
        t.ok(err, 'had error')
        t.end()
      })
    })
  })
})

tape('root is always there', function (t) {
  var archive = create()

  archive.access('/', function (err) {
    t.error(err, 'no error')
    archive.readdir('/', function (err, list) {
      t.error(err, 'no error')
      t.same(list, [])
      t.end()
    })
  })
})

tape('provide keypair', function (t) {
  var publicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
  var secretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)

  sodium.crypto_sign_keypair(publicKey, secretKey)

  var archive = create(publicKey, {secretKey: secretKey})

  archive.on('ready', function () {
    t.ok(archive.writable)
    t.ok(archive.metadataFeed.writable)
    t.ok(archive.contentFeed.writable)
    t.ok(publicKey.equals(archive.key))

    archive.writeFile('/hello.txt', 'world', function (err) {
      t.error(err, 'no error')
      archive.readFile('/hello.txt', function (err, buf) {
        t.error(err, 'no error')
        t.same(buf, Buffer.from('world'))
        t.end()
      })
    })
  })
})

tape('write and read, no cache', function (t) {
  var archive = create({
    metadataStorageCacheSize: 0,
    contentStorageCacheSize: 0,
    treeCacheSize: 0
  })

  archive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    archive.readFile('/hello.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('world'))
      t.end()
    })
  })
  var self = this
})

// TODO: Re-enable the following tests once the `download` and `fetchLatest` APIs are reimplemented.

tape.skip('download a version', function (t) {
  var src = create()
  src.on('ready', function () {
    t.ok(src.writable)
    t.ok(src.metadataFeed.writable)
    t.ok(src.contentFeed.writable)
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
            t.end()
          })
        })
      })
    })
    var stream = clone.replicate()
    stream.pipe(src.replicate()).pipe(stream)
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

tape('simple watch', function (t) {
  const db = create(null)

  var watchEvents = 0
  db.ready(err => {
    t.error(err, 'no error')
    db.watch('/a/path/', () => {
      if (++watchEvents === 2) {
        t.end()
      }
    })
    doWrites()
  })

  function doWrites () {
    db.writeFile('/a/path/hello', 't1', err => {
      t.error(err, 'no error')
      db.writeFile('/b/path/hello', 't2', err => {
        t.error(err, 'no error')
        db.writeFile('/a/path/world', 't3', err => {
          t.error(err, 'no error')
        })
      })
    })
  }
})

tape('simple checkout', function (t) {
  const drive = create(null)

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

tape('can stream a large directory', async function (t) {
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

tape('can read nested directories', async function (t) {
  const drive = create(null)

  let files = ['a', 'b/a/b', 'b/c', 'c/b', 'd/e/f/g/h', 'd/e/a', 'e/a', 'e/b', 'f', 'g']
  let rootSet = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  let bSet = new Set(['a', 'c'])
  let dSet = new Set(['e'])
  let eSet = new Set(['a', 'b']) 
  let deSet = new Set(['f', 'a'])

  for (let file of files) {
    await insertFile(file, 'a small file')
  }

  await checkDir('/', rootSet)
  await checkDir('b', bSet)
  await checkDir('d', dSet)
  await checkDir('e', eSet)
  await checkDir('d/e', deSet)

  t.end()

  function checkDir (dir, fileSet) {
    return new Promise(resolve => {
      drive.readdir(dir, (err, files) => {
        t.error(err, 'no error')
        for (let file of files) {
          t.true(fileSet.has(file), 'correct file was listed')
          fileSet.delete(file)
        }
        t.same(fileSet.size, 0, 'all files were listed')
        return resolve()
      })
    })
  }

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
  const { read, write }  = await getTestDrives()

  let files = ['a', 'b/a/b', 'b/c', 'c/b', 'd/e/f/g/h', 'd/e/a', 'e/a', 'e/b', 'f', 'g']

  for (let file of files) {
    await insertFile(file, 'a small file')
    await checkFile(file)
  }

  t.end()

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
        let s1 = clone.replicate({ live: true })
        s1.pipe(drive.replicate({ live: true })).pipe(s1)
        return resolve({ read: clone, write: drive })
      })
    })
  }
})

// TODO: Revisit createDiffStream after hypertrie diff stream bug is fixed.
/*
tape.only('simple diff stream', async function (t) {
  let drive = create()

  var v1, v2, v3
  let v3Diff = ['del-hello']
  let v2Diff = [...v3Diff,  'put-other']
  let v1Diff = [...v2Diff, 'put-hello']

  await writeVersions()
  console.log('drive.version:', drive.version, 'v1:', v1)
  // await verifyDiffStream(v1, v1Diff)
  // await verifyDiffStream(v2, v2Diff)
  await verifyDiffStream(v3, v3Diff)
  t.end()

  function writeVersions () {
    return new Promise(resolve => {
      drive.ready(err => {
        t.error(err, 'no error')
        v1 = drive.version
        drive.writeFile('/hello', 'world', err => {
          t.error(err, 'no error')
          v2 = drive.version
          drive.writeFile('/other', 'file', err => {
            t.error(err, 'no error')
            v3 = drive.version
            drive.unlink('/hello', err => {
              t.error(err, 'no error')
              return resolve()
            })
          })
        })
      })
    })
  }

  async function verifyDiffStream (version, diffList) {
    let diffSet = new Set(diffList)
    console.log('diffing to version:', version, 'from version:', drive.version)
    let diffStream = drive.createDiffStream(version)
    return new Promise(resolve => {
      diffStream.on('data', ({ type, name }) => {
        let key = `${type}-${name}`
        if (!diffSet.has(key)) {
          return t.fail('an incorrect diff was streamed')
        }
        diffSet.delete(key)
      })
      diffStream.on('end', () => {
        t.same(diffSet.size, 0)
        return resolve()
      })
    })
  }
})
*/
