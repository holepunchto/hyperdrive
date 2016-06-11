# hyperdrive

A file sharing network based on [rabin](https://github.com/maxogden/rabin) file chunking and [append only feeds of data verified by merkle trees](https://github.com/mafintosh/hypercore).

```
npm install hyperdrive
```

[![build status](http://img.shields.io/travis/mafintosh/hyperdrive.svg?style=flat)](http://travis-ci.org/mafintosh/hyperdrive)

If you are interested in learning how hyperdrive works on a technical level a specification is available in the [Dat docs repo](https://github.com/datproject/docs/blob/master/hyperdrive.md)

## Usage

First create a new feed to share

``` js
var hyperdrive = require('hyperdrive')
var level = require('level')

var db = level('./hyperdrive.db')
var drive = hyperdrive(db)

var archive = drive.createArchive()
var ws = archive.createFileWriteStream('hello.txt') // add hello.txt

ws.write('hello')
ws.write('world')
ws.end()

archive.finalize(function () { // finalize the archive
  var link = archive.key.toString('hex')
  console.log(link, '<-- this is your hyperdrive link')
})
```

Then to share it

``` js
var swarm = require('discovery-swarm')()
var hyperdrive = require('hyperdrive')
var level = require('level')
var db = level('./another-hyperdrive.db')
var drive = hyperdrive(db)

var link = new Buffer('your-hyperdrive-link-from-the-above-example', 'hex')
var archive = drive.createArchive(link)

swarm.listen()
swarm.join(link)
swarm.on('connection', function (connection) {
  connection.pipe(archive.replicate()).pipe(connection)
})
```

If you run this code on multiple computers you should be able to access
the content in the feed by doing

``` js
var archive = drive.createArchive(link) // the link identifies/verifies the content

archive.get(0, function (err, entry) { // get the first file entry
  console.log(entry) // prints {name: 'hello.txt', ...}
  var stream = archive.createFileReadStream(entry)
  stream.on('data', function (data) {
    console.log(data) // <-- file data
  })
  stream.on('end', function () {
    console.log('no more data')
  })
})
```

If you want to write/read files to the file system provide a storage driver as the file option

``` js
var raf = require('random-access-file') // a storage driver that writes to the file system
var archive = drive.createArchive({
  file: function (name) {
    return raf('my-download-folder/' + name)
  }
})
```

## API

#### `var drive = hyperdrive(db)`

Create a new hyperdrive instance. db should be a [levelup](https://github.com/level/levelup) instance.

#### `var archive = drive.createArchive([key], [options])`

Creates an archive instance. If you want to download/upload an existing archive provide the archive key
as the first argument. Options include

``` js
{
  live: false, // set this to share the archive without finalizing it
  file: function (name) {
    // set this to determine how file data is stored.
    // the storage instance should implement the hypercore storage api
    // https://github.com/mafintosh/hypercore#storage-api
    return someStorageInstance
  }
}
```

If you do not provide the file option all file data is stored in the leveldb.

#### `archive.key`

A buffer that verifies the archive content. In live mode this is a 32 byte public key.
Otherwise it is a 32 byte hash.

#### `archive.append(entry, callback)`

Append an entry to the archive. Only possible if this is an live archive you originally created
or an unfinalized archive.

If you set the file option in the archive constructor you can use this method to append an already
existing file to the archive.

``` js
var archive = drive.createArchive({
  file: function (name) {
    console.log('returning storage for', name)
    return raf(name)
  }
})

archive.append('hello.txt', function () {
  console.log('hello.txt was read and appended')
})
```

#### `archive.finalize([callback])`

Finalize the archive. You need to do this before sharing it if the archive is not live.

#### `archive.get(index, callback)`

Reads an entry from the archive.

#### `archive.download(index, callback)`

Fully downloads a file / entry from the archive and calls the callback afterwards.

#### `archive.on('download', data)`

Emitted every time a piece of data is downloaded

#### `archive.on('upload', data)`

Emitted every time a piece of data is uploaded

#### `var rs = archive.list(opts={}, cb)`

Returns a readable stream of all entries in the archive.

* `opts.offset` - start streaming from this offset (default: 0)
* `opts.live` - keep the stream open as new updates arrive (default: false)

You can collect the results of the stream with `cb(err, entries)`.

#### `var rs = archive.createFileReadStream(entry)`

Returns a readable stream of the file content of an file in the archive.

#### `var ws = archive.createFileWriteStream(entry)`

Returns a writable stream that writes a new file to the archive. Only possible if the archive is live and you own it
or if the archive is not finalized.

#### `var stream = archive.replicate()`

Pipe this stream together with another peer that is interested in the same archive to replicate the content.

## License

MIT
