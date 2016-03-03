# hyperdrive

A file sharing network based on [rabin](https://github.com/maxogden/rabin) file chunking and append only feeds of data verified by merkle trees.

```
npm install hyperdrive
```

[![build status](http://img.shields.io/travis/mafintosh/hyperdrive.svg?style=flat)](http://travis-ci.org/mafintosh/hyperdrive)

For a more detailed technical information on how it works see [SPECIFICATION.md](SPECIFICATION.md).
If you are interested in only using the feed part of the spec see [hypercore](https://github.com/mafintosh/hypercore) which implements that.

## Usage

First create a new feed to share

``` js
var hyperdrive = require('hyperdrive')
var level = require('level')

var db = level('./hyperdrive.db')
var drive = hyperdrive(db)

var pack = drive.add('./some-folder')

pack.appendFile('my-file.txt', function (err) {
  if (err) throw err
  pack.finalize(function () {
    var link = pack.id.toString('hex')
    console.log(link, '<-- this is your hyperdrive link')
  })
})
```

Then to share it

``` js
var disc = require('discovery-channel')()
var hyperdrive = require('hyperdrive')
var net = require('net')
var level = require('level')
var db = levelup('./another-hyperdrive.db')
var drive = hyperdrive(db)

var link = new Buffer({your-hyperdrive-link-from-the-above-example}, 'hex')

var server = net.createServer(function (socket) {
  socket.pipe(drive.createPeerStream()).pipe(socket)
})

server.listen(0, function () {
  disc.add(link, server.address().port)
  disc.on('peer', function (hash, peer) {
    var socket = net.connect(peer.port, peer.host)
    socket.pipe(drive.createPeerStream()).pipe(socket)
  })
})
```

If you run this code on multiple computers you should be able to access
the content in the feed by doing

``` js
var archive = drive.get(link, './folder-to-store-data-in') // the link identifies/verifies the content

archive.entry(0, function (err, entry) { // get the first entry
  console.log(entry) // prints {name: 'my-file.txt', ...}
  var stream = archive.createFileStream(0)
  stream.on('data', function (data) {
    console.log(data) // <-- file data
  })
  stream.on('end', function () {
    console.log('no more data')
  })
})
```

## API

#### `var drive = hyperdrive(db)`

Create a new hyperdrive instance. db should be a [levelup](https://github.com/level/levelup) instance.
You can add a folder to store the file data in as the second argument.

#### `var stream = drive.createPeerStream()`

Create a new peer replication duplex stream. This stream should be piped together with another
peer stream somewhere else to start replicating the feeds

#### `var archive = drive.add([basefolder])`

Add a new archive to share. `basefolder` will be the root of this archive.

#### `var archive = drive.get(id, [basefolder])`

Retrive a finalized archive.

#### `archive.on('file-download', entry, data)`

Emitted when a data block is downloaded for a file.

#### `archive.on('file-upload', entry, data)`

Emitted when a data block is uploaded for a file.

#### `archive.on('file-downloaded', entry)`

Emitted when a file is fully downloaded.

#### `archive.append(entry, [opts], [callback])`

Either returns a write stream if entry is a file or returns `null` if it is directory. Calls callback when the entry has finished writing.

#### `var progress = archive.appendFile(filename, [name], [callback])`

Append a file to a non-finalized archive. If you don't specify `name` the entry will be called `filename`.

Returns a `progress` object.

#### `archive.finalize([callback])`

Finalize an archive. After an archive is finalized it will be sharable and will have a `.id` property.

#### `archive.ready(callback)`

Wait for the archive to be ready. Afterwards `archive.entries` will contain the total amount of entries available.

#### `archive.entry(index, callback)`

Read the entry metadata stored at `index`. An metadata entry looks like this

``` js
{
  type: 'file-or-directory',
  name: 'filename',
  mode: fileMode,
  size: fileSize,
  uid: optionalUid,
  gid: optionalGid,
  mtime: optionalMtimeInSeconds,
  ctime: optionalCtimeInSeconds
}
```

#### `var progress = archive.download(index, [callback])`

Downloads the file specified by index and calls the callback when done.
You have to call this or create a file stream to download a file.

#### `var rs = archive.createFileStream(index)`

Create a stream to a file.

#### `var rs = archive.createEntryStream()`

Stream out all metadata entries

#### `progress` Stats and Events

A progress object is returned for `archive.download` and `archive.appendFile`. The progress object will contain stats for a single download/append:

```javascript
  {
    bytesRead: 0, // Bytes Downloaded/Append Progress
    bytesTotal: 0, // Total Size of File
    bytesInitial: 0 // Previous download progress (file was partially downloaded, then stopped)
  }
```

##### `progress.on('ready')`

Emitted when a file download/read is ready. Will emit when progress object has `bytesTotal` and `bytesInitial` set, `bytesRead` will be 0.

##### `progress.on('end')`

Emitted when a file download/read is done.

## License

MIT
