var test = require('tape')
const ram = require('random-access-memory')

const corestore = require('corestore')
var create = require('./helpers/create')

test('basic read/write to/from a mount', t => {
  const drive1 = create()
  const drive2 = create()

  const s1 = drive1.replicate({ live: true, encrypt: false })
  s1.pipe(drive2.replicate({ live: true, encrypt: false })).pipe(s1)

  drive2.ready(err => {
    t.error(err, 'no error')
    drive2.writeFile('b', 'hello', err => {
      t.error(err, 'no error')
      drive1.mount('a', drive2.key, err => {
        t.error(err, 'no error')
        drive1.readFile('a/b', (err, contents) => {
          t.error(err, 'no error')
          t.same(contents, Buffer.from('hello'))
          t.end()
        })
      })
    })
  })
})

test('should emit metadata-feed and content-feed events for all mounts', t => {
  const drive1 = create()
  const drive2 = create()

  const s1 = drive1.replicate({ live: true, encrypt: false })
  s1.pipe(drive2.replicate({ live: true, encrypt: false })).pipe(s1)

  var metadataCount = 0
  var contentCount = 0

  drive1.on('metadata-feed', () => {
    metadataCount++
  })
  drive1.on('content-feed', () => {
    contentCount++
  })

  drive2.ready(err => {
    t.error(err, 'no error')
    drive2.writeFile('hello', 'world', err => {
      t.error(err, 'no error')
      drive1.mount('a', drive2.key, err => {
        t.error(err, 'no error')
        drive1.readFile('a/hello', (err, content) => {
          t.error(err, 'no error')
          t.same(content, Buffer.from('world'))
          checkEvents()
        })
      })
    })
  })

  function checkEvents () {
    t.same(contentCount, 2)
    t.same(metadataCount, 2)
    t.end()
  }
})

test('can delete a mount', t => {
  const drive1 = create()
  const drive2 = create()

  const s1 = drive1.replicate({ live: true, encrypt: false })
  s1.pipe(drive2.replicate({ live: true, encrypt: false })).pipe(s1)

  drive2.ready(err => {
    t.error(err, 'no error')
    drive2.writeFile('b', 'hello', err => {
      t.error(err, 'no error')
      drive1.mount('a', drive2.key, err => {
        t.error(err, 'no error')
        drive1.readFile('a/b', (err, contents) => {
          t.error(err, 'no error')
          t.same(contents, Buffer.from('hello'))
          return deleteMount()
        })
      })
    })
  })

  function deleteMount () {
    drive1.unmount('a', err => {
      t.error(err, 'no error')
      drive1.readFile('a/b', (err, contents) => {
        t.true(err)
        t.same(err.errno, 2)
        t.end()
      })
    })
  }
})

test('multiple flat mounts', t => {
  const drive1 = create()
  const drive2 = create()
  const drive3 = create()

  var key1, key2

  replicateAll([drive1, drive2, drive3])

  drive3.ready(err => {
    t.error(err, 'no error')
    drive2.ready(err => {
      t.error(err, 'no error')
      key1 = drive2.key
      key2 = drive3.key
      onready()
    })
  })

  function onready () {
    drive2.writeFile('a', 'hello', err => {
      t.error(err, 'no error')
      drive3.writeFile('b', 'world', err => {
        t.error(err, 'no error')
        onwrite()
      })
    })
  }

  function onwrite () {
    drive1.mount('a', key1, err => {
      t.error(err, 'no error')
      drive1.mount('b', key2, err => {
        t.error(err, 'no error')
        onmount()
      })
    })
  }

  function onmount () {
    drive1.readFile('a/a', (err, contents) => {
      t.error(err, 'no error')
      t.same(contents, Buffer.from('hello'))
      drive1.readFile('b/b', (err, contents) => {
        t.error(err, 'no error')
        t.same(contents, Buffer.from('world'))
        t.end()
      })
    })
  }
})

test('recursive mounts', async t => {
  var key1, key2
  const drive1 = create()
  const drive2 = create()
  const drive3 = create()

  replicateAll([drive1, drive2, drive3])

  drive3.ready(err => {
    t.error(err, 'no error')
    drive2.ready(err => {
      t.error(err, 'no error')
      key1 = drive2.key
      key2 = drive3.key
      onready()
    })
  })

  function onready () {
    drive2.writeFile('a', 'hello', err => {
      t.error(err, 'no error')
      drive3.writeFile('b', 'world', err => {
        t.error(err, 'no error')
        onwrite()
      })
    })
  }

  function onwrite () {
    drive1.mount('a', key1, err => {
      t.error(err, 'no error')
      drive2.mount('b', key2, err => {
        t.error(err, 'no error')
        onmount()
      })
    })
  }

  function onmount () {
    drive1.readFile('a/a', (err, contents) => {
      t.error(err, 'no error')
      t.same(contents, Buffer.from('hello'))
      drive1.readFile('a/b/b', (err, contents) => {
        t.error(err, 'no error')
        t.same(contents, Buffer.from('world'))
        t.end()
      })
    })
  }
})

test('readdir returns mounts', t => {
  const drive1 = create()
  const drive2 = create()

  const s1 = drive1.replicate({ live: true, encrypt: false })
  s1.pipe(drive2.replicate({ live: true, encrypt: false })).pipe(s1)

  drive2.ready(err => {
    t.error(err, 'no error')
    drive1.mkdir('b', err => {
      t.error(err, 'no error')
      drive1.mkdir('b/a', err => {
        t.error(err, 'no error')
        drive1.mount('a', drive2.key, err => {
          t.error(err, 'no error')
          drive1.readdir('/', (err, dirs) => {
            t.error(err, 'no error')
            t.same(dirs, ['b', 'a'])
            t.end()
          })
        })
      })
    })
  })
})

test('cross-mount watch', t => {
  const drive1 = create()
  const drive2 = create()

  const s1 = drive1.replicate({ live: true, encrypt: false })
  s1.pipe(drive2.replicate({ live: true, encrypt: false })).pipe(s1)

  var watchEvents = 0

  drive2.ready(err => {
    t.error(err, 'no error')
    drive1.mount('a', drive2.key, err => {
      t.error(err, 'no error')
      drive1.watch('/', () => {
        if (++watchEvents === 1) t.end()
      })
      drive2.writeFile('a', 'hello', err => {
        t.error(err, 'no error')
      })
    })
  })
})

test('cross-mount symlink', t => {
  const drive1 = create()
  const drive2 = create()

  const s1 = drive1.replicate({ live: true, encrypt: false })
  s1.pipe(drive2.replicate({ live: true, encrypt: false })).pipe(s1)

  drive2.ready(err => {
    t.error(err, 'no error')
    drive1.mount('a', drive2.key, err => {
      t.error(err, 'no error')
      onmount()
    })
  })

  function onmount () {
    drive2.writeFile('b', 'hello world', err => {
      t.error(err, 'no error')
      drive1.symlink('a/b', 'c', err => {
        t.error(err, 'no error')
        drive1.readFile('c', (err, contents) => {
          t.error(err, 'no error')
          t.same(contents, Buffer.from('hello world'))
          t.end()
        })
      })
    })
  }
})

test('lists nested mounts, shared write capabilities', async t => {
  const store = corestore(ram)

  const drive1 = create({ corestore: store })
  const drive2 = create({ corestore: store })
  const drive3 = create({ corestore: store })

  drive3.ready(err => {
    t.error(err, 'no error')
    drive1.mount('a', drive2.key, err => {
      t.error(err, 'no error')
      drive1.mount('a/b', drive3.key, err => {
        t.error(err, 'no error')
        onmount()
      })
    })
  })

  function onmount () {
    drive2.lstat('b', (err, stat) => {
      t.error(err, 'no error')
      drive1.readdir('a', (err, list) => {
        t.error(err, 'no error')
        t.same(list, ['b'])
        t.end()
      })
    })
  }
})

test('independent corestores do not share write capabilities', t => {
  const drive1 = create()
  const drive2 = create()

  const s1 = drive1.replicate({ live: true, encrypt: false })
  s1.pipe(drive2.replicate({ live: true, encrypt: false })).pipe(s1)

  drive2.ready(err => {
    t.error(err, 'no error')
    drive1.mount('a', drive2.key, err => {
      t.error(err, 'no error')
      drive1.writeFile('a/b', 'hello', err => {
        t.ok(err)
        drive1.readFile('a/b', (err, contents) => {
          t.ok(err)
          t.end()
        })
      })
    })
  })
})

test('shared corestores will share write capabilities', async t => {
  const store = corestore(ram)

  const drive1 = create({ corestore: store })
  const drive2 = create({ corestore: store })

  drive2.ready(err => {
    t.error(err, 'no error')
    drive1.mount('a', drive2.key, err => {
      t.error(err, 'no error')
      drive1.writeFile('a/b', 'hello', err => {
        t.error(err, 'no error')
        drive1.readFile('a/b', (err, contents) => {
          t.error(err, 'no error')
          t.same(contents, Buffer.from('hello'))
          drive2.readFile('b', (err, contents) => {
            t.error(err, 'no error')
            t.same(contents, Buffer.from('hello'))
            t.end()
          })
        })
      })
    })
  })
})

test('can mount hypercores', async t => {
  const store = corestore(ram)
  const drive = create({ corestore: store })
  var core = store.get()

  drive.ready(err => {
    t.error(err, 'no error')
    core.ready(err => {
      t.error(err, 'no error')
      core.append('hello', err => {
        t.error(err, 'no error')
        return onappend()
      })
    })
  })

  function onappend () {
    drive.mount('/a', core.key, { hypercore: true }, err => {
      t.error(err, 'no error')
      drive.readFile('/a', (err, contents) => {
        t.error(err, 'no error')
        t.same(contents, Buffer.from('hello'))
        t.end()
      })
    })
  }
})

test('truncate within mount (with shared write capabilities)', async t => {
  const store = corestore(ram)

  const drive1 = create({ corestore: store })
  const drive2 = create({ corestore: store })

  drive2.ready(err => {
    t.error(err, 'no error')
    drive1.mount('a', drive2.key, err => {
      t.error(err, 'no error')
      drive1.writeFile('a/b', 'hello', err => {
        t.error(err, 'no error')
        drive1.truncate('a/b', 1, err => {
          t.error(err, 'no error')
          drive1.readFile('a/b', (err, contents) => {
            t.error(err, 'no error')
            t.same(contents, Buffer.from('h'))
            drive2.readFile('b', (err, contents) => {
              t.error(err, 'no error')
              t.same(contents, Buffer.from('h'))
              t.end()
            })
          })
        })
      })
    })
  })
})

test('mount replication between hyperdrives', async t => {
  const store1 = corestore(path => ram('cs1/' + path))
  const store2 = corestore(path => ram('cs2/' + path))
  const store3 = corestore(path => ram('cs3/' + path))

  const drive1 = create({ corestore: store1 })
  const drive2 = create({ corestore: store2 })
  var drive3 = null

  await new Promise(resolve => {
    drive1.ready(err => {
      t.error(err, 'no error')
      drive3 = create(drive1.key, { corestore: store3 })
      drive2.ready(err => {
        t.error(err, 'no error')
        drive3.ready(err => {
          t.error(err, 'no error')
          replicateAll([drive1, drive2, drive3])
          onready()
        })
      })
    })

    function onready () {
      drive1.writeFile('hey', 'hi', err => {
        t.error(err, 'no error')
        drive2.writeFile('hello', 'world', err => {
          t.error(err, 'no error')
          drive1.mount('a', drive2.key, err => {
            t.error(err, 'no error')
            drive3.ready(err => {
              t.error(err, 'no error')
              return setTimeout(onmount, 100)
            })
          })
        })
      })
    }

    function onmount () {
      drive3.readFile('hey', (err, contents) => {
        t.error(err, 'no error')
        t.same(contents, Buffer.from('hi'))
        drive3.readFile('a/hello', (err, contents) => {
          t.error(err, 'no error')
          t.same(contents, Buffer.from('world'))
          return resolve()
        })
      })
    }
  })

  t.end()
})

test('mount replication between hyperdrives, multiple, nested mounts', async t => {
  const [d1, d2] = await createMountee()
  const drive = await createMounter(d1, d2)
  await verify(drive)

  t.end()

  function createMountee () {
    const store = corestore(path => ram('cs1/' + path))
    const drive1 = create({ corestore: store })
    var drive2, drive3

    return new Promise(resolve => {
      drive1.ready(err => {
        t.error(err, 'no error')
        drive2 = create({ corestore: store })
        drive3 = create({ corestore: store })
        drive2.ready(err => {
          t.error(err, 'no error')
          drive3.ready(err => {
            t.error(err, 'no error')
            return onready()
          })
        })
      })

      function onready () {
        drive1.mount('a', drive2.key, err => {
          t.error(err, 'no error')
          drive1.mount('b', drive3.key, err => {
            t.error(err, 'no error')
            return onmount()
          })
        })
      }

      function onmount () {
        drive1.writeFile('a/dog', 'hello', err => {
          t.error(err, 'no error')
          drive1.writeFile('b/cat', 'goodbye', err => {
            t.error(err, 'no error')
            return resolve([drive2, drive3])
          })
        })
      }
    })
  }

  function createMounter (d2, d3) {
    const drive1 = create({ corestore: corestore(path => ram('cs4/' + path)) })

    return new Promise(resolve => {
      drive1.ready(err => {
        t.error(err, 'no error')
        replicateAll([drive1, d2, d3])
        drive1.mount('a', d2.key, err => {
          t.error(err, 'no error')
          drive1.mount('b', d3.key, err => {
            t.error(err, 'no error')
            setTimeout(() => resolve(drive1), 1000)
          })
        })
      })
    })
  }

  function verify (drive) {
    return new Promise(resolve => {
      drive.readFile('a/dog', (err, contents) => {
        t.error(err, 'no error')
        t.same(contents, Buffer.from('hello'))
        drive.readFile('b/cat', (err, contents) => {
          t.error(err, 'no error')
          t.same(contents, Buffer.from('goodbye'))
          return resolve()
        })
      })
    })
  }
})

test('can list in-memory mounts', async t => {
  const drive1 = create()
  const drive2 = create()
  const drive3 = create()

  var key1, key2

  replicateAll([drive1, drive2, drive3])


  drive3.ready(err => {
    t.error(err, 'no error')
    drive2.ready(err => {
      t.error(err, 'no error')
      key1 = drive2.key
      key2 = drive3.key
      onready()
    })
  })

  function onready () {
    drive2.writeFile('a', 'hello', err => {
      t.error(err, 'no error')
      drive3.writeFile('b', 'world', err => {
        t.error(err, 'no error')
        onwrite()
      })
    })
  }

  function onwrite () {
    drive1.mount('a', key1, err => {
      t.error(err, 'no error')
      drive1.mount('b', key2, err => {
        t.error(err, 'no error')
        onmount()
      })
    })
  }

  function onmount () {
    drive1.readFile('a/a', (err, contents) => {
      t.error(err, 'no error')
      t.true(contents)
      drive1.getAllMounts({ memory: true }, (err, mounts) => {
        t.error(err, 'no error')
        t.same(mounts.size, 2)
        t.true(mounts.get('/'))
        t.true(mounts.get('/a'))
        t.end()
      })
    })
  }
})

test('getAllMounts with no mounts returns only the root mount', async t => {
  const drive1 = create()
  drive1.ready(err => {
    t.error(err, 'no error')
    drive1.getAllMounts({ memory: true}, (err, mounts) => {
      t.error(err, 'no error')
      t.true(mounts)
      t.same(mounts.size, 1)
      t.end()
    })
  })
})

test('can list all mounts (including those not in memory)', async t => {
  const drive1 = create()
  const drive2 = create()
  const drive3 = create()

  var key1, key2

  replicateAll([drive1, drive2, drive3])

  drive3.ready(err => {
    t.error(err, 'no error')
    drive2.ready(err => {
      t.error(err, 'no error')
      key1 = drive2.key
      key2 = drive3.key
      onready()
    })
  })

  function onready () {
    drive2.writeFile('a', 'hello', err => {
      t.error(err, 'no error')
      drive3.writeFile('b', 'world', err => {
        t.error(err, 'no error')
        onwrite()
      })
    })
  }

  function onwrite () {
    drive1.mount('a', key1, err => {
      t.error(err, 'no error')
      drive1.mount('b', key2, err => {
        t.error(err, 'no error')
        onmount()
      })
    })
  }

  function onmount () {
    drive1.getAllMounts((err, mounts) => {
      t.error(err, 'no error')
      t.same(mounts.size, 3)
      t.true(mounts.get('/'))
      t.true(mounts.get('/a'))
      t.true(mounts.get('/b'))
      t.end()
    })
  }
})

test('can list in-memory mounts recursively')
test('dynamically resolves cross-mount symlinks')
test('symlinks cannot break the sandbox')
test('versioned mount')
test('watch will unwatch on umount')

function replicateAll (drives, opts) {
  const streams = []
  const replicated = new Set()

  for (let i = 0; i < drives.length; i++) {
    for (let j = 0; j < drives.length; j++) {
      const source = drives[i]
      const dest = drives[j]
      if (i === j || replicated.has(j)) continue

      const s1 = source.replicate({ ...opts, live: true, encrypt: false })
      const s2 = dest.replicate({ ...opts, live: true, encrypt: false })
      streams.push([s1, s2])

      s1.pipe(s2).pipe(s1)
    }
    replicated.add(i)
  }

  return streams
}
