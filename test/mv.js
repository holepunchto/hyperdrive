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

test('move a directory containing files', async function (t) {
  const drive = create()
  const files = createFiles(fixtures)

  await writeFiles(drive, files)

  const fileListA = await drive.promises.readdir('/a')
  t.deepEqual(fileListA, [ 'c', 'b', 'a', 'e' ])

  await drive.promises.mv('a', 'z')

  const fileListB = await drive.promises.readdir('/z', { recursive: true })
  t.deepEqual(fileListB, [ 'c/e', 'c/d', 'b', 'a', 'e' ])

  //
  // TODO this should propbably error, enodir
  //
  const fileListC = await drive.promises.readdir('/a', { recursive: true })
  t.equal(fileListC.length, 0, 'list of /a contains zero files')

  t.end()
})

test('move a single file', async function (t) {
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
