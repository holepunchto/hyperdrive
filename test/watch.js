var tape = require('tape')
var create = require('./helpers/create')

tape('simple watch', function (t) {
  const db = create(null)

  var watchEvents = 0
  db.ready(err => {
    t.error(err, 'no error')
    db.watch('/a/path/', () => {
      if (++watchEvents === 2) {
        t.end()
      }
    })
    doWrites()
  })

  function doWrites () {
    db.writeFile('/a/path/hello', 't1', err => {
      t.error(err, 'no error')
      db.writeFile('/b/path/hello', 't2', err => {
        t.error(err, 'no error')
        db.writeFile('/a/path/world', 't3', err => {
          t.error(err, 'no error')
        })
      })
    })
  }
})
