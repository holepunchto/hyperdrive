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
  ensureDbLength,
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
  const s1 = drive.corestore.replicate(true)
  const s2 = otherDrive.corestore.replicate(false)
  s1.pipe(s2).pipe(s1)

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

test('getBlobsLength large db - prefetch', async (t) => {
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
