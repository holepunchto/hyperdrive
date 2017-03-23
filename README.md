![https://media.giphy.com/media/5mBE2MiMVFITS/giphy.gif](https://media.giphy.com/media/5mBE2MiMVFITS/giphy.gif)

(WIP)

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

#### `archive.mkdir(name, [options], [callback]).

Explictly create an directory. Similar to fs.mkdir

#### `archive.readdir(name, [callback])`

Lists a directory. Similar to fs.readdir.

#### `archive.stat(name, callback)`

Stat an entry. Similar to fs.stat.

#### `archive.access(name, callback)`

Similar to fs.access
