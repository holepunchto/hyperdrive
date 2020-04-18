# Hyperdrive
[![Build Status](https://travis-ci.org/mafintosh/hyperdrive.svg?branch=master)](https://travis-ci.org/mafintosh/hyperdrive)

#### *Note*: This is a beta version of Hyperdrive that's backed by [Hypertrie](https://github.com/mafintosh/hypertrie)

Hyperdrive is a secure, real-time distributed file system designed for easy P2P file sharing.

It has a handful of cool features:
* __Version Controlled__: Files are versioned by default, making it easy to see historical changes and prevent data loss.
* __Composable__: Using our mount system, Hyperdrives can be nested within other Hyperdrives, enabling powerful multi-user collaboration tools.
* __Shareable with One Link__: You can share an entire Hyperdrive with others by sending them a single 32-byte key. If you'd like more granularity, our mount system enables the fine-grained sharing of specific directories.
* __Sparse Downloading__ By default, readers only download the portions of files they need, on demand. You can stream media from friends without jumping through hoops! Seeking is snappy and there's no buffering.
* __Fast Lookups__: File metadata is stored in a distributed trie structure, meaning files can be located with minimal network lookups.
* __Version Tagging__: You can assign string names to Hyperdrive versions and store these within the drive, making it straightforward to switch between semantically-meaningful versions.

You can use Hyperdrive standalone within your applications, or you can use it through the [Hyperdrive daemon](https://github.com/andrewosh/hyperdrive-daemon) which handles storage and DHT networking for you. The daemon provides both a gRPC API for managing remote Hyperdrives, and a FUSE API that turns Hyperdrives into normal folders on your computer.

## Installation
``` js
npm install hyperdrive@beta
```

## Usage

Hyperdrive aims to implement the same API as Node.js' core `fs` module, and mirrors many POSIX APIs.

``` js
var hyperdrive = require('hyperdrive')
var drive = hyperdrive('./my-first-hyperdrive') // content will be stored in this folder

drive.writeFile('/hello.txt', 'world', function (err) {
  if (err) throw err
  drive.readdir('/', function (err, list) {
    if (err) throw err
    console.log(list) // prints ['hello.txt']
    drive.readFile('/hello.txt', 'utf-8', function (err, data) {
      if (err) throw err
      console.log(data) // prints 'world'
    })
  })
})
```

Hyperdrives can easily be replicated to other machines over any stream-based transport layer! 

``` js
var net = require('net')

// ... on one machine

var server = net.createServer(function (socket) {
  socket.pipe(drive.replicate()).pipe(socket)
})

server.listen(10000)

// ... on another

var clonedDrive = hyperdrive('./my-cloned-hyperdrive', origKey)
var socket = net.connect(10000)

socket.pipe(clonedDrive.replicate()).pipe(socket)
```

It also comes with build in versioning, live replication (where the replication streams remain open, syncing new changes), and nested Hyperdrive mounting. See more below.

## API

#### `var drive = hyperdrive(storage, [key], [options])`

Create a new Hyperdrive.

The `storage` parameter defines how the contents of the drive will be stored. It can be one of the following, depending on how much control you require over how the drive is stored.

- If you pass in a string, the drive content will be stored in a folder at the given path.
- You can also pass in a function. This function will be called with the name of each of the required files for the drive, and needs to return a [`random-access-storage`](https://github.com/random-access-storage/) instance.
- If you require complete control, you can also pass in a [corestore](https://github.com/andrewosh/corestore) instance (or an API-compatible replacement).

  - `name`: the name of the file to be stored
  - `opts`
    - `key`: the [feed key](https://github.com/mafintosh/hypercore#feedkey) of the underlying Hypercore instance
    - `discoveryKey`: the [discovery key](https://github.com/mafintosh/hypercore#feeddiscoverykey) of the underlying Hypercore instance
  - `drive`: the current Hyperdrive instance

Options include:

``` js
{
  sparse: true, // only download data on content feed when it is specifically requested
  sparseMetadata: true // only download data on metadata feed when requested
  extensions: [], // The list of extension message types to use
}
```

For more storage configuration, you can also provide any corestore option.

Note that a cloned hyperdrive drive is fully "sparse" by default, meaning that the `sparse` and `sparseMetadata` options are both true. This is usually the best way to use Hyperdrive, but you can also set these options to false to enable eager downloading of both the content and the metadata. If you'd like more control over download strategies, you can use the `download` method directly.

### Replication
Hyperdrive replication occurs through streams, meaning you can pipe a drive's replication stream into any stream-based transport system you'd like. If you have many nested Hyperdrives mounted within a parent drive, `replicate` will sync all children as well.

#### `var stream = drive.replicate([options])`

Replicate this drive. Options include

``` js
{
  live: false, // keep replicating,
  encrypt: true // Enable NOISE encryption.
}
```

### Public Fields

#### `drive.version`

Get the current version of the drive (incrementing number).

#### `drive.key`

The public key identifying the drive.

#### `drive.discoveryKey`

A key derived from the public key that can be used to discovery other peers sharing this drive.

#### `drive.writable`

A boolean indicating whether the drive is writable.

#### `drive.peers`

A list of peers currently replicating with this drive

### Lifecycle Events

#### `drive.on('ready')`

Emitted when the drive is fully ready and all properties has been populated.

#### `drive.on('error', err)`

Emitted when a critical error during load happened.

#### `drive.on('update')`

Emitted when there is a new update to the drive.

#### `drive.on('peer-add', peer)`

Emitted when a new peer has been added.

```js
const drive = Hyperdrive({
  extension: ['example']
})

drive.on('extension', (name, message, peer) => {
  console.log(name, message.toString('utf8'))
})

drive.on('peer-add', (peer) => {
  peer.extension('example', Buffer.from('Hello World!', 'utf8'))
})
```

#### `drive.on('peer-remove', peer)`

Emitted when a peer has been removed.

#### `drive.on('close')`

Emitted when the drive has been closed.

### Extension Management
Hyperdrive supports [hypercore](https://github.com/mafintosh/hypercore) extensions, letting you plug custom logic into a drive's replication streams.

#### `drive.on('extension', name, message, peer)`

Emitted when a peer has sent you an extension message. The `name` is a string from one of the extension types in the constructor, `message` is a buffer containing the message contents, and `peer` is a reference to the peer that sent the extension. You can send an extension back with `peer.extension(name, message)`.

#### `drive.extension(name, message)`

Broadcasts an extension message to all connected peers. The `name` must be a string for an extension passed in the constructor and the message must be a buffer.

### Version Control
Since Hyperdrive is built on top of append-only logs, old versions of files are preserved by default. You can get a read-only snapshot of a drive at any point in time with the `checkout` function, which takes a version number. Additionally, you can tag versions with string names, making them more parseable.

#### `var oldDrive = drive.checkout(version, [opts])`

Checkout a readonly copy of the drive at an old version. Options for the checkout are duplicated from the parent by default, but you can also pass in additional Hyperdrive options.

#### `drive.createTag(name, [version], cb)`
Create a tag that maps to a given version. If a version is not provided, the current version will be used.

Tags are stored inside the drive's "hidden trie," meaning they're not enumerable using Hyperdrive's standard filesystem methods. They will replicate with all the other data in the drive, though.

#### `drive.getTaggedVersion(name, cb)`
Return the version corresponding to a tag.

Combined with `checkout`, this lets you navigate between tagged versions.

#### `drive.deleteTag(name, cb)`
Delete a tag. If the tag doesn't exist, this will be a no-op.

#### `drive.getAllTags(cb)`
Return a Map of all tags. The Map will be of the form:
```
{
  name => version
}
```

### Downloading
In sparse mode (which is the default), data will be downloaded from peers on-demand. If you'd like more control over this, you can use the `download` function to explicitly mark certain files/directory for immediate downloading.  

#### `drive.download([path], [callback])`

Download all files in path of current version.
If no path is specified this will download all files.

You can use this with `.checkout(version)` to download a specific version of the drive.

``` js
drive.checkout(version).download()
```

### Reading and Writing

#### `var stream = drive.createReadStream(name, [options])`

Read a file out as a stream. Similar to fs.createReadStream.

Options include:

``` js
{
  start: optionalByteOffset, // similar to fs
  end: optionalInclusiveByteEndOffset, // similar to fs
  length: optionalByteLength
}
```

#### `drive.readFile(name, [options], callback)`

Read an entire file into memory. Similar to fs.readFile.

Options can either be an object or a string

Options include:
```js
{
  encoding: string
}
```
or a string can be passed as options to simply set the encoding - similar to fs.

#### `var stream = drive.createWriteStream(name, [options])`

Write a file as a stream. Similar to fs.createWriteStream.
If `options.cached` is set to `true`, this function returns results only if they have already been downloaded.
`options.metadata` is optionally an object with string keys and buffer objects to set metadata on the file entry.

#### `drive.writeFile(name, buffer, [options], [callback])`

Write a file from a single buffer. Similar to fs.writeFile.

#### `drive.unlink(name, [callback])`

Unlinks (deletes) a file. Similar to fs.unlink.

#### `drive.mkdir(name, [options], [callback])`

Explictly create an directory. Similar to fs.mkdir

#### `drive.rmdir(name, [callback])`

Delete an empty directory. Similar to fs.rmdir.

#### `drive.readdir(name, [options], [callback])`

Lists a directory. Similar to fs.readdir.

Options include:

``` js
{
    recursive: false, // Recurse into subdirectories and mounts
    noMount: false // Do not recurse into mounts when recursive: true
}
```

#### `drive.stat(name, [options], callback)`

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
  linkname: undefined 
}
```

The stat may include a metadata object (string keys, buffer values) with metadata that was passed into `writeFile` or `createWriteStream`.

The output object includes methods similar to fs.stat:

``` js
var stat = drive.stat('/hello.txt')
stat.isDirectory()
stat.isFile()
stat.isSymlink()
```

Options include:
```js
{
  wait: true|false // default: true
}
```

If `wait` is set to `true`, this function will wait for data to be downloaded. If false, will return an error.

#### `drive.lstat(name, [options], callback)`

Stat an entry but do not follow symlinks. Similar to fs.lstat.

Options include:
```js
{
  wait: true|false // default: true
}
```

If `wait` is set to `true`, this function will wait for data to be downloaded. If false, will return an error.

#### `drive.access(name, [options], callback)`

Similar to fs.access.

Options include:
```js
{
  wait: true|false // default: true
}
```

If `wait` is set to `true`, this function will wait for data to be downloaded. If false, will return an error.

### File Descriptors
If you want more control over your reads and writes, you can open file descriptors. The file descriptor API mirrors Node's descriptors. Importantly, Hyperdrive does not currently handle random-access writes. Similarly, appends require the previous contents of the file to be duplicated, though this all happens internally. Random-access reads, on the other hand, are fully supported and very fast.

We're still investigating more performant solutions to random-access write and appends, and it's high on our priority list! 

#### `drive.open(name, flags, callback)`

Open a file and get a file descriptor back. Similar to fs.open.

Note that currently only read mode is supported in this API.

#### `drive.read(fd, buf, offset, len, position, callback)`

Read from a file descriptor into a buffer. Similar to fs.read.

#### `drive.write(fd, buf, offset, len, pos, cb)`

Write from a buffer into a file descriptor. Similar to fs.write.

#### `drive.symlink(target, linkname, cb)`

Create a symlink from `linkname` to `target`.

### Hyperdrive Mounting
Hyperdrive supports "mounting" other Hyperdrives at paths within a parent drive. This means that if your friend has a photo album drive, you can nest their drive within your own by calling `myDrive.mount('photos/my-friends-album', <my-friends-album-key>)`.

This feature is useful for composing larger collections out of smaller shareable units, or for aggregating content from many users into one aggregate drive. One pattern you might want to try is a "group" where each user has a structured drive with standard directory names within a parent (i.e. `my-group/userA/docs`, `my-group/userB/docs`). Using this pattern, it's easy to aggregate all "docs" with a recursive readdir over the group.

#### `drive.mount(name, key, opts, cb)`

Mounts another Hyperdrive at the specified mountpoint.

If a `version` is specified in the options, then the mountpoint will reference a static checkout (it will never update).

Options include:
```js
{
  version: (drive version) // The drive version to checkout.
}
```

#### `drive.unmount(name, cb)`

Unmount a previously-mounted Hyperdrive.

#### `drive.createMountStream(opts)`

Create a stream containing content/metadata feeds for all mounted Hyperdrives. Each entry in the stream has the form:
```js
{
  path: '/',                // The mountpoint
  metadata: Hypercore(...), // The mounted metadata feed
  content: Hypercore(...)   // The mounted content feed
}
```

#### `drive.getAllMounts(opts, cb)`

Returns a Map of the content/metadata feeds for all mounted Hyperdrives, keyed by their mountpoints. The results will always include the top-level feeds (with key '/').

Options include:
```js
{
  memory: true|false // Only list drives currently cached in memory (default: false).
}
```

### Closing

#### `drive.close(fd, [callback])`

Close a file. Similar to fs.close.

#### `drive.close([callback])`

Closes all open resources used by the drive.
The drive should no longer be used after calling this.

#### `archive.destroyStorage([callback])`

Destroys the data stored in the archive and closes it.
Does not affect mounted archives.
The archive should no longer be used after calling this.

### License

MIT
