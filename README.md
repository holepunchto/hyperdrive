# hyperdrive

A file sharing system

```
npm install hyperdrive
```

## Usage

``` js
var hyperdrive = require('hyperdrive')
var drive = hyperdrive(db, {
  get: function (name, start, length, cb) {
    // lookup a requested chunk
    fs.open(name, 'r', function (err, fd) {
      if (err) return cb(err)
      var buf = new Buffer(length)
      fs.read(fd, buf, 0, length, start, function (err, read) {
        if (err) return cb(err)
        length -= read
        if (length) return fs.read(fd, buf, buf.length - length, length, start += read, read)
        fs.close(fd, function () {
          cb(null, buf)
        })
      })
    })
  }
})

var files = drive.batch()

fs.createReadStream('test-1.mp4').pipe(batch.add('test-1.mp4', function () {
  fs.createReadStream('test-2.mp4').pipe(batch.add('test-2.mp4', function () {
    batch.end(function (err, entry) {
      console.log('added', entry)
    })
  }))
}))
```

## License

MIT
