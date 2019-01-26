var tape = require('tape')
var create = require('./helpers/create')

tape('owner is writable', function (t) {
  var archive = create()

  archive.on('ready', function () {
    t.ok(archive.writable)
    t.ok(archive.metadataFeed.writable)
    t.ok(archive.contentFeed.writable)
    t.end()
  })
})


