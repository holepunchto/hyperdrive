# Hyperdrive

Hyperdrive is a secure, real time distributed file system

This readme describes version 8 is coming out soon, try the preview here

``` js
npm install mafintosh/hyperdrive
```

## Usage

Hyperdrive aims to implement the same API as Node.js' core fs module.

``` js
var hyperdrive = require('hyperdrive')
var archive = hyperdrive('./my-first-hyperdrive') // content will be stored in this folder

archive.writeFile('/hello.txt', 'world', function (err) {
  if (err) throw err
  archive.readdir('/', function (err, list) {
    if (err) throw err
    console.log(list) // prints ['hello.txt']
    archive.readFile('/hello.txt', 'utf-8', function (err, data) {
      if (err) throw err
      console.log(data) // prints 'world'
    })
  })
})
```

A big difference is that you can replicate the file system to other computers! All you need is a stream.

``` js
var net = require('net')

// ... on one machine

var server = net.createServer(function (socket) {
  socket.pipe(archive.replicate()).pipe(socket)
})

server.listen(10000)

// ... on another

var clonedArchive = hyperdrive('./my-cloned-hyperdrive')
var socket = net.connect(10000)

socket.pipe(clonedArchive.replicate()).pipe(socket)
```

It also comes with build in versioning and real time replication. See more below.

## API

#### `var archive = hyperdrive(storage, [key], [options])`

Create a new hyperdrive. Storage should be a function or a string.

If storage is a string content will be stored inside that folder.

If storage is a function it is called with a string name for each abstract-random-access instance that is needed
to store the archive.

#### `var stream = archive.replicate([options])`

Replicate this archive. Options include

``` js
{
  live: false // keep replicating
}
```

#### `archive.version`

Get the current version of the archive (incrementing number).

#### `archive.key`

The public key identifying the archive.

#### `archive.discoveryKey`

A key derived from the public key that can be used to discovery other peers sharing this archive.

#### `archive.on('ready')`

Emitted when the archive is fully ready and all properties has been populated.

#### `archive.on('error', err)`

Emitted when a critical error during load happened.

#### `var oldDrive = archive.checkout(version)`

Checkout a readonly copy of the archive at an old version.

#### `var stream = archive.history([options])`

Get a stream of all changes and their versions from this archive.

#### `var stream = archive.createReadStream(name, [options])`

Read a file out as a stream. Similar to fs.createReadStream.

Options include:

``` js
{
  start: optionalByteOffset, // similar to fs
  end: optionalInclusiveByteEndOffset, // similar to fs
  length: optionalByteLength
}
```

#### `archive.readFile(name, [encoding], callback)`

Read an entire file into memory. Similar to fs.readFile.

#### `var stream = archive.createWriteStream(name, [options])`

Write a file as a stream. Similar to fs.createWriteStream.

#### `archive.writeFile(name, buffer, [options], [callback])`

Write a file from a single buffer. Similar to fs.writeFile.

#### `archive.unlink(name, [callback])`

Unlinks (deletes) a file. Similar to fs.unlink.

#### `archive.mkdir(name, [options], [callback])`

Explictly create an directory. Similar to fs.mkdir

#### `archive.rmdir(name, [callback])`

Delete an empty directory. Similar to fs.rmdir.

#### `archive.readdir(name, [callback])`

Lists a directory. Similar to fs.readdir.

#### `archive.stat(name, callback)`

Stat an entry. Similar to fs.stat.

#### `archive.lstat(name, callback)`

Stat an entry but do not follow symlinks. Similar to fs.lstat.

#### `archive.access(name, callback)`

Similar to fs.access.
