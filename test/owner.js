var test = require('tape')
var hyperdrive = require('../')
var memdb = require('memdb')
var db = memdb()

var secretKey
var key

test('owner', function (t) {
  t.plan(2)
  var drive = hyperdrive(db)
  var archive = drive.createArchive(undefined, { live: true })
  archive.open(function () {
    key = archive.key.toString('hex')
    secretKey = archive.metadata.secretKey.toString('hex')
    t.ok(archive.owner)
    t.is(secretKey.length, 128)
  })
})

test('owner', function (t) {
  t.plan(2)
  var drive = hyperdrive(db)
  var archive = drive.createArchive(key, { live: true })
  archive.open(function () {
    t.is(archive.key.toString('hex'), key)
    t.is(archive.metadata.secretKey.toString('hex'), secretKey)
  })
})
