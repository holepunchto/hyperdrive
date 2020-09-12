const test = require('tape')
const ram = require('random-access-memory')

const Corestore = require('corestore')
const Replicator = require('./helpers/replicator')
const create = require('./helpers/create')
const hyperdrive = require('../')

test('basic read/write to/from a mount', t => {
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()

  r.replicate(drive1, drive2)

  drive2.ready(err => {
    t.error(err, 'no error')
    drive2.writeFile('b', 'hello', err => {
      t.error(err, 'no error')
      drive1.mount('a', drive2.key, err => {
        t.error(err, 'no error')
        drive1.readFile('a/b', (err, contents) => {
          t.error(err, 'no error')
          t.same(contents, Buffer.from('hello'))
          r.end()
        })
      })
    })
  })
})

test('should emit metadata-feed and content-feed events for all mounts', t => {
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()

  r.replicate(drive1, drive2)

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
    r.end()
  }
})

test('can delete a mount', t => {
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()

  r.replicate(drive1, drive2)

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
        r.end()
      })
    })
  }
})

test('multiple flat mounts', t => {
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()
  const drive3 = create()

  var key1, key2

  r.replicate(drive1, drive2)
  r.replicate(drive2, drive3)
  r.replicate(drive1, drive3)

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
        r.end()
      })
    })
  }
})

test('recursive mounts', async t => {
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()
  const drive3 = create()

  var key1, key2

  r.replicate(drive1, drive2)
  r.replicate(drive2, drive3)
  r.replicate(drive1, drive3)

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
        r.end()
      })
    })
  }
})

test('readdir returns mounts', t => {
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()

  r.replicate(drive1, drive2)

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
            r.end()
          })
        })
      })
    })
  })
})

test('cross-mount watch', t => {
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()

  r.replicate(drive1, drive2)

  var watchEvents = 0

  drive2.ready(err => {
    t.error(err, 'no error')
    drive1.mount('a', drive2.key, err => {
      t.error(err, 'no error')
      drive1.watch('/', () => {
        if (++watchEvents === 1) r.end()
      })
      drive2.writeFile('a', 'hello', err => {
        t.error(err, 'no error')
      })
    })
  })
})

test('cross-mount symlink', t => {
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()

  r.replicate(drive1, drive2)

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
          r.end()
        })
      })
    })
  }
})

test('lists nested mounts, shared write capabilities', async t => {
  const store = new Corestore(ram)
  store.ready(onready)

  function onready () {
    const drive1 = create({ corestore: store, namespace: 'd1' })
    const drive2 = create({ corestore: store, namespace: 'd2' })
    const drive3 = create({ corestore: store, namespace: 'd3' })

    drive3.ready(err => {
      t.error(err, 'no error')
      drive1.mount('a', drive2.key, err => {
        t.error(err, 'no error')
        drive1.mount('a/b', drive3.key, err => {
          t.error(err, 'no error')
          onmount(drive1, drive2, drive3)
        })
      })
    })
  }

  function onmount (drive1, drive2, drive3) {
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

test('nested mount readdir returns correct mount', async t => {
  const store = new Corestore(ram)
  let expected = {}
  store.ready(onready)

  function onready () {
    const drive1 = create({ corestore: store, namespace: 'd1' })
    const drive2 = create({ corestore: store, namespace: 'd2' })
    const drive3 = create({ corestore: store, namespace: 'd3' })

    drive3.ready(err => {
      t.error(err, 'no error')
      drive1.mount('a', drive2.key, err => {
        t.error(err, 'no error')
        drive1.mount('a/b', drive3.key, err => {
          t.error(err, 'no error')
          drive1.writeFile('a/b/c', 'hello', err => {
            t.error(err, 'no error')
            expected['a'] = drive1.key
            expected['a/b'] = drive2.key
            expected['a/b/c'] = drive3.key
            onmount(drive1, drive2, drive3)
          })
        })
      })
    })
  }

  function onmount (drive1, drive2, drive3) {
    drive1.readdir('/', { recursive: true, includeStats: true }, (err, list) => {
      t.error(err, 'no error')
      let seen = 0
      for (let { name, stat, mount } of list) {
        t.true(expected[name] && expected[name].equals(mount.key), 'correct mount key')
        seen++
      }
      t.same(seen, 3)
      t.end()
    })
  }
})

test('nested mount readdir returns correct mount starting in mountpoint', async t => {
  const store = new Corestore(ram)
  let expected = {}
  store.ready(onready)

  function onready () {
    const drive1 = create({ corestore: store, namespace: 'd1' })
    const drive2 = create({ corestore: store, namespace: 'd2' })
    const drive3 = create({ corestore: store, namespace: 'd3' })

    drive3.ready(err => {
      t.error(err, 'no error')
      drive1.mount('a', drive2.key, err => {
        t.error(err, 'no error')
        drive1.mount('a/b', drive3.key, err => {
          t.error(err, 'no error')
          drive1.writeFile('a/b/c', 'hello', err => {
            t.error(err, 'no error')
            expected['b'] = drive2.key
            expected['b/c'] = drive3.key
            onmount(drive1, drive2, drive3)
          })
        })
      })
    })
  }

  function onmount (drive1, drive2, drive3) {
    drive1.readdir('/a', { recursive: true, includeStats: true }, (err, list) => {
      t.error(err, 'no error')
      let seen = 0
      for (let { name, stat, mount } of list) {
        t.true(expected[name] && expected[name].equals(mount.key), 'correct mount key')
        seen++
      }
      t.same(seen, 2)
      t.end()
    })
  }
})

test('nested mount readdir returns correct stat modes', async t => {
  const store = new Corestore(ram)
  let expected = {}
  store.ready(onready)

  function onready () {
    const drive1 = create({ corestore: store, namespace: 'd1' })
    const drive2 = create({ corestore: store, namespace: 'd2' })
    const drive3 = create({ corestore: store, namespace: 'd3' })

    drive3.ready(err => {
      t.error(err, 'no error')
      drive1.mkdir('b', err => {
        t.error(err, 'no error')
        drive1.writeFile('b/c', 'hello', err => {
          t.error(err, 'no error')
          drive1.mount('a', drive2.key, err => {
            t.error(err, 'no error')
            drive1.mount('a/b', drive3.key, err => {
              t.error(err, 'no error')
              drive1.writeFile('a/b/c', 'hello', err => {
                t.error(err, 'no error')
                expected['a'] = 16877
                expected['b'] = 16877
                expected['b/c'] = 33188
                expected['a/b'] = 16877
                expected['a/b/c'] = 33188
                onmount(drive1, drive2, drive3)
              })
            })
          })
        })
      })
    })
  }

  function onmount (drive1, drive2, drive3) {
    drive1.readdir('/', { recursive: true, includeStats: true }, (err, list) => {
      t.error(err, 'no error')
      let seen = 0
      for (let { name, stat, mount } of list) {
        t.true(expected[name] && expected[name] === stat.mode, 'correct stat mode')
        seen++
      }
      t.same(seen, 5)
      t.end()
    })
  }
})

test('nested mount readdir returns correct stat modes, non-recursive', async t => {
  const store = new Corestore(ram)
  let expected = {}
  store.ready(onready)

  function onready () {
    const drive1 = create({ corestore: store, namespace: 'd1' })
    const drive2 = create({ corestore: store, namespace: 'd2' })
    const drive3 = create({ corestore: store, namespace: 'd3' })

    drive3.ready(err => {
      t.error(err, 'no error')
      drive1.writeFile('b/c', 'hello', err => {
        t.error(err, 'no error')
        drive1.mount('a', drive2.key, err => {
          t.error(err, 'no error')
          drive1.mount('a/b', drive3.key, err => {
            t.error(err, 'no error')
            drive1.writeFile('a/b/c', 'hello', err => {
              t.error(err, 'no error')
              expected['a'] = 16877
              expected['b'] = 16877
              onmount(drive1, drive2, drive3)
            })
          })
        })
      })
    })
  }

  function onmount (drive1, drive2, drive3) {
    drive1.readdir('/', { recursive: false, includeStats: true }, (err, list) => {
      t.error(err, 'no error')
      let seen = 0
      for (let { name, stat, mount } of list) {
        t.true(expected[name] && expected[name] === stat.mode, 'correct stat mode')
        seen++
      }
      t.same(seen, 2)
      t.end()
    })
  }
})

test('nested mount readdir returns correct inner paths, non-recursive', async t => {
  const store = new Corestore(ram)
  let expected = {}
  store.ready(onready)

  function onready () {
    const drive1 = create({ corestore: store, namespace: 'd1' })
    const drive2 = create({ corestore: store, namespace: 'd2' })
    const drive3 = create({ corestore: store, namespace: 'd3' })

    drive3.ready(err => {
      t.error(err, 'no error')
      drive1.writeFile('b/c', 'hello', err => {
        t.error(err, 'no error')
        drive1.mount('a', drive2.key, err => {
          t.error(err, 'no error')
          drive1.mount('a/b', drive3.key, err => {
            t.error(err, 'no error')
            drive1.writeFile('a/b/c', 'hello', err => {
              t.error(err, 'no error')
              expected['c'] = 'c'
              onmount(drive1, drive2, drive3)
            })
          })
        })
      })
    })
  }

  function onmount (drive1, drive2, drive3) {
    drive1.readdir('/a/b', { recursive: false, includeStats: true }, (err, list) => {
      t.error(err, 'no error')
      let seen = 0
      for (let { name, stat, mount, innerPath } of list) {
        t.true(expected[name] && expected[name] === innerPath, 'correct stat mode')
        seen++
      }
      t.same(seen, 1)
      t.end()
    })
  }
})

test('nested mount readdir returns correct inner paths, recursive', async t => {
  const store = new Corestore(ram)
  let expected = {}
  store.ready(onready)

  function onready () {
    const drive1 = create({ corestore: store, namespace: 'd1' })
    const drive2 = create({ corestore: store, namespace: 'd2' })
    const drive3 = create({ corestore: store, namespace: 'd3' })

    drive3.ready(err => {
      t.error(err, 'no error')
      drive1.writeFile('b/c', 'hello', err => {
        t.error(err, 'no error')
        drive1.mount('a', drive2.key, err => {
          t.error(err, 'no error')
          drive1.mount('a/b', drive3.key, err => {
            t.error(err, 'no error')
            drive1.writeFile('a/b/c', 'hello', err => {
              t.error(err, 'no error')
              expected['a'] = 'a'
              expected['a/b'] = 'b'
              expected['b/c'] = 'b/c'
              expected['a/b/c'] = 'c'
              onmount(drive1, drive2, drive3)
            })
          })
        })
      })
    })
  }

  function onmount (drive1, drive2, drive3) {
    drive1.readdir('/', { recursive: true, includeStats: true }, (err, list) => {
      t.error(err, 'no error')
      let seen = 0
      for (let { name, stat, mount, innerPath } of list) {
        t.true(expected[name] && expected[name] === innerPath, 'correct stat mode')
        seen++
      }
      t.same(seen, 4)
      t.end()
    })
  }
})

test('nested mount info returns correct mount keys and paths', async t => {
  const store = new Corestore(ram)
  let expected = []
  store.ready(onready)

  function onready () {
    const drive1 = create({ corestore: store, namespace: 'd1' })
    const drive2 = create({ corestore: store, namespace: 'd2' })
    const drive3 = create({ corestore: store, namespace: 'd3' })

    drive3.ready(err => {
      t.error(err, 'no error')
      drive3.writeFile('c', 'hello', err => {
        t.error(err, 'no error')
        drive1.mount('a', drive2.key, err => {
          t.error(err, 'no error')
          drive1.mount('a/b', drive3.key, err => {
            t.error(err, 'no error')
            drive1.writeFile('a/b/c', 'hello', err => {
              t.error(err, 'no error')
              expected.push({ path: '/', key: drive1.key, mountPath: '/' })
              expected.push({ path: 'a', key: drive2.key, mountPath: '/a' })
              expected.push({ path: 'a/b', key: drive3.key, mountPath: '/a/b'})
              expected.push({ path: 'a/b/c', key: drive3.key, mountPath: '/a/b' })
              onmount(drive1, drive2, drive3)
            })
          })
        })
      })
    })
  }

  function onmount (drive1, drive2, drive3) {
    validateNext()
    function validateNext () {
      if (!expected.length) return t.end()
      const { path, key, mountPath } = expected.pop()
      drive1.info(path, (err, info) => {
        t.error(err, 'no error')
        t.true(info.feed.key.equals(key))
        t.same(info.mountPath, mountPath)
        return validateNext()
      })
    }
  }
})

test('independent corestores do not share write capabilities', t => {
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()

  r.replicate(drive1, drive2)

  drive2.ready(err => {
    t.error(err, 'no error')
    drive1.mount('a', drive2.key, err => {
      t.error(err, 'no error')
      drive1.writeFile('a/b', 'hello', err => {
        t.ok(err)
        drive1.readFile('a/b', (err, contents) => {
          t.ok(err)
          r.end()
        })
      })
    })
  })
})

test('shared corestores will share write capabilities', async t => {
  const store = new Corestore(ram)
  store.ready(onready)

  function onready () {
    const drive1 = create({ corestore: store, namespace: 'ns1' })
    const drive2 = create({ corestore: store, namespace: 'ns2' })

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
  }
})

test('can mount hypercores', async t => {
  const store = new Corestore(ram)
  store.ready(onready)

  function onready () {
    const drive = create({ corestore: store })
    var core = store.get()

    drive.ready(err => {
      t.error(err, 'no error')
      core.ready(err => {
        t.error(err, 'no error')
        core.append('hello', err => {
          t.error(err, 'no error')
          return onappend(drive, core)
        })
      })
    })
  }

  function onappend (drive, core) {
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
  const store = new Corestore(ram)
  store.ready(onready)

  function onready () {

    const drive1 = create({ corestore: store, namespace: 'ns1' })
    const drive2 = create({ corestore: store, namespace: 'ns2' })

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
  }
})

test('mount replication between hyperdrives', async t => {
  const r = new Replicator(t)
  const store1 = new Corestore(path => ram('cs1/' + path))
  const store2 = new Corestore(path => ram('cs2/' + path))
  const store3 = new Corestore(path => ram('cs3/' + path))

  await new Promise(resolve => {
    store1.ready(() => {
      store2.ready(() => {
        store3.ready(resolve)
      })
    })
  })

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
          r.replicate(drive1, drive2)
          r.replicate(drive2, drive3)
          r.replicate(drive1, drive3)
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

  r.end()
})

test('mount replication between hyperdrives, multiple, nested mounts', async t => {
  const r = new Replicator(t)
  const [d1, d2] = await createMountee()
  const drive = await createMounter(d1, d2)
  await verify(drive)

  r.end()

  function createMountee () {
    const store = new Corestore(path => ram('cs1/' + path))
    const drive1 = create({ corestore: store, namespace: 'ns1' })
    var drive2, drive3

    return new Promise(resolve => {
      drive1.ready(err => {
        t.error(err, 'no error')
        drive2 = create({ corestore: store, namespace: 'ns2' })
        drive3 = create({ corestore: store, namespace: 'ns3' })
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
    const store = new Corestore(path => ram('cs4/' + path))

    return new Promise(resolve => {
      store.ready(() => {
        const drive1 = create({ corestore: store  })
        drive1.ready(err => {
          t.error(err, 'no error')
          r.replicate(drive1, d2)
          r.replicate(d2, d3)
          r.replicate(drive1, d3)
          drive1.mount('a', d2.key, err => {
            t.error(err, 'no error')
            drive1.mount('b', d3.key, err => {
              t.error(err, 'no error')
              setTimeout(() => resolve(drive1), 1000)
            })
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
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()
  const drive3 = create()

  var key1, key2

  r.replicate(drive1, drive2)
  r.replicate(drive2, drive3)
  r.replicate(drive1, drive3)

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
        t.same(mounts.size, 3)
        t.true(mounts.get('/'))
        t.true(mounts.get('/a'))
        r.end()
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
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()
  const drive3 = create()

  var key1, key2

  r.replicate(drive1, drive2)
  r.replicate(drive2, drive3)
  r.replicate(drive1, drive3)

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
      r.end()
    })
  }
})

test('can watch multiple mounts', async t => {
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()
  const drive3 = create()

  var key1, key2

  r.replicate(drive1, drive2)
  r.replicate(drive2, drive3)
  r.replicate(drive1, drive3)

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
    drive1.mount('a', key1, err => {
      t.error(err, 'no error')
      drive1.mount('b', key2, err => {
        t.error(err, 'no error')
        onmount()
      })
    })
  }

  function onmount () {
    var changes = 0
    const watcher = drive1.watch('', () => {
      changes++
    })
    watcher.on('ready', watchers => {
      t.same(watchers.length, 2)
      drive2.writeFile('a', 'hello', err => {
        t.error(err, 'no error')
        drive3.writeFile('b', 'world', err => {
          t.error(err, 'no error')
          setImmediate(() => {
            t.same(changes, 3)
            r.end()
          })
        })
      })
    })
  }
})

test('can watch nested mounts', async t => {
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()
  const drive3 = create()

  var key1, key2

  r.replicate(drive1, drive2)
  r.replicate(drive2, drive3)
  r.replicate(drive1, drive3)

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
    drive1.mount('a', key1, err => {
      t.error(err, 'no error')
      drive2.mount('b', key2, err => {
        t.error(err, 'no error')
        onmount()
      })
    })
  }

  function onmount () {
    var changes = 0
    const watcher = drive1.watch('', () => {
      changes++
    })
    watcher.on('ready', watchers => {
      t.same(watchers.length, 2)
      drive2.writeFile('a', 'hello', err => {
        t.error(err, 'no error')
        drive3.writeFile('b', 'world', err => {
          t.error(err, 'no error')
          setImmediate(() => {
            t.same(changes, 3)
            r.end()
          })
        })
      })
    })
  }
})

test('can watch cyclic mounts', async t => {
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()

  var key1, key2

  r.replicate(drive1, drive2)

  drive1.ready(err => {
    t.error(err, 'no error')
    drive2.ready(err => {
      t.error(err, 'no error')
      key1 = drive1.key
      key2 = drive2.key
      onready()
    })
  })

  function onready () {
    drive1.mount('a', key2, err => {
      t.error(err, 'no error')
      drive2.mount('b', key1, err => {
        t.error(err, 'no error')
        onmount()
      })
    })
  }

  function onmount () {
    var changes = 0
    const watcher = drive1.watch('', () => {
      changes++
    })
    watcher.on('ready', watchers => {
      t.same(watchers.length, 2)
      drive2.writeFile('c', 'hello', err => {
        t.error(err, 'no error')
        drive1.writeFile('c', 'world', err => {
          t.error(err, 'no error')
          setImmediate(() => {
            t.same(changes, 4)
            r.end()
          })
        })
      })
    })
  }
})

test('readdir with noMounts will not traverse mounts', async t => {
  const r = new Replicator(t)
  const drive1 = create()
  const drive2 = create()

  r.replicate(drive1, drive2)

  drive2.ready(err => {
    t.error(err, 'no error')
    drive1.mkdir('b', err => {
      t.error(err, 'no error')
      drive1.mkdir('b/a', err => {
        t.error(err, 'no error')
        drive2.mkdir('c', err => {
          t.error(err, 'no error')
          drive1.mount('a', drive2.key, err => {
            t.error(err, 'no error')
            drive1.readdir('/', { recursive: true, noMounts: true}, (err, dirs) => {
              t.error(err, 'no error')
              t.same(dirs, ['b', 'b/a', 'a'])
              r.end()
            })
          })
        })
      })
    })
  })
})

test('update does not clear the mount', function (t) {
  const drive = hyperdrive(ram)
  const other = hyperdrive(drive.corestore, null, { namespace: 'test' })

  other.writeFile('/foo', 'bar', function (err) {
    t.error(err, 'no error')
    drive.mount('/bar', other.key, function (err) {
      t.error(err, 'no error')
      drive._update('/bar', {}, function (err) {
        t.error(err, 'no error')
        drive.readdir('/bar', function (err, files) {
          t.error(err, 'no error')
          t.same(files, ['foo'])
          t.end()
        })
      })
    })
  })

})

test('can list in-memory mounts recursively')
test('dynamically resolves cross-mount symlinks')
test('symlinks cannot break the sandbox')
test('versioned mount')
test('watch will unwatch on umount')
