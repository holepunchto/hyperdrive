var test = require('tape')
var create = require('./helpers/create')

test('basic symlink', t => {
  const archive = create()

  archive.writeFile('/hello.txt', 'world', err => {
    t.error(err, 'no error')
    archive.symlink('/hello.txt', '/link.txt', err => {
      t.error(err, 'no error')
      onlink()
    })
  })

  function onlink () {
    archive.stat('/link.txt', (err, st) => {
      t.error(err, 'no error')
      t.same(st.size, 5)
      archive.readFile('/link.txt', (err, contents) => {
        t.error(err, 'no error')
        t.same(contents, Buffer.from('world'))
        t.end()
      })
    })
  }
})

test('fixing a broken symlink', t => {
  const archive = create()

  archive.symlink('/hello.txt', '/link.txt', err => {
    t.error(err, 'no error')
    archive.stat('/link.txt', (err, st) => {
      t.same(err.errno, 2)
      archive.writeFile('/hello.txt', 'world', err => {
        t.error(err, 'no error')
        onwrite()
      })
    })
  })

  function onwrite () {
    archive.stat('/link.txt', (err, st) => {
      t.error(err, 'no error')
      t.same(st.size, 5)
      archive.readFile('/link.txt', (err, contents) => {
        t.error(err, 'no error')
        t.same(contents, Buffer.from('world'))
        t.end()
      })
    })
  }
})

test('unlinking a symlink does not delete the target', t => {
  const archive = create()

  archive.writeFile('/hello.txt', 'world', err => {
    t.error(err, 'no error')
    archive.symlink('/hello.txt', '/link.txt', err => {
      t.error(err, 'no error')
      archive.unlink('/link.txt', err => {
        t.error(err, 'no error')
        onunlink()
      })
    })
  })

  function onunlink () {
    archive.stat('/hello.txt', (err, st) => {
      t.error(err, 'no error')
      t.same(st.size, 5)
      archive.readFile('/hello.txt', (err, contents) => {
        t.error(err, 'no error')
        t.same(contents, Buffer.from('world'))
        t.end()
      })
    })
  }
})

test('symlinks appear in readdir', t => {
  const archive = create()

  archive.writeFile('/hello.txt', 'world', err => {
    t.error(err, 'no error')
    archive.symlink('/hello.txt', '/link.txt', err => {
      t.error(err, 'no error')
      onlink()
    })
  })

  function onlink () {
    archive.readdir('/', (err, files) => {
      t.error(err, 'no errors')
      t.same(files, ['hello.txt', 'link.txt'])
      t.end()
    })
  }
})

test('symlinks with nested symlinks appear in non-recursive readdir', t => {
  const drive = create()

  drive.mkdir('a', err => {
    t.error(err)
    drive.writeFile('a/1', '1', err => {
      t.error(err, 'no error')
      drive.writeFile('a/2', '2', err => {
        t.error(err, 'no error')
        drive.symlink('a/2', 'a/3', err => {
          t.error(err, 'no error')
          drive.symlink('a', 'b', err => {
            t.error(err, 'no error')
            onlink()
          })
        })
      })
    })
  })

  function onlink () {
    drive.readdir('b', (err, files) => {
      t.error(err, 'no error')
      t.same(files, ['3', '1', '2'])
      t.end()
    })
  }
})

test('nested, broken symlink without parent stats can be removed', t => {
  const drive = create()

  drive.symlink('bad-target', 'a/b/c/d', err => {
    t.error(err)
    drive.lstat('a/b/c/d', (err, st) => {
      t.error(err, 'no error')
      t.true(st)
      drive.unlink('a/b/c/d', err => {
        t.error(err, 'no error')
        drive.readdir('a/b/c', (err, l) => {
          t.error(err, 'no error')
          t.same(l.length, 0)
          t.end()
        })
      })
    })
  })
})

test('readdir with includeStats returns unresolved stats', t => {
  const drive = create()

  drive.writeFile('/hello', 'world', { metadata: { a: 'bbb' }}, err => {
    t.error(err, 'no error')
    drive.symlink('/hello', '/link', err => {
      t.error(err, 'no error')
      drive.readdir('/', { includeStats: true }, (err, list) => {
        t.error(err, 'no error')
        t.same(list.length, 2)
        for (const { stat } of list) {
          if (stat.metadata.a) t.true(stat.metadata.a.equals(Buffer.from('bbb')))
          else t.same(stat.linkname, '/hello')
        }
        t.end()
      })
    })
  })
})

// TODO: This will be fixed with a trie update.
test.skip('stat through symlinked dir', t => {
  const drive = create()

  drive.mkdir('subdir1', err => {
    t.error(err, 'no error')
    drive.mkdir('subdir2', err => {
      t.error(err, 'no error')
      drive.writeFile('subdir1/foo', 'hello', err => {
        t.error(err, 'no error')
        drive.writeFile('subdir2/bar', 'world', err => {
          t.error(err, 'no error')
          drive.symlink('/subdir2', 'subdir1/symto2', err => {
            t.error(err, 'no error')
            return onlinked()
          })
        })
      })
    })
  })

  function onlinked () {
    drive.stat('subdir1/symto2/bar', (err, st) => {
      t.error(err, 'no error')
      t.true(st)
      t.end()
    })
  }
})


