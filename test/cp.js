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

test('copy a directory containing files', async function (t) {
  const drive = create()
  const files = createFiles(fixtures)

  await writeFiles(drive, files)

  const fileListA = await drive.promises.readdir('/a')
  t.deepEqual(fileListA, [ 'c', 'b', 'a', 'e' ])

  await drive.promises.cp('a', 'z', { recursive: true })

  const fileListB = await drive.promises.readdir('/z', { recursive: true })
  t.deepEqual(fileListB, fileListA)

  t.end()
})

test('copy a single file', async function (t) {
  const drive = create()
  const files = createFiles(fixtures)

  await writeFiles(drive, files)

  const fileListA = await drive.promises.readdir('/b', { recursive: true })
  t.ok(!fileListA.includes('a'), '/b does not include the target, /b/a')

  await drive.promises.cp('a/a', 'b/a')

  const fileListB = await drive.promises.readdir('/b', { recursive: true })
  t.ok(fileListB.includes('a'), '/b now includes the target, /b/a')

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
