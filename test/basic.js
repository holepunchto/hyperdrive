var tape = require('tape')
var sodium = require('sodium-universal')
var create = require('./helpers/create')

tape('write and read', function (t) {
  var archive = create()

  archive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    archive.readFile('/hello.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('world'))
      t.end()
    })
  })
})

