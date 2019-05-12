var test = require('tape')
var create = require('./helpers/create')

test('basic read/write to/from a mount', t => {
  const archive1 = create()
  const archive2 = create()

  const s1 = archive1.replicate({ live: true, encrypt: false })
  s1.pipe(archive2.replicate({ live: true, encrypt: false })).pipe(s1)

  archive2.ready(err => {
    t.error(err, 'no error')
    archive2.writeFile('b', 'hello', err => {
      t.error(err, 'no error')
      archive1.mount('a', archive2.key, err => {
        t.error(err, 'no error')
        archive1.readFile('a/b', (err, contents) => {
          t.error(err, 'no error')
          t.same(contents, Buffer.from('hello'))
          t.end()
        })
      })
    })
  })
})

test('readdir returns mounts', t => {
  const archive1 = create()
  const archive2 = create()

  const s1 = archive1.replicate({ live: true, encrypt: false })
  s1.pipe(archive2.replicate({ live: true, encrypt: false })).pipe(s1)

  archive2.ready(err => {
    t.error(err, 'no error')
    archive1.mkdir('b', err => {
      t.error(err, 'no error')
      archive1.mkdir('b/a', err => {
        t.error(err, 'no error')
        archive1.mount('a', archive2.key, err => {
          t.error(err, 'no error')
          archive1.readdir('/', (err, dirs) => {
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
  const archive1 = create()
  const archive2 = create()

  const s1 = archive1.replicate({ live: true, encrypt: false })
  s1.pipe(archive2.replicate({ live: true, encrypt: false })).pipe(s1)

  var watchEvents = 0

  archive2.ready(err => {
    t.error(err, 'no error')
    archive1.mount('a', archive2.key, err => {
      t.error(err, 'no error')
      archive1.watch('/', () => {
        if (++watchEvents === 1) t.end()
      })
      archive2.writeFile('a', 'hello', err => {
        t.error(err, 'no error')
      })
    })
  })
})
