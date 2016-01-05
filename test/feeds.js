var tape = require('tape')
var octal = require('octal')
var memdb = require('memdb')
var hyperdrive = require('../')
var dir = require('fs').statSync('.')

tape('pack', function (t) {
  var drive = create()

  var pack = drive.add()

  var stream = pack.entry({
    name: 'test.txt',
    mode: octal(600)
  })

  stream.write('hello')
  stream.write('world')
  stream.end()

  pack.finalize(function () {
    t.same(pack.blocks, 1) // only 1 block
    t.ok(!!pack.id, 'has id')
    t.end()
  })
})

tape('pack with dir', function (t) {
  var drive = create()

  var pack = drive.add()

  var stream = pack.entry({
    name: 'folder',
    mode: dir.mode
  })

  t.same(stream, null)

  pack.finalize(function () {
    var feed = drive.get(pack.id)
    feed.get(0, function (err, entry) {
      t.error(err)
      t.same(entry.type, 'directory')
      t.end()
    })
  })
})

tape('pack and get', function (t) {
  var drive = create()

  var pack = drive.add()

  var stream = pack.entry({
    name: 'test.txt',
    mode: octal(600)
  })

  stream.write('hello')
  stream.write('world')
  stream.end()

  pack.finalize(function () {
    var feed = drive.get(pack.id)

    feed.get(0, function (err, entry) {
      t.error(err, 'no error')
      t.same(entry.type, 'file')
      t.same(entry.value, {
        name: 'test.txt',
        mode: octal(600),
        size: 10,
        uid: 0,
        gid: 0,
        mtime: 0,
        ctime: 0
      })
      t.same(entry.link.blocks, 2) // 2 block
      t.same(entry.link.index, [10])

      var content = drive.get(entry.link)

      content.get(0, function (err, blk) {
        t.error(err, 'no error')
        t.same(blk.toString(), 'helloworld')
        content.get(1, function (err, blk) {
          t.error(err, 'no error')
          t.same(blk, new Buffer([0, 10]), 'has index block')
          content.get(2, function (_, blk) {
            t.ok(!blk, 'no more data')
            t.end()
          })
        })
      })
    })
  })
})

tape('feed.get(non-existent)', function (t) {
  var drive = create()

  var pack = drive.add()

  var stream = pack.entry({
    name: 'test.txt',
    mode: octal(600)
  })

  stream.write('hello')
  stream.write('world')
  stream.end()

  pack.finalize(function () {
    var feed = drive.get(pack.id)
    feed.get(1, function (err, val) {
      t.error(err, 'no error')
      t.same(val, null)
      t.end()
    })
  })
})

tape('add empty file', function (t) {
  var drive = create()

  var pack = drive.add()

  var stream = pack.entry({
    name: 'test.txt',
    mode: octal(600)
  })

  stream.end()

  pack.finalize(function () {
    var feed = drive.get(pack.id)
    feed.get(0, function (err, entry) {
      t.error(err, 'no error')
      t.same(entry.value.name, 'test.txt', 'same name')
      t.same(entry.link, null, 'no link')
      t.end()
    })
  })
})

tape('entry stream', function (t) {
  var drive = create()

  var pack = drive.add()

  var stream = pack.entry({
    name: 'test.txt',
    mode: octal(600)
  })

  stream.end()

  pack.finalize(function () {
    var feed = drive.get(pack.id)

    feed.createStream()
      .on('data', function (entry) {
        t.same(entry.value.name, 'test.txt', 'same name')
        t.same(entry.link, null, 'no link')
      })
      .on('end', function () {
        t.ok(true, 'ended')
        t.end()
      })
  })
})

tape('file stream', function (t) {
  t.plan(5)
  var drive = create()

  var pack = drive.add()

  var stream = pack.entry({
    name: 'test.txt',
    mode: octal(600)
  })

  stream.write('hello world')
  stream.end()

  pack.finalize(function () {
    var feed = drive.get(pack.id)

    feed.get(0, function (err, entry) {
      t.error(err, 'no error')
      drive.get(entry).createStream()
        .on('data', function (data) {
          t.same(data.toString(), 'hello world')
        })
        .on('end', function () {
          t.ok(true, 'ended')
        })

      drive.get(entry).createStream({start: 5})
        .on('data', function (data) {
          t.same(data.toString(), ' world')
        })
        .on('end', function () {
          t.ok(true, 'ended')
        })
    })
  })
})

function create () {
  return hyperdrive(memdb())
}
