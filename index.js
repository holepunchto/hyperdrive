var equals = require('buffer-equals')
var subleveldown = require('subleveldown')
var crypto = require('crypto')
var hash = require('./lib/hash')
var messages = require('./lib/messages')
var createFileReadStream = require('./lib/file-read-stream')
var createFileWriteStream = require('./lib/file-write-stream')
var add = require('./lib/add')

function noop () {}

function Hyperdrive (db, opts) {
  if (!(this instanceof Hyperdrive)) return new Hyperdrive(db, opts)
  if (!opts) opts = {}

  this.db = db
  this._read = opts.read || noop
  this._write = opts.write || noop
  this._files = subleveldown(db, 'files', {valueEncoding: messages.FileDB})
  this._byHash = subleveldown(db, 'tree-by-hash', {valueEncoding: messages.TreeDB})
  this._byIndex = subleveldown(db, 'tree-by-index', {valueEncoding: 'binary'})
}

Hyperdrive.prototype._readAndVerify = function (name, offset, length, checksum, cb) {
  this._read(name, offset, length, function (err, buf) {
    if (err) return cb(err)
    if (!equals(hash.data(buf), checksum)) return cb(new Error('Checksum mismatch'))
    cb(null, buf)
  })
}

Hyperdrive.prototype.listFiles = function () {
  return this._files.createValueStream()
}

Hyperdrive.prototype.add = function () {
  return add(this)
}

Hyperdrive.prototype.createFileReadStream = function (tree, opts) {
  return createFileReadStream(this, tree, opts)
}

Hyperdrive.prototype.createFileWriteStream = function (name, cb) {
  var stream = createFileWriteStream(this, name)

  if (cb) {
    stream.on('error', cb)
    stream.on('finish', function () {
      cb(null, stream.result)
    })
  }

  return stream
}

var level = require('level')
var fs = require('fs')

var db = level('test2.db')
var drive = Hyperdrive(db, {
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

var start = 94444439
drive.listFiles().on('data', function (data) {
  drive.createFileReadStream(data.tree, {start: start})
    .on('data', function (data) {
      console.log(start += data.length, 228740314)
    })
})
