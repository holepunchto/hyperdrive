var tape = require('tape')
var create = require('./helpers/create')

var mask = 511 // 0b111111111

tape('stat file', function (t) {
  var drive = create()

  drive.writeFile('/foo', 'bar', { mode: 438 }, function (err) {
    t.error(err, 'no error')
    drive.stat('/foo', function (err, st) {
      t.error(err, 'no error')
      t.same(st.isDirectory(), false)
      t.same(st.isFile(), true)
      t.same(st.mode & mask, 438)
      t.same(st.size, 3)
      t.same(st.offset, 0)
      t.end()
    })
  })
})

tape('stat dir', function (t) {
  var drive = create()

  console.log('going into mkdir')
  drive.mkdir('/foo', function (err) {
    console.log('after mkdir')
    t.error(err, 'no error')
    drive.stat('/foo', function (err, st) {
      t.error(err, 'no error')
      console.log('right here')
      t.same(st.isDirectory(), true)
      t.same(st.isFile(), false)
      t.same(st.mode & mask, 493)
      t.same(st.offset, 0)
      t.end()
    })
  })
})

tape('metadata', function (t) {
  var archive = create()

  var attributes = { hello: 'world' }
  var metadata = {
    attributes: Buffer.from(JSON.stringify(attributes))
  }

  archive.writeFile('/foo', 'bar', { metadata }, function (err) {
    t.error(err, 'no error')
    archive.stat('/foo', function (err, st) {
      t.error(err, 'no error')
      t.deepEqual(JSON.parse(metadata.attributes.toString()), { hello: 'world' })
      t.end()
    })
  })
})
