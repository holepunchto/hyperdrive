const tape = require('tape')
const create = require('./helpers/create')

tape('root is a dir', function (t) {
  const archive = create()

  archive.stat('/', function (err, st) {
    t.error(err, 'no error')
    t.ok(st.isDirectory())
    t.end()
  })
})

tape('implicit dirs', function (t) {
  t.plan(1 + 3 * 2)

  const archive = create()

  archive.writeFile('hello/world/how/are/you', 'test', function (err) {
    t.error(err, 'no error')
    archive.stat('hello/world/how/are/you', function (err, st) {
      t.error(err, 'no error')
      t.ok(st.isFile())
    })
    archive.stat('hello', function (err, st) {
      t.error(err, 'no error')
      t.ok(st.isDirectory())
    })
    archive.stat('hello/world', function (err, st) {
      t.error(err, 'no error')
      t.ok(st.isDirectory())
    })
  })
})

tape('explicit dirs wins over implicit dirs', function (t) {
  const archive = create()

  archive.writeFile('a/b/c/d/e', '', {mtime: new Date(1000)}, function (err) {
    t.error(err, 'no error')
    archive.stat('a/b', function (err, st) {
      t.error(err, 'no error')
      t.ok(st.isDirectory())
      t.same(st.mtime, new Date(1000))
      archive.mkdir('a/b', {mtime: new Date(2000)}, function (err) {
        t.error(err, 'no error')
        archive.stat('a/b', function (err, st) {
          t.error(err, 'no error')
          t.same(st.mtime, new Date(2000))
          archive.stat('a', function (err, st) {
            t.error(err, 'no error')
            t.same(st.mtime, new Date(2000))
            archive.stat('a/b/c', function (err, st) {
              t.error(err, 'no error')
              t.same(st.mtime, new Date(1000))
              t.end()
            })
          })
        })
      })
    })
  })
})
