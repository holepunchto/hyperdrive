# hyperdrive

A file sharing network based on [rabin](https://github.com/maxogden/rabin) file chunking and append only feeds of data verified by merkle trees.

```
npm install hyperdrive
```

[![build status](http://img.shields.io/travis/mafintosh/hyperdrive.svg?style=flat)](http://travis-ci.org/mafintosh/hyperdrive)

For more detailed technical information on how it works see [SPECIFICATION.md](SPECIFICATION.md). Hyperdrive runs in node.js as well as in the browser. [Try a browser based demo here](http://mafintosh.github.io/hyperdrive)

## Status

## Almost ready for prime time :rocket:
## Feel free to open issues and ask questions

APIs/protocols might be still break.

Main things missing are:

- [ ] Storing downloaded files as actual files (not in leveldb doh)
- [x] Full documention of the apis/protocols
- [ ] Tit-for-tat swarm logic
- [ ] peer discovery events so a dht would know what to look for
- [ ] Tests for internal logic
- [ ] Move archive/file abstractions to new modules
- [x] A bit of refactoring

## Usage

First create a new feed to share

``` js
var hyperdrive = require('hyperdrive')
var fs = require('fs')
var levelup = require('levelup')

var aLevelDB = levelup('./my-drive')
var drive = hyperdrive(aLevelDB)

var pack = drive.add()

var stream = pack.entry({
  name: 'my-file.txt',
  mode: 0644
})

fs.createReadStream('my-file.txt').pipe(stream)

pack.finalize(function () {
  var link = pack.id.toString('hex')
  console.log(link, '<-- this is your hyperdrive link')
})
```

Then to share it

``` js
var disc = require('discovery-channel')()
var hyperdrive = require('hyperdrive')
var net = require('net');
var levelup = require('levelup')
var aLevelDB = levelup('./mydb')
var drive = hyperdrive(aLevelDB)

var link = new Buffer({your-hyperdrive-link-from-the-above-example}, 'hex')

var server = net.createServer(function (socket) {
  socket.pipe(drive.createPeerStream()).pipe(socket)
})

server.listen(0, function () {
  function ann () {
    // discovery-channel currently only works with 20 bytes hashes
    disc.announce(link.slice(0, 20), server.address().port)
  }

  ann()
  setInterval(ann, 10000)

  var lookup = disc.lookup(link.slice(0, 20))

  lookup.on('peer', function (ip, port) {
    var socket = net.connect(port, ip)
    socket.pipe(drive.createPeerStream()).pipe(socket)
  })
})
```

If you run this code on multiple computers you should be able to access
the content in the feed by doing

``` js
var feed = drive.get(link) // the link identifies/verifies the content

feed.get(0, function (err, entry) { // get the first entry
  console.log(entry) // prints {name: 'my-file.txt', ...}
  var content = drive.get(entry)
  content.get(0, function (err, data) {
    console.log('first block of the file', data)
    content.get(1, ...)
  })
})
```

## API

## Stability: UNSTABLE, likely to have major changes

#### `var drive = hyperdrive(db)`

Create a new hyperdrive instance. db should be a [levelup](https://github.com/level/levelup) instance.

#### `var stream = drive.createPeerStream()`

Create a new peer replication duplex stream. This stream should be piped together with another
peer stream somewhere else to start replicating the feeds

#### `var archive = drive.add()`

Add a new archive to share.

#### `var stream = archive.entry(fileInfo, [cb])`

Add a new file entry to the file archive. `fileInfo` should look like this

``` js
{
  name: 'dir/filename', // required
  type: 'file or directory', // detected using the mode if not provided
  mode: 0666, // optional
  uid: 0, // optional
  gid: 0, // optional
  mtime: mtimeInSeconds // optional
  ctime: ctimeInSeconds // optional
}
```

The stream returned is a writable stream. You should write the file contents to that.
If you are writing a directory the stream will be `null`.

Optionally you can provide a callback that is called when the content has been written

#### `archive.finalize([cb])`

Finalize the archive. After the callback has been called you can get the feed `id`
by accessing `archive.id`.

#### `var feed = drive.get(id_or_entry)`

Access a feed by it's id or entry object.
The entry object looks like this

``` js
{
  type: 'metadata or file',
  value: optionalValueCorrespondingToTheType,
  link: {
    id: feedId,
    blocks: blocksInFeed
  }
}
```

If you just pass in a `feedId` the type will default to `metadata`.

#### `feed.get(index, callback)`

Get a block from the the feed.

* If the feed is an metadata feed the return value will be an `entry` object.
* If the feed is a file feed it will be a buffer.

#### `var stream = feed.createStream()`

Create a readable stream of all entries in the feed.
The values will be of the same type as described in `feed.get`

#### `var cursor = feed.cursor()`

If the feed is a file feed you can create a random access cursor by calling `var cursor = feed.cursor()`.

#### `cursor.read(byteOffset, callback)`

Will return a buffer stored at that byte offset in the file.

#### `cursor.next(callback)`

Will return the next buffer at the current cursor position.

## License

MIT
