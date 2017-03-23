![https://media.giphy.com/media/5mBE2MiMVFITS/giphy.gif](https://media.giphy.com/media/5mBE2MiMVFITS/giphy.gif)

(WIP)

## API

#### `var drive = hyperdrive(storage, [key], [options])`

Create an new hyperdrive. Storage should be a function or a string.

If storage is a string content will be stored inside that folder.

If storage is a function it is called with a string name for each abstract-random-access instance that is needed
to storage the drive.

#### `var stream = drive.replicate([options])`

Replicate this drive. Options include

``` js
{
  live: false // keep replicating
}
```

#### `drive.version`

Get the current version of the drive (incrementing number).

#### `drive.key`

The public key identifying the drive.

#### `drive.discoveryKey`

A key derived from the public key that can be used to discovery other peers sharing this drive.

#### `drive.on('ready')`

Emitted when the drive is fully ready and all properties has been populated.

#### `drive.on('error', err)`

Emitted when a critical error during load happened.

#### `var oldDrive = drive.checkout(version)`

Checkout a readonly copy of the drive at an old version.

#### `var stream = drive.history([options])`

Get a stream of all changes and their versions from this drive.

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

#### `drive.readFile(name, [encoding], callback)`

Read an entire file into memory. Similar to fs.readFile.

#### `var stream = drive.createWriteStream(name)`

Write a file as a stream. Similar to fs.createWriteStream.

#### `drive.writeFile(name, buffer, [callback])`

Write a file from a single buffer. Similar to fs.writeFile.

#### `drive.unlink(name, [callback])`

Unlinks (deletes) a file. Similar to fs.unlink.

#### `drive.readdir(name, [callback])`

Lists a directory. Similar to fs.readdir.

#### `drive.stat(name, callback)`

Stat an entry. Similar to fs.stat.

#### `drive.access(name, callback)`

Similar to fs.access
