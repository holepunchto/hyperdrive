const crypto = require('crypto')
const test = require('tape')
const collect = require('stream-collector')

const create = require('./helpers/create')
const { runAll } = require('./helpers/util')

test('simple readdir', async t => {
  const drive = create()

  const files = createFiles([
    'a/a',
    'a/b',
    'a/c/d',
    'a/c/e',
    'a/e',
    'b/e',
    'b/f',
    'b/d',
    'e'
  ])

  try {
    await runAll([
      cb => writeFiles(drive, files, cb),
      cb => validateReaddir(t, drive, 'a', ['a', 'b', 'c', 'e'], cb),
      cb => validateReaddir(t, drive, 'a/c', ['d', 'e'], cb),
      cb => validateReaddir(t, drive, 'b', ['e', 'f', 'd'], cb),
      cb => validateReaddir(t, drive, '', ['a', 'b', 'e'], cb)
    ])
  } catch (err) {
    t.fail(err)
  }

  t.end()
})

test('recursive readdir', async t => {
  const drive = create()

  const files = createFiles([
    'a/a',
    'a/b',
    'a/c/d',
    'a/c/e',
    'a/e',
    'b/e',
    'b/f',
    'b/d',
    'e'
  ])

  try {
    await runAll([
      cb => writeFiles(drive, files, cb),
      cb => validateReaddir(t, drive, 'a', ['a', 'b', 'c/d', 'c/e', 'e'], { recursive: true }, cb),
      cb => validateReaddir(t, drive, 'a/c', ['d', 'e'], { recursive: true }, cb),
      cb => validateReaddir(t, drive, 'b', ['e', 'f', 'd'], { recursive: true }, cb),
      cb => validateReaddir(t, drive, '', ['a/a', 'a/b', 'a/c/d', 'a/c/e', 'a/e', 'b/e', 'b/f', 'b/d', 'e'], { recursive: true }, cb)
    ])
  } catch (err) {
    t.fail(err)
  }

  t.end()
})

test('readdir follows symlink', async t => {
  const drive = create()

  const files = createFiles([
    'a/a',
    'a/b',
    'a/c/d',
    'a/c/e',
    'a/e',
    'b/e',
    'b/f',
    'b/d',
    'e'
  ])
  const links = new Map([
    ['f', 'a'],
    ['p', 'a/c'],
    ['g', 'e']
  ])

  try {
    await runAll([
      cb => writeFiles(drive, files, cb),
      cb => writeLinks(drive, links, cb),
      cb => validateReaddir(t, drive, 'f', ['a', 'b', 'c', 'e'], cb),
      cb => validateReaddir(t, drive, 'p', ['d', 'e'], cb),
      cb => validateReaddir(t, drive, 'b', ['e', 'f', 'd'], cb),
      cb => validateReaddir(t, drive, '', ['a', 'b', 'e', 'f', 'p', 'g'], cb)
    ])
  } catch (err) {
    t.fail(err)
  }

  t.end()
})

test('readdir follows symlink', async t => {
  const drive = create()

  const files = createFiles([
    'a/a',
    'a/b',
    'a/c/d',
    'a/c/e',
    'a/e',
    'b/e',
    'b/f',
    'b/d',
    'e'
  ])
  const links = new Map([
    ['f', 'a'],
    ['p', 'a/c'],
    ['g', 'e']
  ])

  const fExpected = ['f/b', 'f/c/d', 'f/c/e', 'f/e', 'f/a']
  const pExpected = ['p/e', 'p/d']
  const rootExpected = ['a/a', 'a/b', 'a/c/d', 'a/c/e', 'a/e', 'b/e', 'b/f', 'b/d', 'e', 'g']

  try {
    await runAll([
      cb => writeFiles(drive, files, cb),
      cb => writeLinks(drive, links, cb),
      cb => validateReaddir(t, drive, 'f', ['a', 'b', 'c/d', 'c/e', 'e'], { recursive: true }, cb),
      cb => validateReaddir(t, drive, 'p', ['d', 'e'], { recursive: true }, cb),
      cb => validateReaddir(t, drive, 'b', ['e', 'f', 'd'], { recursive: true }, cb),
      cb => validateReaddir(t, drive, '', [...rootExpected, ...fExpected, ...pExpected], { recursive: true }, cb)
    ])
  } catch (err) {
    t.fail(err)
  }

  t.end()
})

test('readdir follows symlinks to symlinks', async t => {
  const drive = create()

  const files = createFiles([
    'a/a',
    'a/b',
    'a/c/d',
    'a/c/e',
    'a/e',
    'b/e',
    'b/f',
    'b/d',
    'e'
  ])
  const links = new Map([
    ['a/d', '../r'],
    ['r', 'a/c/f'],
    ['a/c/f', '../../b']
  ])

  try {
    await runAll([
      cb => writeFiles(drive, files, cb),
      cb => writeLinks(drive, links, cb),
      cb => validateReaddir(t, drive, 'a/d', ['e', 'f', 'd'], cb),
      cb => validateReaddir(t, drive, 'r', ['e', 'f', 'd'], cb),
      cb => validateReaddir(t, drive, 'a/c/f', ['e', 'f', 'd'], cb),
      cb => validateReaddir(t, drive, '', ['a', 'b', 'e', 'r'], cb)
    ])
  } catch (err) {
    t.fail(err)
  }

  t.end()
})

function validateReaddir (t, drive, path, names, opts, cb) {
  if (typeof opts === 'function') return validateReaddir(t, drive, path, names, {}, opts)
  drive.readdir(path, opts, (err, list) => {
    if (err) return cb(err)
    t.same(list.length, names.length)
    for (const name of list) {
      t.notEqual(names.indexOf(name), -1)
    }
    return cb(null)
  })
}

function writeFiles (drive, files, cb) {
  var expected = files.size
  for (const [name, contents] of files) {
    drive.writeFile(name, contents, err => {
      if (err) return cb(err)
      if (!--expected) return cb(null)
    })
  }
}

function writeLinks (drive, links, cb) {
  var expected = links.size
  for (const [name, target] of links) {
    drive.symlink(target, name, err => {
      if (err) return cb(err)
      if (!--expected) return cb(null)
    })
  }
}

function createFiles (names) {
  const files = []
  for (const name of names) {
    files.push([name, crypto.randomBytes(32)])
  }
  return new Map(files)
}
