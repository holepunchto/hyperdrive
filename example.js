var hyperdrive = require('hyperdrive')
var memdb = require('memdb')

var drive = hyperdrive(memdb())
var drive2 = hyperdrive(memdb())

var archive = drive.add('.')

archive.appendFile('index.js', function (err) {
  if (err) throw err
  archive.finalize(function (err) {
    if (err) throw err
    console.log(archive.id)

    var clone = drive2.get(archive.id, 'clone')

    clone.select(0)

    var p1 = drive.createPeerStream()
    var p2 = drive2.createPeerStream()

    p1.pipe(p2).pipe(p1)
  })
})
