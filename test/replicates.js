var tape = require('tape')
var memdb = require('memdb')
var os = require('os')
var path = require('path')
var fs = require('fs')
var hyperdrive = require('../')

tape('replicates file', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())

  var archive = drive.add('.')

  archive.appendFile(__filename, 'test.js', function (err) {
    t.error(err, 'no error')
    archive.finalize(function (err) {
      t.error(err, 'no error')

      var tmp = path.join(os.tmpdir(), 'hyperdrive-' + process.pid + '-' + Date.now())
      var clone = driveClone.get(archive.id, tmp)

      clone.once('file-downloaded', function () {
        var buf = []
        clone.createFileStream(0)
          .on('data', function (data) {
            buf.push(data)
          })
          .on('end', function () {
            t.same(Buffer.concat(buf), fs.readFileSync(__filename))
            t.same(fs.readFileSync(path.join(tmp, 'test.js')), fs.readFileSync(__filename))
            t.end()
          })
      })

      clone.select(0)

      var p1 = drive.createPeerStream()
      var p2 = driveClone.createPeerStream()

      p1.pipe(p2).pipe(p1)
    })
  })
})
