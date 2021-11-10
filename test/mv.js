const test = require('tape')
const crypto = require('crypto')
const create = require('./helpers/create')

const fixtures = [
  'a/a',
  'a/b',
  'a/c/d',
  'a/c/e',
  'a/e',
  'b/e',
  'b/f',
  'b/d',
  'f/a',
  'g/x',
  'e'
]

test('move a directory containing files into a new directory', async function (t) {
  const drive = create()
  const files = createFiles(fixtures)

  await writeFiles(drive, files)

  const fileListA = await drive.promises.readdir('/a')
  t.deepEqual(fileListA, [ 'c', 'b', 'a', 'e' ])

  //
  // To be IEEE Std 1003.2 (POSIX.2) compatible,
  // the default should be to move "/a" INTO "/z".
  //
  await drive.promises.mv('/a', '/z')

  const fileListB = await drive.promises.readdir('/z', { recursive: true })
  t.deepEqual(fileListB, [ 'a/c/e', 'a/c/d', 'a/b', 'a/a', 'a/e' ])

  //
  // TODO this should propbably error, enodir
  //
  const fileListC = await drive.promises.readdir('/a', { recursive: true })
  t.equal(fileListC.length, 0, 'list of /a contains zero files')

  t.end()
})

test('move a directory branch containing files to another branch', async function (t) {
  const drive = create()
  const files = createFiles(fixtures)

  await writeFiles(drive, files)

  const fileListA = await drive.promises.readdir('/a', { recursive: true })
  t.deepEqual(fileListA, ['c/e', 'c/d', 'b', 'a','e'])

  await drive.promises.mv('/a', '/b')

  const fileListB = await drive.promises.readdir('/b', { recursive: true })
  t.deepEqual(fileListB, [ 'a/c/e', 'a/c/d', 'a/b', 'a/a', 'a/e', 'e', 'd', 'f' ])

  //
  // TODO this should propbably error, enodir. however, it could break things
  // downstream to change this behavior.
  //
  const fileListC = await drive.promises.readdir('/a', { recursive: true })
  t.equal(fileListC.length, 0, 'list of /a contains zero files')

  const fileListD = await drive.promises.readdir('/', { recursive: true })
  t.ok(fileListD.every(s => s[0] !== 'a'), 'a no longer exists at root')

  t.end()
})

test('move a single file with a relative path', async function (t) {
  const drive = create()
  const files = createFiles(fixtures)

  await writeFiles(drive, files)

  const fileListA = await drive.promises.readdir('/a')
  t.deepEqual(fileListA, [ 'c', 'b', 'a', 'e' ])

  await drive.promises.mv('a/e', 'quxx')

  const fileListB = await drive.promises.readdir('/a')
  t.deepEqual(fileListB, [ 'c', 'b', 'a', 'quxx' ])

  t.end()
})

test('move a single file with an absolute path', async function (t) {
  const drive = create()
  const files = createFiles(fixtures)

  await writeFiles(drive, files)

  const fileListA = await drive.promises.readdir('/a')
  t.deepEqual(fileListA, [ 'c', 'b', 'a', 'e' ])

  await drive.promises.mv('a/e', '/quxx.html')

  const fileListB = await drive.promises.readdir('/', { recursive: true })
  t.ok(fileListB.includes('quxx.html'), 'is now a root file')
  t.ok(!fileListB.includes('a/e'), 'a/e has been removed')

  t.end()
})

test('rename a single file with an absolute path', async function (t) {
  const drive = create()
  const files = createFiles(fixtures)

  await writeFiles(drive, files)

  const fileListA = await drive.promises.readdir('/a')
  t.deepEqual(fileListA, [ 'c', 'b', 'a', 'e' ])

  await drive.promises.rename('a/e', 'a/quxx.html')

  const fileListB = await drive.promises.readdir('/', { recursive: true })
  t.ok(fileListB.includes('a/quxx.html'), 'was renamed')

  t.end()
})

test('move an empty directory, preserves existing hierarchy', async function (t) {
  const drive = create()
  const files = createFiles(fixtures)

  await writeFiles(drive, files)

  await drive.promises.mkdir('/foo')
  await drive.promises.mkdir('/foo/bar')
  await drive.promises.mv('/foo/bar', '/bazz')
  const fileListA = await drive.promises.readdir('/', { recursive: true })
  t.ok(fileListA.includes('bazz/bar'), 'includes moved directory')
  t.ok(fileListA.includes('foo'), 'still contains old empty direcory')
  t.end()
})

test('rename an empty directory', async function (t) {
  const drive = create()
  const files = createFiles(fixtures)

  await writeFiles(drive, files)

  await drive.promises.mkdir('/foo')
  await drive.promises.mv('/foo', '/bar')
  const fileListA = await drive.promises.readdir('/')
  t.ok(fileListA.includes('bar'), 'bar created')
  t.ok(!fileListA.includes('foo'), 'foo removed')
  t.end()
})

function createFiles (names) {
  const files = []
  for (const name of names) {
    files.push([name, crypto.randomBytes(32)])
  }
  return new Map(files)
}

function writeFiles (drive, files) {
  return new Promise((resolve, reject) => {
    let expected = files.size

    for (const [name, contents] of files) {
      drive.writeFile(name, contents, err => {
        if (err) return reject(err)
        if (!--expected) return resolve(null)
      })
    }
  })
}
