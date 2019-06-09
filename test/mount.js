var test = require('tape')
const ram = require('random-access-memory')
const memdb = require('memdb')
const corestore = require('random-access-corestore')
const Megastore = require('megastore')
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
  const megastore = new Megastore(ram, memdb(), false)
  await megastore.ready()

  const cs1 = megastore.get('cs1')
  const cs2 = megastore.get('cs2')

  const drive1 = create({ corestore: cs1 })
  const drive2 = create({ corestore: cs2 })

  drive2.ready(err => {
    t.error(err, 'no error')
    drive1.mount('a', drive2.key, err => {
      t.error(err, 'no error')
      drive1.writeFile('a/b', 'hello', err => {
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

test.only('can mount hypercores', async t => {
  const store = corestore(ram)
  const drive = create({ corestore: store })
  var core

  drive.ready(err => {
    t.error(err, 'no error')
    core = store.get()
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


test('versioned mount')
test('watch will unwatch on umount')
