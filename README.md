# Hyperdrive

[See API docs at docs.holepunch.to](https://docs.holepunch.to/building-blocks/hyperdrive)

Hyperdrive is a secure, real-time distributed file system

## Install

```sh
npm install hyperdrive@next
```

Note this is the Hyperdrive 11 preview based on Hypercore 10

## Usage

```js
const Hyperdrive = require('hyperdrive')
const Corestore = require('corestore')

const corestore = new Corestore('storage')

const drive = new Hyperdrive(corestore, /* optionalKey */)

const ws = drive.createWriteStream('/blob.txt')

ws.write('Hello, ')
ws.write('world!')
ws.end()

ws.on('close', function () {
  const rs = drive.createReadStream('/blob.txt')
  rs.pipe(process.stdout) // prints Hello, world!
})
```

## API

#### `const drive = new Hyperdrive(corestore, [key])`

Creates a new Hyperdrive instance.

`corestore` must be an instance of `Corestore`.

`key` should be a Hypercore public key. If you do not set this, Hyperdrive will use the core at `{ name: 'db' }` in the passed Corestore instance.

#### `await drive.ready()`

Wait for the drive to fully open. In general, you do **NOT** need to wait for `ready` unless checking a synchronous property on `drive` since internals `await` this themselves.

#### `const buffer = await drive.get(path)`

Returns the blob at `path` in the drive. Internally, Hyperdrive contains a metadata index of entries that "point" to offsets in a `Hyperblobs` instance. Blobs themselves are accessible via `drive.get(path)`, whereas entries are accessible via `drive.entry(path)`. If no blob exists at `path`, returns `null`.

#### `const stream = drive.createReadStream(path, options)`

Returns a stream that can be used to read out the blob stored in the drive at `path`.

`options` are the same as the `options` to `Hyperblobs().createReadStream(path, options)`.

#### `const entry = await drive.entry(path)`

Returns the entry at `path` in the drive. An entry holds metadata about a `path`, currently:

```js
{
  seq: Number,
  key: String,
  value: {
    executable: Boolean, // whether the blob at path is an executable
    linkname: null // if entry not symlink, otherwise a string to the entry this links to
    blob: { // a Hyperblob id that can be used to fetch the blob associated with this entry
      blockOffset: Number,
      blockLength: Number,
      byteOffset: Number,
      byteLength: Number
    },
    metadata: null
  }
}
```

#### `await drive.symlink(path, linkname)`

Creates an entry in drive at `path` that points to the entry at `linkname`. Note, if a blob entry currently exists at `path` then `drive.symlink(path, linkname)` will overwrite the entry and `drive.get(path)` will return `null`, while `drive.entry(path)` will return the entry with symlink information.

#### `const hyperblobs = await drive.getBlobs()`

Returns the hyperblobs instance storing the blobs indexed by drive entries.

```js
const fs = require('fs')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')

const drive = new Hyperdrive(new Corestore('storage'))

await drive.put(__filename, fs.readFileSync(__filename))
const bufFromGet = await drive.get(__filename)

const { value: entry } = await drive.entry(__filename)
const blobs = await drive.getBlobs()
const bufFromEntry = blobs.get(entry.blob)

console.log(Buffer.compare(bufFromGet, bufFromEntry)) // prints 0
```

#### `const stream = await drive.entries([options])`

Returns a read stream of entries in the drive.

`options` are the same as the `options` to `Hyperbee().createReadStream(options)`.

#### `await drive.put(path, blob, [options])`

Sets the `blob` in the drive at `path`.

`path` should be a `utf8` string.
`blob` should be a `Buffer`.

`options` includes:

```js
{
  executable: true | false // whether the blob is executable or not
}
```

#### `ws = drive.createWriteStream(path, [options])`

Stream a blob into the drive at `path`. Options include

```js
{
  executable: true | false // whether the blob is executable or not
}
```

#### `await drive.del(path)`

Removes the `entry` at `path` from the drive. If a blob corresponding to the entry at `path` exists, it is not currently deleted.

#### `await drive.clear(path)`

Deletes the blob containing the content of the `entry` at `path` from the underlying storage, but leaves the entry itself be (so the entry still exists in the database, but its content does not exist locally anymore). Note that this is a destructive operation which also affects checkouts taken at a time before calling it.

#### `const hypercore = drive.core`

The underlying Hypercore backing the drive.

#### `const buffer = drive.key`

The public key of the Hypercore backing the drive.

#### `const buffer = drive.discoveryKey`

The hash of the public key of the Hypercore backing the drive, can be used to seed the drive using Hyperswarm.

#### `const buffer = drive.contentKey`

The public key of the Hyperblobs instance holding blobs associated with entries in the drive.

#### `const integer = drive.version`

The version (offset in the underlying Hypercore) of the drive.

#### `const Hyperdrive = drive.checkout(version)`

Checks out a read-only snapshot of a Hyperdrive at a particular version.

```js
const fs = require('fs')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')

const drive = new Hyperdrive(new Corestore('storage'))

await drive.put('/fst-file.txt', fs.readFileSync('fst-file.txt'))

const version = drive.version

await drive.put('/snd-file.txt', fs.readFileSync('snd-file.txt'))

const snapshot = drive.checkout(version)

console.log(await drive.get('/snd-file.txt')) // prints Buffer
console.log(await snapshot.get('/snd-file.txt')) // prints null
console.log(Buffer.compare(await drive.get('/fst-file.txt'), await snapshot.get('/fst-file.txt'))) // prints 0
```

#### `const stream = drive.diff(version, folder, [options])`
Efficiently create a stream of the shallow changes to `folder` between `version` and `drive.version`. Each entry is sorted by key and looks like this:

```
{
  left: <the entry in folder at drive.version for some path>,
  right: <the entry in folder at drive.checkout(version) for some path>
}
```

If an entry exists in `drive.version` of the `folder` but not in `version`, then left is set and right will be null, and vice versa.

#### `await drive.downloadDiff(version, folder, [options])`

Downloads all the blobs in `folder` corresponding to entries in `drive.checkout(version)` that are not in `drive.version`. In other words, downloads all the blobs added to `folder` up to `version` of the drive.

#### `await drive.downloadRange(dbRanges, blobRanges)`

Downloads the entries and blobs stored in the [ranges][core-range-docs] `dbRanges` and `blobRanges`.

#### `const stream = drive.list(folder, [options])`

Returns a stream of all entries in the drive at paths prefixed with `folder`. Options include:

```js
{
  recursive: true | false // whether to descend into all subfolders or not
}
```

#### `await drive.download(folder, [options])`

Downloads the blobs corresponding to all entries in the drive at paths prefixed with `folder`. Options are the same as those for `drive.list(folder, [options])`.

#### `const stream = drive.readdir(folder)`

Returns a stream of all subpaths of entries in drive stored at paths prefixed by `folder`.

```js
await drive.put('/parent/child', Buffer.from('child'))
await drive.put('/parent/sibling', Buffer.from('sibling'))
for await (const path of drive.readdir('/parent')) console.log(path) // prints "child", then prints "sibling"
```

#### `const mirror = drive.mirror(out, [options])`

Efficiently mirror this drive into another. Returns a [`MirrorDrive`](https://github.com/holepunchto/mirror-drive#api) instance constructed with `options`.

Call `await mirror.done()` to wait for the mirroring to finish.

#### `const batch = drive.batch()`

Atomically mutate the drive, has the same interface as Hyperdrive.

#### `await batch.flush()`

Atomically commit a batch of mutations to the underlying drive.

#### `await drive.close()`

Close the drive and its underlying Hypercore backed datastructures.


[core-range-docs]: https://github.com/holepunchto/hypercore#const-range--coredownloadrange
