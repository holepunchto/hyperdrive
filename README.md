# Hyperdrive

Hyperdrive is a secure, real time distributed file system

``` js
npm install hyperdrive
```

[![Build Status](https://travis-ci.org/mafintosh/hyperdrive.svg?branch=master)](https://travis-ci.org/mafintosh/hyperdrive)

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

var clonedArchive = hyperdrive('./my-cloned-hyperdrive', origKey)
var socket = net.connect(10000)

socket.pipe(clonedArchive.replicate()).pipe(socket)
```

It also comes with build in versioning and real time replication. See more below.

## API

#### `var archive = hyperdrive(storage, [key], [options])`

Create a new hyperdrive.

The `storage` parameter defines how the contents of the archive will be stored. It can be one of the following, depending on how much control you require over how the archive is stored.

- If you pass in a string, the archive content will be stored in a folder at the given path.
- You can also pass in a function. This function will be called with the name of each of the required files for the archive, and needs to return a [`random-access-storage`](https://github.com/random-access-storage/) instance.
- If you require complete control, you can also pass in an object containing a `metadata` and a `content` field. Both of these need to be functions, and are called with the following arguments:

  - `name`: the name of the file to be stored
  - `opts`
    - `key`: the [feed key](https://github.com/mafintosh/hypercore#feedkey) of the underlying Hypercore instance
    - `discoveryKey`: the [discovery key](https://github.com/mafintosh/hypercore#feeddiscoverykey) of the underlying Hypercore instance
  - `archive`: the current Hyperdrive instance

  The functions need to return a a [`random-access-storage`](https://github.com/random-access-storage/) instance.

Options include:

``` js
{
  sparse: true, // only download data on content feed when it is specifically requested
  sparseMetadata: true // only download data on metadata feed when requested
  extensions: [] // Optionally specify which extensions to use when replicating
  metadataStorageCacheSize: 65536 // how many entries to use in the metadata hypercore's LRU cache
  contentStorageCacheSize: 65536 // how many entries to use in the content hypercore's LRU cache
  treeCacheSize: 65536 // how many entries to use in the append-tree's LRU cache
}
```

Note that a cloned hyperdrive archive can be "sparse". Usually (by setting `sparse: true`) this means that the content is not downloaded until you ask for it, but the entire metadata feed is still downloaded. If you want a _very_ sparse archive, where even the metadata feed is not downloaded until you request it, then you should _also_ set `sparseMetadata: true`.

#### `var stream = archive.replicate([options])`

Replicate this archive. Options include

``` js
{
  live: false, // keep replicating
  download: true, // download data from peers?
  upload: true // upload data to peers?
}
```

#### `archive.version`

Get the current version of the archive (incrementing number).

#### `archive.key`

The public key identifying the archive.

#### `archive.discoveryKey`

A key derived from the public key that can be used to discovery other peers sharing this archive.

#### `archive.writable`

A boolean indicating whether the archive is writable.

#### `archive.on('ready')`

Emitted when the archive is fully ready and all properties has been populated.

#### `archive.on('update')'

Emitted when the archive has got a new change.

#### `archive.on('error', err)`

Emitted when a critical error during load happened.

#### `archive.on('close')`

Emitted when the archive has been closed

#### `archive.on('extension', name, message, peer)`

Emitted when a peer sends you an extension message with `archive.extension()`.
You can respond with `peer.extension(name, message)`.

#### `var oldDrive = archive.checkout(version, [opts])`

Checkout a readonly copy of the archive at an old version. Options are used to configure the `oldDrive`:

```js
{
  metadataStorageCacheSize: 65536 // how many entries to use in the metadata hypercore's LRU cache
  contentStorageCacheSize: 65536 // how many entries to use in the content hypercore's LRU cache
  treeCacheSize: 65536 // how many entries to use in the append-tree's LRU cache
}
```

#### `archive.download([path], [callback])`

Download all files in path of current version.
If no path is specified this will download all files.

You can use this with `.checkout(version)` to download a specific version of the archive.

``` js
archive.checkout(version).download()
```

#### `var stream = archive.history([options])`

Get a stream of all changes and their versions from this archive.

### `archive.extension(name, message)`

Send an extension message to connected peers. [Read more in the hypercore docs](https://github.com/mafintosh/hypercore#feedextensionname-message).

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

#### `archive.readFile(name, [options], callback)`

Read an entire file into memory. Similar to fs.readFile.

Options can either be an object or a string

Options include:
```js
{
  encoding: string
  cached: true|false // default: false
}
```
or a string can be passed as options to simply set the encoding - similar to fs.

If `cached` is set to `true`, this function returns results only if they have already been downloaded.

#### `var stream = archive.createDiffStream(version, [options])`

Diff this archive with another version. `version` can both be a version number of a checkout instance of the archive. The `data` objects looks like this

``` js
{
  type: 'put' | 'del',
  name: '/some/path/name.txt',
  value: {
    // the stat object
  }
}
```

#### `var stream = archive.createWriteStream(name, [options])`

Write a file as a stream. Similar to fs.createWriteStream.
If `options.cached` is set to `true`, this function returns results only if they have already been downloaded.

#### `archive.writeFile(name, buffer, [options], [callback])`

Write a file from a single buffer. Similar to fs.writeFile.

#### `archive.unlink(name, [callback])`

Unlinks (deletes) a file. Similar to fs.unlink.

#### `archive.mkdir(name, [options], [callback])`

Explictly create an directory. Similar to fs.mkdir

#### `archive.rmdir(name, [callback])`

Delete an empty directory. Similar to fs.rmdir.

#### `archive.readdir(name, [options], [callback])`

Lists a directory. Similar to fs.readdir.

Options include:

``` js
{
    cached: true|false, // default: false
}
```

If `cached` is set to `true`, this function returns results from the local version of the archive’s append-tree. Default behavior is to fetch the latest remote version of the archive before returning list of directories.

#### `archive.stat(name, [options], callback)`

Stat an entry. Similar to fs.stat. Sample output:

```
Stat {
  dev: 0,
  nlink: 1,
  rdev: 0,
  blksize: 0,
  ino: 0,
  mode: 16877,
  uid: 0,
  gid: 0,
  size: 0,
  offset: 0,
  blocks: 0,
  atime: 2017-04-10T18:59:00.147Z,
  mtime: 2017-04-10T18:59:00.147Z,
  ctime: 2017-04-10T18:59:00.147Z,
  linkname: undefined }
```

The output object includes methods similar to fs.stat:

``` js
var stat = archive.stat('/hello.txt')
stat.isDirectory()
stat.isFile()
```

Options include:
```js
{
  cached: true|false // default: false,
  wait: true|false // default: true
}
```

If `cached` is set to `true`, this function returns results only if they have already been downloaded.

If `wait` is set to `true`, this function will wait for data to be downloaded. If false, will return an error.

#### `archive.lstat(name, [options], callback)`

Stat an entry but do not follow symlinks. Similar to fs.lstat.

Options include:
```js
{
  cached: true|false // default: false,
  wait: true|false // default: true
}
```

If `cached` is set to `true`, this function returns results only if they have already been downloaded.

If `wait` is set to `true`, this function will wait for data to be downloaded. If false, will return an error.

#### `archive.access(name, [options], callback)`

Similar to fs.access.

Options include:
```js
{
  cached: true|false // default: false,
  wait: true|false // default: true
}
```

If `cached` is set to `true`, this function returns results only if they have already been downloaded.

If `wait` is set to `true`, this function will wait for data to be downloaded. If false, will return an error.

#### `archive.open(name, flags, [mode], callback)`

Open a file and get a file descriptor back. Similar to fs.open.

Note that currently only read mode is supported in this API.

#### `archive.read(fd, buf, offset, len, position, callback)`

Read from a file descriptor into a buffer. Similar to fs.read.

#### `archive.close(fd, [callback])`

Close a file. Similar to fs.close.

#### `archive.close([callback])`

Closes all open resources used by the archive.
The archive should no longer be used after calling this.
