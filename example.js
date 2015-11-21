var level = require('level')
var fs = require('fs')
var hyperdrive = require('./')

var db = level('test.db')
var drive = hyperdrive(db, {
  read: function (name, offset, length, cb) {
    fs.open(name, 'r', function (err, fd) {
      if (err) return cb(err)

      var buf = new Buffer(length)
      loop(null, 0)

      function loop (err, read) {
        if (err) return done(err)
        length -= read
        offset += read
        if (!length) return done()
        fs.read(fd, buf, buf.length - length, length, offset, loop)
      }

      function done (error) {
        fs.close(fd, function (err) {
          if (err) error = err
          if (error) return cb(error)
          cb(null, buf)
        })
      }
    })
  },
  write: function (name, offset, buf, cb) {
    fs.open(name, 'a', function (err, fd) {
      if (err) return cb(err)

      var length = buf.length
      loop(null, 0)

      function loop (err, written) {
        if (err) return done(err)
        length -= written
        offset += written
        if (!length) return done()
        fs.write(fd, buf, buf.length - length, length, offset, loop)
      }

      function done (error) {
        fs.close(fd, function (err) {
          if (err) error = err
          if (error) return cb(error)
          cb(null, buf)
        })
      }
    })
  }
})

// fs.createReadStream('test.mp4')
//   .pipe(drive.createFileWriteStream('test.mp4', console.log))

drive.list().on('data', function (tree) {
  var iterator = require('./lib/block-iterator')
  var ite = iterator(drive, tree)
  var size = 0

  ite.read(size, function loop (err, buf) {
    if (!buf) return
    console.log(size += buf.length, buf)
    ite.next(loop)
  })
})
