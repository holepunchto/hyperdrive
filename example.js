var raf = require('random-access-file')
var path = require('path')
var hyperdrive = require('./')

var drive = hyperdrive(require('memdb')())
var otherDrive = hyperdrive(require('memdb')())

var archive = drive.createArchive({
  file: function (name) {
    return raf(path.join(__dirname, name))
  }
})

archive.append('example.js')
archive.append('index.js')

archive.finalize(function (err) {
  if (err) throw err

  var otherArchive = otherDrive.createArchive(archive.key)
  var stream = otherArchive.replicate()

  stream.pipe(archive.replicate()).pipe(stream)

  console.log('Archive key is ' + archive.key.toString('hex'))

  otherArchive.on('download', function (data) {
    console.log('(downloaded %d bytes)', data.length)
  })

  otherArchive.download(0, function () {
    console.log('first entry was downloaded')
  })

  otherArchive.download(1, function () {
    console.log('second entry was downloaded')
  })
})
