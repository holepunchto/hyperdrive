const fs = require('fs')
const os = require('os')
const path = require('path')
const { once } = require('events')
const test = require('brittle')
const Corestore = require('corestore')
const ram = require('random-access-memory')
const { discoveryKey } = require('hypercore-crypto')
const { pipelinePromise: pipeline, Writable, Readable } = require('streamx')
const testnet = require('@hyperswarm/testnet')
const DHT = require('hyperdht')
const Hyperswarm = require('hyperswarm')
const b4a = require('b4a')

const Hyperdrive = require('./index.js')

test('drive.core', async (t) => {
  const { drive } = await testenv(t.teardown)
  t.is(drive.db.feed, drive.core)
})

test('drive.version', async (t) => {
  const { drive } = await testenv(t.teardown)
  await drive.put(__filename, fs.readFileSync(__filename))
  t.is(drive.db.feed.length, drive.version)
})

test('drive.key', async (t) => {
  const { drive } = await testenv(t.teardown)
  t.is(b4a.compare(drive.db.feed.key, drive.key), 0)
})

test('drive.discoveryKey', async (t) => {
  const { drive } = await testenv(t.teardown)
  t.is(b4a.compare(drive.discoveryKey, discoveryKey(drive.key)), 0)
})

test('drive.contentKey', async (t) => {
  const { drive } = await testenv(t.teardown)
  t.is(b4a.compare(drive.blobs.core.key, drive.contentKey), 0)
})

test('drive.getBlobs()', async (t) => {
  const { drive } = await testenv(t.teardown)
  const blobs = await drive.getBlobs()
  t.is(blobs, drive.blobs)
})

test('drive.supportsMetadata', async (t) => {
  const { drive } = await testenv(t.teardown)
  t.is(true, drive.supportsMetadata)
})

test('Hyperdrive(corestore, key)', async (t) => {
  t.plan(2)
  const { corestore, drive } = await testenv(t.teardown)
  const diskbuf = fs.readFileSync(__filename)
  await drive.put(__filename, diskbuf)
  const bndlbuf = await drive.get(__filename)
  t.is(b4a.compare(diskbuf, bndlbuf), 0)
  const mirror = new Hyperdrive(corestore, drive.core.key)
  await mirror.ready()
  const mrrrbuf = await mirror.get(__filename)
  t.is(b4a.compare(bndlbuf, mrrrbuf), 0)
})

test('drive.put(path, buf) and drive.get(path)', async (t) => {
  {
    const { drive } = await testenv(t.teardown)
    const diskbuf = fs.readFileSync(__filename)
    await drive.put(__filename, diskbuf)
    const bndlbuf = await drive.get(__filename)
    t.is(b4a.compare(diskbuf, bndlbuf), 0)
  }

  {
    const { drive } = await testenv(t.teardown)
    const tmppath = path.join(os.tmpdir(), 'hyperdrive-test-')
    const dirpath = fs.mkdtempSync(tmppath)
    const filepath = path.join(dirpath, 'hello-world.js')
    const bndlbuf = b4a.from('module.exports = () => \'Hello, World!\'')
    await drive.put(filepath, bndlbuf)
    fs.writeFileSync(filepath, await drive.get(filepath))
    const diskbuf = fs.readFileSync(filepath)
    t.is(b4a.compare(diskbuf, bndlbuf), 0)
    t.is(require(filepath)(), 'Hello, World!')
  }
})

test('drive.createWriteStream(path) and drive.createReadStream(path)', async (t) => {
  {
    const { drive } = await testenv(t.teardown)
    const diskbuf = await fs.readFileSync(__filename)
    await pipeline(
      fs.createReadStream(__filename),
      drive.createWriteStream(__filename)
    )
    let bndlbuf = null
    await pipeline(
      drive.createReadStream(__filename),
      new Writable({
        write (data, cb) {
          if (bndlbuf) bndlbuf = b4a.concat(bndlbuf, data)
          else bndlbuf = data
          return cb(null)
        }
      })
    )
    t.is(b4a.compare(diskbuf, bndlbuf), 0)
  }

  {
    const { drive } = await testenv(t.teardown)
    const tmppath = path.join(os.tmpdir(), 'hyperdrive-test-')
    const dirpath = fs.mkdtempSync(tmppath)
    const filepath = path.join(dirpath, 'hello-world.js')
    const bndlbuf = b4a.from('module.exports = () => \'Hello, World!\'')
    await pipeline(
      Readable.from(bndlbuf),
      drive.createWriteStream(filepath)
    )
    await pipeline(
      drive.createReadStream(filepath),
      fs.createWriteStream(filepath)
    )
    const diskbuf = fs.readFileSync(filepath)
    t.is(b4a.compare(diskbuf, bndlbuf), 0)
    t.is(require(filepath)(), 'Hello, World!')
  }
})

test('drive.createReadStream() with start/end options', async (t) => {
  const { drive, paths } = await testenv(t.teardown)
  const filepath = path.join(paths.tmp, 'hello-world.js')
  const bndlbuf = b4a.from('module.exports = () => \'Hello, World!\'')
  await pipeline(
    Readable.from(bndlbuf),
    drive.createWriteStream(filepath)
  )

  const stream = drive.createReadStream(filepath, {
    start: 0,
    end: 0
  })
  const drivebuf = await streamToBuffer(stream)
  t.is(drivebuf.length, 1)
  t.is(drivebuf.toString(), 'm')

  const stream2 = drive.createReadStream(filepath, {
    start: 5,
    end: 7
  })
  const drivebuf2 = await streamToBuffer(stream2)
  t.is(drivebuf2.length, 3)
  t.is(drivebuf2.toString(), 'e.e')
})

test('drive.del() deletes entry at path', async (t) => {
  t.plan(3)
  const { drive } = await testenv(t.teardown)
  await drive.put(__filename, fs.readFileSync(__filename))
  let buf = await drive.get(__filename)
  t.ok(b4a.isBuffer(buf))
  await drive.del(__filename)
  buf = await drive.get(__filename)
  t.is(buf, null)
  const entry = await drive.entry(__filename)
  t.is(entry, null)
})

test('drive.symlink(from, to) updates the entry at <from> to include a reference for <to>', async (t) => {
  const { drive } = await testenv(t.teardown)
  const buf = fs.readFileSync(__filename)
  await drive.put(__filename, buf)
  await drive.symlink('pointer', __filename)
  const result = await drive.get('pointer')
  t.is(result, null)
  const entry = await drive.entry('pointer')
  t.is(entry.value.linkname, __filename)
  t.is(b4a.compare(buf, await drive.get(entry.value.linkname)), 0)
})

test('drive.entry(path) gets entry at path', async (t) => {
  const linkname = 'linkname'

  {
    const { drive } = await testenv(t.teardown)
    const buf = fs.readFileSync(__filename)
    await drive.put(__filename, buf)
    const { value: entry } = await drive.entry(__filename)
    t.ok(entry.blob)
    t.is(entry.linkname, null)
    t.is(entry.executable, false)
  }

  {
    const { drive } = await testenv(t.teardown)
    const buf = fs.readFileSync(__filename)
    await drive.put(__filename, buf, { executable: false })
    const { value: entry } = await drive.entry(__filename)
    t.ok(entry.blob)
    t.is(entry.linkname, null)
    t.is(entry.executable, false)
  }

  {
    const { drive } = await testenv(t.teardown)
    const buf = fs.readFileSync(__filename)
    await drive.put(__filename, buf, { executable: true })
    const { value: entry } = await drive.entry(__filename)
    t.ok(entry.blob)
    t.is(entry.linkname, null)
    t.is(entry.executable, true)
  }

  {
    const { drive } = await testenv(t.teardown)
    const buf = fs.readFileSync(__filename)
    await drive.put(__filename, buf, { executable: false })
    await drive.symlink(__filename, linkname)
    const { value: entry } = await drive.entry(__filename)
    t.is(entry.blob, null)
    t.is(entry.executable, false)
    t.is(entry.linkname, linkname)
  }

  {
    const { drive } = await testenv(t.teardown)
    const buf = fs.readFileSync(__filename)
    await drive.put(__filename, buf, { executable: true })
    await drive.symlink(__filename, linkname)
    const { value: entry } = await drive.entry(__filename)
    t.is(entry.blob, null)
    t.is(entry.executable, false)
    t.is(entry.linkname, linkname)
  }

  {
    const { drive } = await testenv(t.teardown)
    await drive.symlink(linkname, __filename)
    const { value: entry } = await drive.entry(linkname)
    t.is(entry.blob, null)
    t.is(entry.executable, false)
    t.is(entry.linkname, __filename)
  }

  {
    const { drive } = await testenv(t.teardown)
    const ws = drive.createWriteStream(__filename)
    ws.write(fs.readFileSync(__filename))
    ws.end()
    await once(ws, 'finish')
    const { value: entry } = await drive.entry(__filename)
    t.ok(entry.blob)
    t.is(entry.linkname, null)
    t.is(entry.executable, false)
  }

  {
    const { drive } = await testenv(t.teardown)
    const ws = drive.createWriteStream(__filename, { executable: false })
    ws.write(fs.readFileSync(__filename))
    ws.end()
    await once(ws, 'finish')
    const { value: entry } = await drive.entry(__filename)
    t.ok(entry.blob)
    t.is(entry.linkname, null)
    t.is(entry.executable, false)
  }

  {
    const { drive } = await testenv(t.teardown)
    const ws = drive.createWriteStream(__filename, { executable: true })
    ws.write(fs.readFileSync(__filename))
    ws.end()
    await once(ws, 'finish')
    const { value: entry } = await drive.entry(__filename)
    t.ok(entry.blob)
    t.is(entry.linkname, null)
    t.is(entry.executable, true)
  }
})

test('entry(key) resolve key path', async function (t) {
  const { drive } = await testenv(t.teardown)

  await drive.put('/README.md', b4a.from('# title'))
  await drive.put('/examples/a.txt', b4a.from('a text'))
  await drive.put('/examples/more/c.txt', b4a.from('c text'))

  t.alike((await drive.entry('README.md')).key, '/README.md')
  t.alike((await drive.entry('/examples/more/../a.txt')).key, '/examples/a.txt')
  t.alike((await drive.entry('\\examples\\more\\c.txt')).key, '/examples/more/c.txt')
})

test('get(key) resolve key path', async function (t) {
  const { drive } = await testenv(t.teardown)

  await drive.put('/README.md', b4a.from('# title'))
  await drive.put('/examples/a.txt', b4a.from('a text'))
  await drive.put('/examples/more/c.txt', b4a.from('c text'))

  const buffer = await drive.get('/README.md')
  const a = await drive.get('/examples/a.txt')
  const c = await drive.get('/examples/more/c.txt')
  t.ok(buffer)
  t.ok(a)
  t.ok(c)

  t.alike(await drive.get('README.md'), buffer)
  t.alike(await drive.get('/examples/more/../a.txt'), a)
  t.alike(await drive.get('\\examples\\more\\c.txt'), c)
})

test('del(key) resolve key path', async function (t) {
  const { drive } = await testenv(t.teardown)

  const delAndEntry = async (key, expectedKey) => {
    await drive.put(expectedKey, b4a.from('')) // pre-create

    t.ok(await drive.entry(expectedKey))
    await drive.del(key)
    t.absent(await drive.entry(expectedKey))
  }

  await delAndEntry('README.md', '/README.md')
  await delAndEntry('/examples/more/../a.txt', '/examples/a.txt')
  await delAndEntry('\\examples\\more\\c.txt', '/examples/more/c.txt')
})

test('put(key, buffer) resolve key path', async function (t) {
  const { drive } = await testenv(t.teardown)

  const putAndEntry = async (key, expectedKey) => {
    t.absent(await drive.entry(expectedKey))
    await drive.put(key, b4a.from(''))
    t.ok(await drive.entry(expectedKey))
  }

  await putAndEntry('b.txt', '/b.txt')
  await putAndEntry('/examples/more/../f.txt', '/examples/f.txt')
  await putAndEntry('\\examples\\more\\h.txt', '/examples/more/h.txt')
})

test('symlink(key, linkname) resolve key path', async function (t) {
  const { drive } = await testenv(t.teardown)

  await drive.put('/README.md', b4a.from('# title'))

  const symlinkAndEntry = async (key, expectedKey) => {
    t.absent(await drive.entry(expectedKey))
    await drive.symlink(key, '/README.md')
    t.ok(await drive.entry(expectedKey))
  }

  await symlinkAndEntry('b.txt', '/b.txt')
  await symlinkAndEntry('/examples/more/../f.txt', '/examples/f.txt')
  await symlinkAndEntry('\\examples\\more\\h.txt', '/examples/more/h.txt')
})

test('drive.diff(length)', async (t) => {
  const { drive, paths: { root, tmp } } = await testenv(t.teardown)
  const paths = []

  for await (const _path of readdirator(root, { filter })) {
    const buf = fs.readFileSync(_path)
    const relpath = _path.replace(root, '')
    const tmppath = path.join(tmp, relpath)
    try {
      fs.writeFileSync(tmppath, buf)
    } catch {
      fs.mkdirSync(path.dirname(tmppath), { recursive: true })
      fs.writeFileSync(tmppath, buf)
    }
    await drive.put(relpath, buf)
    paths.push([tmppath, relpath])
  }

  const [tmppath, relpath] = paths[Math.floor(Math.random() * paths.length)]
  await drive.put(relpath + '.old', fs.readFileSync(tmppath))
  await drive.del(relpath)

  for await (const diff of drive.diff(drive.core.length - 2)) {
    if (diff.right) t.is(diff.right.key, relpath.replace(/\\/g, '/'))
    if (diff.left) t.is(diff.left.key, relpath.replace(/\\/g, '/') + '.old')
  }
})

test('drive.entries()', async (t) => {
  const { drive, paths: { root } } = await testenv(t.teardown)
  const entries = new Set()

  for await (const path of readdirator(root, { filter })) {
    await drive.put(path, fs.readFileSync(path))
    entries.add(await drive.entry(path))
  }

  for await (const entry of drive.entries()) {
    for (const _entry of entries) {
      if (JSON.stringify(_entry) === JSON.stringify(entry)) {
        entries.delete(_entry)
        break
      }
    }
  }

  t.is(entries.size, 0)
})

test('drive.list(folder, { recursive })', async (t) => {
  {
    const { drive, paths: { root } } = await testenv(t.teardown)
    for await (const path of readdirator(root, { filter })) {
      await drive.put(path, fs.readFileSync(path))
    }
    for await (const entry of drive.list(root)) {
      t.is(b4a.compare(fs.readFileSync(entry.key), await drive.get(entry.key)), 0)
    }
  }

  {
    const { drive, paths: { root } } = await testenv(t.teardown)
    for await (const path of readdirator(root, { filter })) {
      await drive.put(path, fs.readFileSync(path))
    }
    for await (const entry of drive.list(root, { recursive: true })) {
      t.is(b4a.compare(fs.readFileSync(entry.key), await drive.get(entry.key)), 0)
    }
  }

  {
    const { drive, paths: { root } } = await testenv(t.teardown)
    for await (const path of readdirator(root, { filter })) {
      await drive.put(path, fs.readFileSync(path))
    }
    for await (const entry of drive.list(root, { recursive: false })) {
      t.is(b4a.compare(fs.readFileSync(entry.key), await drive.get(entry.key)), 0)
    }
  }

  {
    const { drive } = await testenv(t.teardown)
    const emptybuf = b4a.from('')
    await drive.put('/', emptybuf)
    await drive.put('/grandparent', emptybuf)
    await drive.put('/grandparent/parent', emptybuf)
    await drive.put('/grandparent/parent/child', emptybuf)
    await drive.put('/grandparent/parent/child/fst-grandchild.file', emptybuf)
    await drive.put('/grandparent/parent/child/snd-grandchild.file', emptybuf)

    const paths = ['/', '/grandparent', '/grandparent/parent', '/grandparent/parent/child']

    for (const [_idx, path] of Object.entries(paths)) {
      const idx = parseInt(_idx)
      const set = new Set()
      for await (const entry of drive.list(path)) set.add(entry.key)
      t.ok(paths.slice(0, idx).every((path) => !set.has(path)))
      t.ok(paths.slice(idx, paths.length).every((path) => Array.from(set).some((_path) => _path.includes(path))))
    }
  }
})

test('drive.readdir(path)', async (t) => {
  {
    const { drive, paths: { root } } = await testenv(t.teardown)
    const files = new Map()
    for await (const path of readdirator(root, { filter })) {
      const buf = fs.readFileSync(path)
      await drive.put(path, buf)
      files.set(path, buf)
    }
    const readdir = drive.readdir.bind(drive)
    const isDirectory = async (x) => !(await drive.entry(x))?.value.blob
    for await (const path of readdirator(root, { readdir, isDirectory })) {
      t.is(b4a.compare(files.get(path), await drive.get(path)), 0)
    }
  }

  {
    const { drive } = await testenv(t.teardown)
    await drive.put('/parent/child', b4a.from('child'))
    await drive.put('/parent/sibling', b4a.from('sibling'))
    await drive.put('/parent/sibling/grandchild', b4a.from('grandchild'))
    const read = []
    for await (const path of drive.readdir('/parent')) read.push(path)
    t.is(read[0], 'child')
    t.is(read[1], 'sibling')
    t.is(read.length, 2)
  }

  {
    const { drive } = await testenv(t.teardown)
    await drive.put('/parent/child', b4a.from('child'))
    await drive.put('/parent/sibling', b4a.from('sibling'))
    await drive.put('/parent/sibling/grandchild', b4a.from('grandchild'))
    const read = []
    for await (const path of drive.readdir('/parent/sibling')) read.push(path)
    t.is(read[0], 'grandchild')
    t.is(read.length, 1)
  }
})

test('drive.checkout(len)', async (t) => {
  const { drive, paths: { root } } = await testenv(t.teardown)
  const lens = new Map()
  for await (const path of readdirator(root, { filter })) {
    const buf = fs.readFileSync(path)
    await drive.put(path, buf)
    lens.set(drive.core.length, path)
  }
  for (const offset of lens.keys()) {
    const snapshot = await drive.checkout(offset)
    t.ok(snapshot.get(lens.get(offset)))
    let low = offset
    while (lens.has(--low)) t.ok(await snapshot.get(lens.get(low)))
    let high = offset
    while (lens.has(++high)) t.ok(!(await snapshot.get(lens.get(high))))
  }
})

test('drive.download(folder, [options])', async (t) => {
  t.plan(7)
  const { corestore, drive, swarm, mirror } = await testenv(t.teardown)
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  mirror.swarm.on('connection', (conn) => mirror.corestore.replicate(conn))
  mirror.swarm.join(drive.discoveryKey, { server: false, client: true })
  await mirror.swarm.flush()

  const nil = b4a.from('nil')

  let count = 0
  let max = -Infinity

  await drive.put('/parent/child/grandchild1', nil)
  await drive.put('/parent/child/grandchild2', nil)

  const blobs = await mirror.drive.getBlobs()

  blobs.core.on('download', (offset) => {
    count++
    if (max < offset) max = offset
  })

  const l = drive.blobs.core.length

  await drive.put('/parent/sibling/grandchild1', nil)

  t.is(count, 0)
  await mirror.drive.download('/parent/child')
  t.is(max, l - 1)
  const _count = count
  t.ok(await mirror.drive.get('/parent/child/grandchild1'))
  t.is(_count, count)
  t.ok(await mirror.drive.get('/parent/child/grandchild2'))
  t.is(_count, count)
  const entry = await mirror.drive.entry('/parent/sibling/grandchild1')
  await blobs.get(entry.value.blob)
  t.is(count, _count + 1)
})

test.skip('drive.downloadRange(dbRanges, blobRanges)', async (t) => {
  const { drive, swarm, mirror, corestore } = await testenv(t.teardown)
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  mirror.swarm.on('connection', (conn) => mirror.corestore.replicate(conn))
  mirror.swarm.join(drive.discoveryKey, { server: false, client: true })
  await mirror.swarm.flush()

  const blobs = await drive.getBlobs()
  const nil = b4a.from('nil')

  const fileBlocks = []
  const blobBlocks = []
  await drive.put('/0', nil)
  fileBlocks.push(drive.core.length)
  blobBlocks.push(blobs.core.length)
  await drive.put('/1', nil)
  await drive.put('/2', nil)
  fileBlocks.push(drive.core.length)
  blobBlocks.push(blobs.core.length)

  const fileTelem = downloadShark(mirror.drive.core)
  const blobTelem = downloadShark((await mirror.drive.getBlobs()).core)

  const fileCount = fileTelem.count
  const blobCount = blobTelem.count

  await mirror.drive.get('/0')
  t.is(blobCount, blobTelem.count)
  t.is(fileCount, fileTelem.count)
})

test.skip('drive.downloadDiff(version, folder, [options])', async (t) => {
  const { drive, swarm, mirror, corestore } = await testenv(t.teardown)
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  mirror.swarm.on('connection', (conn) => mirror.corestore.replicate(conn))
  mirror.swarm.join(drive.discoveryKey, { server: false, client: true })
  await mirror.swarm.flush()

  const nil = b4a.from('nil')

  await drive.put('/parent/child/0', nil)
  await drive.put('/parent/sibling/0')
  await drive.put('/parent/child/1', nil)
  const version = drive.version

  const filestelem = downloadShark(mirror.drive.core)
  const blobstelem = downloadShark((await mirror.drive.getBlobs()).core)

  await mirror.drive.downloadDiff(version, '/parent/child')

  let filescount = filestelem.count
  let blobscount = blobstelem.count

  await mirror.drive.get('/parent/child/1')

  t.is(filescount, filestelem.count)
  t.is(blobscount, blobstelem.count)

  await drive.put('/parent/child/2', nil)

  await mirror.drive.downloadDiff(version, '/parent/child')

  t.is(blobscount + 1, blobstelem.count)

  filescount = filestelem.count
  blobscount = blobstelem.count

  await mirror.drive.get('/parent/sibling/0')

  t.is(filescount + 1, filestelem.count)
  t.is(blobscount + 1, blobstelem.count)
})

test('drive.batch() & drive.flush()', async (t) => {
  const { drive } = await testenv(t.teardown)
  const batch = drive.batch()
  const nil = b4a.from('nil')
  await batch.put('/x', nil)
  t.ok(!(await drive.get('/x')))
  await batch.put('/y', nil)
  await batch.flush()
  t.ok(await drive.get('/x'))
})

test('batch.list()', async (t) => {
  const { drive } = await testenv(t.teardown)
  const nil = b4a.from('nil')
  await drive.put('/x', nil)
  const batch = drive.batch()
  for await (const entry of batch.list()) {
    t.is(entry.key, '/x')
  }
  await batch.flush()
})

test('drive.close()', async (t) => {
  t.plan(2)
  const { drive } = await testenv(t.teardown)
  const blobs = await drive.getBlobs()
  blobs.core.on('close', () => t.ok(true))
  drive.core.on('close', () => t.ok(true))
  await drive.close()
})

test('drive.close() on snapshots--does not close parent', async (t) => {
  const { drive } = await testenv(t.teardown)

  await drive.put('/foo', b4a.from('bar'))

  const checkout = drive.checkout(2)
  await checkout.get('/foo')
  await checkout.close()

  // Main test is that there is no session_closed error on drive.get
  const res = await drive.get('/foo')
  t.alike(res, b4a.from('bar'))
})

test('drive.close() for future checkout', async (t) => {
  const { drive } = await testenv(t.teardown)
  await drive.put('some', 'thing')
  const checkout = drive.checkout(drive.length + 1)
  await checkout.close()

  t.is(checkout.closed, true)
  t.is(checkout.db.core.closed, true)
  t.is(drive.closed, false)
  t.is(drive.db.core.closed, false)
})

test.skip('drive.findingPeers()', async (t) => {
  const { drive, corestore, swarm, mirror } = await testenv(t.teardown)
  await drive.put('/', b4a.from('/'))

  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  mirror.swarm.on('connection', (conn) => mirror.corestore.replicate(conn))
  mirror.swarm.join(drive.discoveryKey, { server: false, client: true })
  const done = mirror.drive.findingPeers()
  swarm.flush().then(done, done)
  t.ok(await mirror.drive.get('/'))
})

test('drive.mirror()', async (t) => {
  const { drive: a } = await testenv(t.teardown)
  const { drive: b } = await testenv(t.teardown)

  await a.put('/', 'hello world')
  await a.mirror(b).done()

  t.alike(await b.get('/'), b4a.from('hello world'))
})

test('drive.clear(path)', async (t) => {
  const { drive } = await testenv(t.teardown)
  await drive.put('/loc', 'hello world')

  const entry = await drive.entry('/loc')
  const initContent = await drive.blobs.get(entry.value.blob, { wait: false })
  t.alike(initContent, b4a.from('hello world'))

  await drive.clear('/loc')

  // Entry still exists (so file not deleted)
  const nowEntry = await drive.entry('/loc')
  t.alike(nowEntry, entry)

  // But the blob is removed from storage
  const nowContent = await drive.blobs.get(entry.value.blob, { wait: false })
  t.is(nowContent, null)
})

async function testenv (teardown) {
  const corestore = new Corestore(ram)
  await corestore.ready()

  const drive = new Hyperdrive(corestore)
  await drive.ready()

  const net = await testnet(2, { teardown })
  const { bootstrap } = net
  const swarm = new Hyperswarm({ dht: new DHT({ bootstrap }) })
  teardown(swarm.destroy.bind(swarm))

  const mirror = {}
  mirror.swarm = new Hyperswarm({ dht: new DHT({ bootstrap }) })
  teardown(mirror.swarm.destroy.bind(mirror.swarm))
  mirror.corestore = new Corestore(ram)
  mirror.drive = new Hyperdrive(mirror.corestore, drive.key)
  await mirror.drive.ready()

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperdrive-test-'))
  const root = __dirname
  const paths = { tmp, root }

  return { net, paths, corestore, drive, swarm, mirror }
}

async function * readdirator (parent, { readdir = fs.readdirSync, isDirectory = (x) => fs.statSync(x).isDirectory(), filter = () => true } = {}) {
  for await (const child of readdir(parent)) {
    const next = path.join(parent, child)
    try {
      if (!filter(child)) continue
      if (await isDirectory(next)) yield * readdirator(next)
      else yield next
    } catch { continue }
  }
}

function filter (x) {
  return !(/node_modules|\.git/.test(x))
}

function downloadShark (core) {
  const telem = { offsets: [], count: 0 }
  core.on('download', (offset) => {
    telem.count++
    telem.offsets.push(offset)
  })
  return telem
}

async function streamToBuffer (stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  return b4a.concat(chunks)
}
