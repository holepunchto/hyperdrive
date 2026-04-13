const fs = require('fs')
const { once } = require('events')
const test = require('brittle')
const Corestore = require('corestore')
const b4a = require('b4a')
const Hyperdrive = require('../index.js')
const {
  localTestenv: testenv,
  localTestenvWithMirror: testenvWithMirror,
  replicateDebugStream,
  pipeReplicate,
  syncDriveVersion,
  ensureDbLength,
  downloadShark,
  waitForAppendIfEmpty,
  sampleFile
} = require('./helpers.js')

test('Hyperdrive(corestore, key)', async (t) => {
  t.plan(2)
  const { corestore, drive } = await testenv(t)
  const diskbuf = fs.readFileSync(sampleFile)
  await drive.put(sampleFile, diskbuf)
  const bndlbuf = await drive.get(sampleFile)
  t.is(b4a.compare(diskbuf, bndlbuf), 0)
  const mirror = new Hyperdrive(corestore.session({ writable: false }), drive.core.key)
  await mirror.ready()
  const mrrrbuf = await mirror.get(sampleFile)
  t.is(b4a.compare(bndlbuf, mrrrbuf), 0)
})

test('drive.get(path, { wait: false }) throws if entry exists but not found', async (t) => {
  const { drive, mirror } = await testenvWithMirror(t)

  const otherDrive = mirror.drive
  pipeReplicate(drive, otherDrive)

  await drive.put('/file', 'content')
  await ensureDbLength(otherDrive, drive.version)

  await otherDrive.entry('/file') // Ensure in bee

  await t.exception(() => otherDrive.get('/file', { wait: false }), /BLOCK_NOT_AVAILABLE/)
  t.is(
    b4a.toString(await otherDrive.get('/file')),
    'content',
    'sanity check: can actually get content'
  )
})

test('drive.mirror()', async (t) => {
  const { drive: a } = await testenv(t)
  const { drive: b } = await testenv(t)

  await a.put('/file.txt', 'hello world')
  await a.mirror(b).done()

  t.alike(await b.get('/file.txt'), b4a.from('hello world'))
})

test('basic writable option', async function (t) {
  t.plan(3)

  const store = new Corestore(await t.tmp())

  const a = new Hyperdrive(store)
  await a.put('/file-one', 'hi')

  const b = new Hyperdrive(store.session({ writable: false }), a.key)
  await b.ready()
  t.is(b.writable, false)
  t.is(b.blobs.core.writable, false)

  try {
    await b.put('/file-two', 'hi')
    t.fail('Should have failed')
  } catch (err) {
    t.is(err.code, 'SESSION_NOT_WRITABLE')
  }

  await a.close()
  await b.close()
})

test('getBlobsLength large db - prefetch', { timeout: 120_000 }, async (t) => {
  const store = new Corestore(await t.tmp())
  t.teardown(() => store.close())
  const a = new Hyperdrive(store.session())
  t.teardown(() => a.close())

  const num = 1_000
  for (let i = 0; i < num; i++) {
    await a.put('./file' + i, 'here')
  }

  const store2 = new Corestore(await t.tmp())
  t.teardown(() => store2.close())

  const b = new Hyperdrive(store2.session(), a.key)
  t.teardown(() => b.close())

  const gotAppend = once(b.core, 'append')
  replicateDebugStream(t, a, b, { latency: 10 })
  await gotAppend

  t.is(await b.getBlobsLength(), await a.getBlobsLength(), 'blob lengths match')
  t.comment('wireRequest sent', b.core.replicator.stats.wireRequest.tx)
  t.ok(
    b.core.replicator.stats.wireRequest.tx < 1.1 * num,
    'synced within a reasonable amount of requests'
  )
})

test('drive.download(folder, [options])', async (t) => {
  t.plan(7)
  const { drive, mirror } = await testenvWithMirror(t)
  pipeReplicate(drive, mirror)

  const nil = b4a.from('nil')

  let count = 0
  let max = -Infinity

  await drive.put('/parent/child/grandchild1', nil)
  await drive.put('/parent/child/grandchild2', nil)

  await ensureDbLength(mirror.drive, drive.version)

  const blobs = await mirror.drive.getBlobs()

  blobs.core.on('download', (offset) => {
    count++
    if (max < offset) max = offset
  })

  const l = drive.blobs.core.length

  await drive.put('/parent/sibling/grandchild1', nil)

  t.is(count, 0)
  const download = mirror.drive.download('/parent/child')
  await download.done()
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

test('drive.download(filename, [options])', async (t) => {
  const { drive, mirror } = await testenvWithMirror(t)
  pipeReplicate(drive, mirror)

  const nil = b4a.from('nil')

  await drive.put('/parent/grandchild1', nil)
  await drive.put('/file', nil)
  await drive.put('/parent/grandchild2', nil)

  await ensureDbLength(mirror.drive, drive.version)

  await mirror.drive.getBlobs()
  const download = mirror.drive.download('/file')
  await download.done()

  t.ok(await mirror.drive.get('/file', { wait: false }))

  try {
    await mirror.drive.get('/file1', { wait: false })
  } catch {
    t.pass('not downloaded')
  }
})

test('drive.downloadRange(dbRanges, blobRanges)', async (t) => {
  const { drive, mirror } = await testenvWithMirror(t)
  pipeReplicate(drive, mirror)

  await drive.put('/file-a', Buffer.alloc(1024))
  await drive.put('/file-b', Buffer.alloc(1024))
  await drive.put('/file-c', Buffer.alloc(1024))

  await syncDriveVersion(mirror.drive, drive.version)

  const blobCore = (await mirror.drive.getBlobs()).core

  const fileTelem = downloadShark(mirror.drive.core)
  const blobTelem = downloadShark(blobCore)

  const download = await mirror.drive.downloadRange(
    [
      { start: 1, end: 2 },
      { start: 2, end: 3 }
    ],
    [{ start: 0, end: 3 }]
  )
  await download.done()

  t.is(fileTelem.count, 2)
  t.is(blobTelem.count, 3)
})

test('drive.downloadDiff(version, folder, [options])', async (t) => {
  const { drive, mirror } = await testenvWithMirror(t)
  pipeReplicate(drive, mirror)

  const nil = b4a.from('nil')
  const version = drive.version

  await drive.put('/parent/child/0', nil)
  await drive.put('/parent/sibling/0', nil)
  await drive.put('/parent/child/1', nil)

  await syncDriveVersion(mirror.drive, drive.version)

  const blobCore = (await mirror.drive.getBlobs()).core

  const filestelem = downloadShark(mirror.drive.core)
  const blobstelem = downloadShark(blobCore)

  const downloadDiff = await mirror.drive.downloadDiff(version, '/parent/child')
  await downloadDiff.done()

  const filescount = filestelem.count
  const blobscount = blobstelem.count

  await mirror.drive.get('/parent/child/1')

  t.is(filescount, filestelem.count)
  t.is(blobscount, blobstelem.count)
})

test('drive.has(path)', async (t) => {
  t.plan(8)
  const { drive, mirror } = await testenvWithMirror(t)
  pipeReplicate(drive, mirror)

  const nil = b4a.from('nil')

  await drive.put('/parent/child/grandchild1', nil)
  await drive.put('/parent/child/grandchild2', nil)

  await ensureDbLength(mirror.drive, drive.version)

  t.absent(await mirror.drive.has('/parent/child/'))
  t.absent(await mirror.drive.has('/parent/child/grandchild2'))
  t.absent(await mirror.drive.has('/non-existent.txt'), 'returns false for non-existent files')
  t.absent(await mirror.drive.has('/non-existent/'), 'returns false for non-existent directory')

  await drive.put('/parent/sibling/grandchild1', nil)
  await ensureDbLength(mirror.drive, drive.version)

  const downloadChild = mirror.drive.download('/parent/child/')
  await downloadChild.done()

  t.ok(await mirror.drive.has('/parent/child/'))
  t.absent(await mirror.drive.has('/parent/'))

  const downloadSibling = mirror.drive.download('/parent/sibling/')
  await downloadSibling.done()

  t.ok(await mirror.drive.has('/parent/'))
  t.ok(await mirror.drive.has('/parent/sibling/grandchild1'))
})

test('drive.entry(key, { timeout })', async (t) => {
  t.plan(1)

  const { drive, mirror } = await testenvWithMirror(t)
  const [s1, s2] = pipeReplicate(drive, mirror)

  await drive.put('/file.txt', b4a.from('hi'))
  await mirror.drive.getBlobs()

  s1.destroy()
  s2.destroy()
  await drive.close()

  try {
    await mirror.drive.entry('/file.txt', { timeout: 1 })
    t.fail('should have failed')
  } catch (error) {
    t.is(error.code, 'REQUEST_TIMEOUT')
  }
})

test('drive.entry(key, { wait })', async (t) => {
  t.plan(1)

  const { drive, mirror } = await testenvWithMirror(t)
  const [s1, s2] = pipeReplicate(drive, mirror)

  await drive.put('/file.txt', b4a.from('hi'))
  await mirror.drive.getBlobs()

  s1.destroy()
  s2.destroy()
  await drive.close()

  try {
    await mirror.drive.entry('/file.txt', { wait: false })
    t.fail('should have failed')
  } catch (error) {
    t.is(error.code, 'BLOCK_NOT_AVAILABLE')
  }
})

test('drive.get(key, { timeout })', async (t) => {
  t.plan(3)

  const { drive, mirror } = await testenvWithMirror(t)
  const [s1, s2] = pipeReplicate(drive, mirror)

  await drive.put('/file.txt', b4a.from('hi'))
  await mirror.drive.getBlobs()
  await ensureDbLength(mirror.drive, drive.version)

  const entry = await mirror.drive.entry('/file.txt')
  t.ok(entry)
  t.ok(entry.value.blob)

  s1.destroy()
  s2.destroy()
  await drive.close()

  try {
    await mirror.drive.get('/file.txt', { timeout: 1 })
    t.fail('should have failed')
  } catch (error) {
    t.is(error.code, 'REQUEST_TIMEOUT')
  }
})

test('drive.get(key, { wait }) with entry but no blob', async (t) => {
  t.plan(3)

  const { drive, mirror } = await testenvWithMirror(t)
  const [s1, s2] = pipeReplicate(drive, mirror)

  await drive.put('/file.txt', b4a.from('hi'))
  await mirror.drive.getBlobs()

  const mirrorCheckout = mirror.drive.checkout(2)
  const entry = await mirrorCheckout.entry('/file.txt')
  t.ok(entry)
  t.ok(entry.value.blob)
  await mirrorCheckout.close()

  s1.destroy()
  s2.destroy()
  await drive.close()

  try {
    await mirror.drive.get('/file.txt', { wait: false })
    t.fail('should have failed')
  } catch (error) {
    t.is(error.code, 'BLOCK_NOT_AVAILABLE')
  }
})

test('drive.get(key, { wait }) without entry', async (t) => {
  t.plan(1)

  const { drive, mirror } = await testenvWithMirror(t)
  const [s1, s2] = pipeReplicate(drive, mirror)

  await drive.put('/file.txt', b4a.from('hi'))
  await mirror.drive.getBlobs()

  s1.destroy()
  s2.destroy()
  await drive.close()

  try {
    await mirror.drive.get('/file.txt', { wait: false })
    t.fail('should have failed')
  } catch (error) {
    t.is(error.code, 'BLOCK_NOT_AVAILABLE')
  }
})

test('drive peek with get() and timeout', async (t) => {
  t.plan(3)

  const { drive, mirror } = await testenvWithMirror(t)
  pipeReplicate(drive, mirror)

  await drive.put('/file.txt', b4a.from('hi'))
  await ensureDbLength(mirror.drive, drive.version)

  const entry = await mirror.drive.entry('/file.txt')
  t.ok(entry)
  t.ok(entry.value.blob)

  try {
    await mirror.drive.get('/file.txt', { start: 100, timeout: 1 })
    t.fail('should have failed')
  } catch (error) {
    t.is(error.code, 'REQUEST_TIMEOUT')
  }
})

test('download can be destroyed', async (t) => {
  t.plan(1)
  const { drive, mirror } = await testenvWithMirror(t)
  pipeReplicate(drive, mirror)

  await drive.put('/file', b4a.allocUnsafe(1024 * 1024 * 30))

  await ensureDbLength(mirror.drive, drive.version)
  const blobs = await mirror.drive.getBlobs()

  const download = mirror.drive.download('/file')
  await waitForAppendIfEmpty(blobs.core, 'Timed out waiting for blobs length')
  download.destroy()

  // not needed, just for test timing
  await download.close()

  t.ok(blobs.core.contiguousLength < blobs.core.length)
})

test('upload/download can be monitored', async (t) => {
  t.plan(16)
  const { drive, mirror } = await testenvWithMirror(t)
  pipeReplicate(drive, mirror)

  const file = '/example.md'
  const bytes = 1024 * 100
  const buffer = Buffer.alloc(bytes, '0')
  await drive.put(file, buffer)
  await ensureDbLength(mirror.drive, drive.version)

  const uploadMonitor = drive.monitor(file)
  await uploadMonitor.ready()
  t.is(uploadMonitor.name, file)
  t.is(uploadMonitor.uploadStats.targetBytes, bytes)
  t.ok(uploadMonitor.uploadStats.targetBlocks > 0)

  const downloadMonitor = mirror.drive.monitor(file)
  await downloadMonitor.ready()
  t.is(downloadMonitor.downloadStats.targetBytes, bytes)
  t.ok(downloadMonitor.downloadStats.targetBlocks > 0)

  let uploadUpdates = 0
  let downloadUpdates = 0

  function onUploadUpdate() {
    uploadUpdates++
  }

  function onDownloadUpdate() {
    downloadUpdates++
  }

  uploadMonitor.on('update', onUploadUpdate)
  downloadMonitor.on('update', onDownloadUpdate)

  await mirror.drive.get(file)

  t.is(uploadMonitor.uploadStats.monitoringBytes, bytes)
  t.is(downloadMonitor.downloadStats.monitoringBytes, bytes)
  t.is(uploadMonitor.uploadStats.blocks, uploadMonitor.uploadStats.targetBlocks)
  t.is(downloadMonitor.downloadStats.blocks, downloadMonitor.downloadStats.targetBlocks)
  t.is(uploadMonitor.uploadStats.percentage, 100)
  t.is(downloadMonitor.downloadStats.percentage, 100)
  t.is(uploadMonitor.uploadSpeed(), uploadMonitor.uploadStats.speed)
  t.is(downloadMonitor.downloadSpeed(), downloadMonitor.downloadStats.speed)
  t.ok(uploadUpdates >= 2, 'upload should emit multiple update events')
  t.ok(downloadUpdates >= 2, 'download should emit multiple update events')

  uploadMonitor.removeListener('update', onUploadUpdate)
  downloadMonitor.removeListener('update', onDownloadUpdate)

  await uploadMonitor.close()
  await downloadMonitor.close()
  t.pass('monitors closed')
})

test('monitor range download', async (t) => {
  const { drive, mirror } = await testenvWithMirror(t)
  pipeReplicate(drive, mirror)

  await drive.put('/file-a', Buffer.alloc(1024))
  await drive.put('/file-b', Buffer.alloc(1024))
  await drive.put('/file-c', Buffer.alloc(1024))

  await ensureDbLength(mirror.drive, drive.version)

  const monitor = mirror.drive.monitor('download-monitor')
  await monitor.ready()

  const download = await mirror.drive.downloadRange([], [{ start: 0, end: 3 }])
  await download.done()

  t.is(monitor.downloadStats.peers, 1)
  t.ok(monitor.downloadStats.speed > 0)
  t.ok(monitor.downloadStats.blocks > 0)
  t.is(monitor.downloadStats.totalBytes, 3072)
})
