var tape = require('tape')
var memdb = require('memdb')
var os = require('os')
var path = require('path')
var fs = require('fs')
var mkdirp = require('mkdirp')
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

      // to make sure .get can take plain string link
      var link = archive.id.toString('hex')
      var clone = driveClone.get(link, tmp)

      clone.download(0, function () {
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

      var p1 = drive.createPeerStream()
      var p2 = driveClone.createPeerStream()

      p1.pipe(p2).pipe(p1)
    })
  })
})

tape('replicates empty files', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())

  var tmp = path.join(os.tmpdir(), 'hyperdrive-' + process.pid + '-' + Date.now())
  var emptyFile = path.join(tmp, 'empty.txt')

  mkdirp(path.dirname(emptyFile), function (err) {
    if (err) throw err
    fs.open(emptyFile, 'a', function (err, fd) {
      if (err) throw err
      fs.close(fd, appendFile)
    })
  })

  var archive = drive.add(tmp)

  function appendFile () {
    archive.appendFile(emptyFile, 'empty.txt', function (err) {
      t.error(err, 'no error')
      archive.finalize(function (err) {
        t.error(err, 'no error')

        var tmp2 = path.join(os.tmpdir(), 'hyperdrive-2-' + process.pid + '-' + Date.now())
        var clone = driveClone.get(archive.id, tmp2)

        clone.download(0, function () {
          clone.createFileStream(0)
            .on('data', function (data) {

            })
            .on('end', function () {
              t.same(
                fs.readFileSync(emptyFile),
                fs.readFileSync(path.join(tmp2, 'empty.txt')),
                'empty file copied over'
              )
              t.end()
            })
        })

        var p1 = drive.createPeerStream()
        var p2 = driveClone.createPeerStream()

        p1.pipe(p2).pipe(p1)
      })
    })
  }
})

tape('replicates empty directories', function (t) {
  var drive = hyperdrive(memdb())
  var driveClone = hyperdrive(memdb())

  var tmp = path.join(os.tmpdir(), 'hyperdrive-' + process.pid + '-' + Date.now())
  var emptyDir = path.join(tmp, 'empty')

  mkdirp(emptyDir, function (err) {
    if (err) throw err
    appendDir()
  })

  var archive = drive.add(tmp)

  function appendDir () {
    archive.appendFile(emptyDir, 'empty', function (err) {
      t.error(err, 'no error')
      archive.finalize(function (err) {
        t.error(err, 'no error')

        var tmp2 = path.join(os.tmpdir(), 'hyperdrive-2-' + process.pid + '-' + Date.now())
        var clone = driveClone.get(archive.id, tmp2)

        clone.download(0, function () {
          clone.createFileStream(0)
            .on('data', function (data) {
              // nothing to do with empty dirs
            })
            .on('end', function () {
              fs.stat(path.join(tmp2, 'empty'), function (err, stats) {
                t.error(err, 'no stats error')
                t.ok(stats, 'empty dir copied')
                t.end()
              })
            })
        })

        var p1 = drive.createPeerStream()
        var p2 = driveClone.createPeerStream()

        p1.pipe(p2).pipe(p1)
      })
    })
  }
})
