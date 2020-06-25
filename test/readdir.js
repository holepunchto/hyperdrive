const crypto = require('crypto')
const test = require('tape')

const create = require('./helpers/create')
const { runAll } = require('./helpers/util')

test('readdir on empty directory', async function (t) {
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
      cb => drive.mkdir('l', cb),
      cb => writeFiles(drive, files, cb),
      cb => validateReaddir(t, drive, 'd', [], cb),
      cb => validateReaddir(t, drive, 'l', [], cb)
    ])
  } catch (err) {
    t.fail(err)
  }

  t.end()
})

test('can read a single directory', async function (t) {
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

test('another single-directory readdir', async t => {
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

test('readdir can include stats/mounts', async t => {
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
      cb => validateReaddir(t, drive, 'a', ['a', 'b', 'c', 'e'], { includeStats: true }, cb),
      cb => validateReaddir(t, drive, 'a/c', ['d', 'e'], { includeStats: true }, cb),
      cb => validateReaddir(t, drive, 'b', ['e', 'f', 'd'], { includeStats: true }, cb),
      cb => validateReaddir(t, drive, '', ['a', 'b', 'e'], { includeStats: true }, cb)
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

test('readdir works with broken links', async t => {
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
    ['p', 'nothing_here'],
    ['g', 'e']
  ])

  try {
    await runAll([
      cb => writeFiles(drive, files, cb),
      cb => writeLinks(drive, links, cb),
      cb => validateReaddir(t, drive, 'f', ['a', 'b', 'c', 'e'], cb),
      cb => validateReaddir(t, drive, 'b', ['e', 'f', 'd'], cb),
      cb => validateReaddir(t, drive, '', ['a', 'b', 'e', 'f', 'p', 'g'], cb)
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

test('can read nested directories', async function (t) {
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

test('can stream a large directory', async function (t) {
  const drive = create(null)

  let files = new Array(1000).fill(0).map((_, idx) => '/' + idx)
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

function validateReaddir (t, drive, path, names, opts, cb) {
  if (typeof opts === 'function') return validateReaddir(t, drive, path, names, {}, opts)
  drive.readdir(path, opts, (err, list) => {
    if (err) return cb(err)
    t.same(list.length, names.length)
    if (opts && opts.includeStats) {
      for (const { name, stat, mount } of list) {
        t.notEqual(names.indexOf(name), -1)
        // TODO: Support more detailed validation of stat/mount here.
        t.true(stat)
        t.true(mount)
      }
    } else {
      for (const name of list) {
        t.notEqual(names.indexOf(name), -1)
      }
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
