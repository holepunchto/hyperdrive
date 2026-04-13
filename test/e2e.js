const test = require('brittle')
const b4a = require('b4a')
const {
  e2eTestenv: testenv,
  replicate,
  ensureDbLength,
  downloadShark,
  waitForAppendIfEmpty,
  waitForEvent
} = require('./helpers.js')

test('drive.download(folder, [options])', async (t) => {
  t.plan(7)
  const { corestore, drive, swarm, mirror } = await testenv(t)
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
  const { corestore, drive, swarm, mirror } = await testenv(t)
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  mirror.swarm.on('connection', (conn) => mirror.corestore.replicate(conn))
  mirror.swarm.join(drive.discoveryKey, { server: false, client: true })
  await mirror.swarm.flush()

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
  const { corestore, drive, swarm, mirror } = await testenv(t)
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  mirror.swarm.on('connection', (conn) => mirror.corestore.replicate(conn))
  mirror.swarm.join(drive.discoveryKey, { server: false, client: true })
  await mirror.swarm.flush()

  await drive.put('/file-a', Buffer.alloc(1024))
  await drive.put('/file-b', Buffer.alloc(1024))
  await drive.put('/file-c', Buffer.alloc(1024))

  while (mirror.drive.version < drive.version) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

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
  const { drive, swarm, mirror, corestore } = await testenv(t)
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  mirror.swarm.on('connection', (conn) => mirror.corestore.replicate(conn))
  mirror.swarm.join(drive.discoveryKey, { server: false, client: true })
  await mirror.swarm.flush()

  const nil = b4a.from('nil')
  const version = drive.version

  await drive.put('/parent/child/0', nil)
  await drive.put('/parent/sibling/0', nil)
  await drive.put('/parent/child/1', nil)

  while (mirror.drive.version < drive.version) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

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
  const { corestore, drive, swarm, mirror } = await testenv(t)
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  mirror.swarm.on('connection', (conn) => mirror.corestore.replicate(conn))
  mirror.swarm.join(drive.discoveryKey, { server: false, client: true })
  await mirror.swarm.flush()

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

test('drive.findingPeers()', async (t) => {
  t.plan(2)
  const { drive, corestore, swarm, mirror } = await testenv(t)
  await drive.put('/a', b4a.from('a'))

  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  mirror.swarm.on('connection', (conn) => mirror.corestore.replicate(conn))
  mirror.swarm.join(drive.discoveryKey, { server: false, client: true })

  const done = mirror.drive.findingPeers()
  const updating = mirror.drive.update({ wait: true })
  try {
    await Promise.all([waitForEvent(mirror.swarm, 'connection'), mirror.swarm.flush()])
  } finally {
    done()
  }

  t.ok(await updating)
  t.alike(await mirror.drive.get('/a'), b4a.from('a'))
})

test('drive.entry(key, { timeout })', async (t) => {
  t.plan(1)

  const { drive, swarm, mirror } = await testenv(t)
  await replicate(drive, swarm, mirror)

  await drive.put('/file.txt', b4a.from('hi'))
  await mirror.drive.getBlobs()

  await swarm.destroy()
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

  const { drive, swarm, mirror } = await testenv(t)
  await replicate(drive, swarm, mirror)

  await drive.put('/file.txt', b4a.from('hi'))
  await mirror.drive.getBlobs()

  await swarm.destroy()
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

  const { drive, swarm, mirror } = await testenv(t)
  await replicate(drive, swarm, mirror)

  await drive.put('/file.txt', b4a.from('hi'))
  await mirror.drive.getBlobs()
  await ensureDbLength(mirror.drive, drive.version)

  const entry = await mirror.drive.entry('/file.txt')
  t.ok(entry)
  t.ok(entry.value.blob)

  await swarm.destroy()
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

  const { drive, swarm, mirror } = await testenv(t)
  await replicate(drive, swarm, mirror)

  await drive.put('/file.txt', b4a.from('hi'))
  await mirror.drive.getBlobs()

  const mirrorCheckout = mirror.drive.checkout(2)
  const entry = await mirrorCheckout.entry('/file.txt')
  t.ok(entry)
  t.ok(entry.value.blob)
  await mirrorCheckout.close()

  await swarm.destroy()
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

  const { drive, swarm, mirror } = await testenv(t)
  await replicate(drive, swarm, mirror)

  await drive.put('/file.txt', b4a.from('hi'))
  await mirror.drive.getBlobs()

  await swarm.destroy()
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

  const { drive, swarm, mirror } = await testenv(t)
  await replicate(drive, swarm, mirror)

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
  const { corestore, drive, swarm, mirror } = await testenv(t)
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  mirror.swarm.on('connection', (conn) => mirror.corestore.replicate(conn))
  mirror.swarm.join(drive.discoveryKey, { server: false, client: true })
  await mirror.swarm.flush()

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
  const { corestore, drive, swarm, mirror } = await testenv(t)
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  mirror.swarm.on('connection', (conn) => mirror.corestore.replicate(conn))
  mirror.swarm.join(drive.discoveryKey, { server: false, client: true })
  await mirror.swarm.flush()

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
  const { corestore, drive, swarm, mirror } = await testenv(t)
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  mirror.swarm.on('connection', (conn) => mirror.corestore.replicate(conn))
  mirror.swarm.join(drive.discoveryKey, { server: false, client: true })
  await mirror.swarm.flush()

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
  t.ok(monitor.downloadStats.totalBytes, 3072)
})
