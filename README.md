# Hyperdrive

[See API docs at docs.holepunch.to](https://docs.holepunch.to/building-blocks/hyperdrive)

Hyperdrive is a secure, real-time distributed file system

## Install

```sh
npm install hyperdrive@next
```

## Usage

```js
const Hyperdrive = require('hyperdrive')
const Corestore = require('corestore')

const store = new Corestore('./storage')
const drive = new Hyperdrive(store)

await drive.put('/blob.txt', Buffer.from('example'))
await drive.put('/images/logo.png', Buffer.from('..'))
await drive.put('/images/old-logo.png', Buffer.from('..'))

const buffer = await drive.get('/blob.txt')
console.log(buffer) // => <Buffer ..> "example"

const entry = await drive.entry('/blob.txt')
console.log(entry) // => { seq, key, value: { executable, linkname, blob, metadata } }

await drive.del('/images/old-logo.png')

await drive.symlink('/images/logo.shortcut', '/images/logo.png')

for await (const file of drive.list('/images')) {
  console.log('list', file) // => { key, value }
}

const rs = drive.createReadStream('/blob.txt')
for await (const chunk of rs) {
  console.log('rs', chunk) // => <Buffer ..>
}

const ws = drive.createWriteStream('/blob.txt')
ws.write('new example')
ws.end()
ws.once('close', () => console.log('file saved'))
```

## API

#### `const drive = new Hyperdrive(store, [key])`

Creates a new Hyperdrive instance. `store` must be an instance of `Corestore`.

By default it uses the core at `{ name: 'db' }` from `store`, unless you set the public `key`.

#### `await drive.ready()`

Waits until internal state is loaded.

Use it once before reading synchronous properties like `drive.discoveryKey`, unless you called any of the other APIs.

#### `await drive.close()`

Fully close this drive, including its underlying Hypercore backed datastructures.

#### `drive.corestore`

The Corestore instance used as storage.

#### `drive.db`

The underlying Hyperbee backing the drive file structure.

#### `drive.core`

The Hypercore used for `drive.db`.

#### `drive.key`

The public key of the Hypercore backing the drive.

#### `drive.discoveryKey`

The hash of the public key of the Hypercore backing the drive.

Can be used as a `topic` to seed the drive using Hyperswarm.

#### `drive.contentKey`

The public key of the [Hyperblobs](https://github.com/holepunchto/hyperblobs) instance holding blobs associated with entries in the drive.

#### `drive.version`

Number that indicates how many modifications were made, useful as a version identifier.

#### `drive.supportsMetadata`

Boolean indicating if the drive handles or not metadata. Always `true`.

#### `await drive.put(path, buffer, [options])`

Creates a file at `path` in the drive. `options` are the same as in `createWriteStream`.

#### `const buffer = await drive.get(path)`

Returns the blob at `path` in the drive. If no blob exists, returns `null`.

It also returns `null` for symbolic links.

#### `const entry = await drive.entry(path)`

Returns the entry at `path` in the drive. It looks like this:
```js
{
  seq: Number,
  key: String,
  value: {
    executable: Boolean, // Whether the blob at path is an executable
    linkname: null, // If entry not symlink, otherwise a string to the entry this links to
    blob: { // Hyperblobs id that can be used to fetch the blob associated with this entry
      blockOffset: Number,
      blockLength: Number,
      byteOffset: Number,
      byteLength: Number
    },
    metadata: null
  }
}
```

#### `await drive.del(path)`

Deletes the file at `path` from the drive.

#### `await drive.clear(path)`

Deletes the blob from storage to free up space, but the file structure reference is kept.

#### `await drive.symlink(path, linkname)`

Creates an entry in drive at `path` that points to the entry at `linkname`.

If a blob entry currently exists at `path` then it will get overwritten and `drive.get(key)` will return `null`, while `drive.entry(key)` will return the entry with symlink information.

#### `const batch = drive.batch()`

Useful for atomically mutate the drive, has the same interface as Hyperdrive.

#### `await batch.flush()`

Commit a batch of mutations to the underlying drive.

#### `const stream = drive.list(folder, [options])`

Returns a stream of all entries in the drive at paths prefixed with `folder`.

`options` include:
```js
{
  recursive: true | false // Whether to descend into all subfolders or not
}
```

#### `const stream = drive.readdir(folder)`

Returns a stream of all subpaths of entries in drive stored at paths prefixed by `folder`.

#### `const stream = await drive.entries([options])`

Returns a read stream of entries in the drive.

`options` are the same as the `options` to `Hyperbee().createReadStream(options)`.

#### `const mirror = drive.mirror(out, [options])`

Efficiently mirror this drive into another. Returns a [`MirrorDrive`](https://github.com/holepunchto/mirror-drive#api) instance constructed with `options`.

Call `await mirror.done()` to wait for the mirroring to finish.

#### `const rs = drive.createReadStream(path, [options])`

Returns a stream to read out the blob stored in the drive at `path`.

`options` include:
```js
{
  start: Number, // `start` and `end` are inclusive
  end: Number,
  length: Number, // `length` overrides `end`, they're not meant to be used together
  wait: true, // Wait for blocks to be downloaded
  timeout: 0 // Wait at max some milliseconds (0 means no timeout)
}
```

#### `const ws = drive.createWriteStream(path, [options])`

Stream a blob into the drive at `path`.

`options` include:
```js
{
  executable: Boolean,
  metadata: null // Extended file information i.e. arbitrary JSON value
}
```

#### `await drive.download(folder, [options])`

Downloads the blobs corresponding to all entries in the drive at paths prefixed with `folder`.

`options` are the same as those for `drive.list(folder, [options])`.

#### `const snapshot = drive.checkout(version)`

Get a read-only snapshot of a previous version.

#### `const stream = drive.diff(version, folder, [options])`

Efficiently create a stream of the shallow changes to `folder` between `version` and `drive.version`.

Each entry is sorted by key and looks like this:
```js
{
  left: Object, // Entry in folder at drive.version for some path
  right: Object, // Entry in folder at drive.checkout(version) for some path
}
```

If an entry exists in `drive.version` of the `folder` but not in `version`, then `left` is set and `right` will be `null`, and vice versa.

#### `await drive.downloadDiff(version, folder, [options])`

Downloads all the blobs in `folder` corresponding to entries in `drive.checkout(version)` that are not in `drive.version`.

In other words, downloads all the blobs added to `folder` up to `version` of the drive.

#### `await drive.downloadRange(dbRanges, blobRanges)`

Downloads the entries and blobs stored in the [ranges][core-range-docs] `dbRanges` and `blobRanges`.

#### `const done = drive.corestore.findingPeers()`

Indicate to Hyperdrive that you're finding peers in the background, requests will be on hold until this is done.

Call `done()` when your current discovery iteration is done, i.e. after `swarm.flush()` finishes.

#### `const stream = drive.corestore.replicate(isInitiatorOrStream)`

Usage example:
```js
const swarm = new Hyperswarm()
const done = drive.corestore.findingPeers()
swarm.on('connection', (socket) => drive.corestore.replicate(socket))
swarm.join(drive.discoveryKey)
swarm.flush().then(done, done)
```

See more about how replicate works at [corestore.replicate][store-replicate-docs].

#### `const updated = await drive.update([options])`

Waits for initial proof of the new drive version until all `findingPeers` are done.

`options` include:
```js
{
  wait: false
}
```

Use `drive.corestore.findingPeers()` or `{ wait: true }` to make await `drive.update()` blocking.

#### `const blobs = await drive.getBlobs()`

Returns the [Hyperblobs](https://github.com/holepunchto/hyperblobs) instance storing the blobs indexed by drive entries.

```js
await drive.put('/file.txt', Buffer.from('hi'))

const buffer1 = await drive.get('/file.txt')

const blobs = await drive.getBlobs()
const entry = await drive.entry('/file.txt')
const buffer2 = await blobs.get(entry.value.blob)

// => buffer1 and buffer2 are equals
```

[core-range-docs]: https://github.com/holepunchto/hypercore#const-range--coredownloadrange
[store-replicate-docs]: https://github.com/holepunchto/corestore#const-stream--storereplicateoptsorstream
