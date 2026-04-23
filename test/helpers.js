const fs = require('fs')
const path = require('path')
const { once } = require('events')
const Corestore = require('corestore')
const Hyperdrive = require('../index.js')
const testnet = require('hyperdht/testnet')
const DHT = require('hyperdht')
const Hyperswarm = require('hyperswarm')
const b4a = require('b4a')
const getTmpDir = require('test-tmp')
const DebuggingStream = require('debugging-stream')

const pkgRoot = path.join(__dirname, '..')
const sampleFile = path.join(pkgRoot, 'index.js')

async function localTestenv(t) {
  const { teardown } = t

  const corestore = new Corestore(await t.tmp())
  await corestore.ready()

  const drive = new Hyperdrive(corestore)
  await drive.ready()
  teardown(drive.close.bind(drive))

  const tmp = await getTmpDir(t)
  const paths = { tmp, root: pkgRoot }

  return { corestore, drive, paths }
}

async function localTestenvWithMirror(t) {
  const base = await localTestenv(t)

  const mirrorCorestore = new Corestore(await t.tmp())
  await mirrorCorestore.ready()
  t.teardown(mirrorCorestore.close.bind(mirrorCorestore))

  const mirrorDrive = new Hyperdrive(mirrorCorestore, base.drive.key)
  await mirrorDrive.ready()
  t.teardown(mirrorDrive.close.bind(mirrorDrive))

  return {
    ...base,
    mirror: {
      corestore: mirrorCorestore,
      drive: mirrorDrive
    }
  }
}

async function e2eTestenv(t) {
  const { teardown } = t

  const corestore = new Corestore(await t.tmp())
  await corestore.ready()

  const drive = new Hyperdrive(corestore)
  await drive.ready()
  teardown(drive.close.bind(drive))

  const net = await testnet(2, { teardown })
  const { bootstrap } = net
  const swarm = new Hyperswarm({ dht: new DHT({ bootstrap }) })
  teardown(swarm.destroy.bind(swarm))

  const mirror = {}
  mirror.swarm = new Hyperswarm({ dht: new DHT({ bootstrap }) })
  teardown(mirror.swarm.destroy.bind(mirror.swarm))
  mirror.corestore = new Corestore(await t.tmp())
  mirror.drive = new Hyperdrive(mirror.corestore, drive.key)
  await mirror.drive.ready()
  teardown(mirror.drive.close.bind(mirror.drive))

  const tmp = await getTmpDir(t)
  const paths = { tmp, root: pkgRoot }

  return { net, paths, corestore, drive, hyperSwarm: swarm, mirror }
}

async function* readdirator(
  parent,
  {
    readdir = fs.readdirSync,
    isDirectory = (x) => fs.statSync(x).isDirectory(),
    filter = () => true
  } = {}
) {
  for await (const child of readdir(parent)) {
    const next = path.join(parent, child)
    try {
      if (!filter(child)) continue
      if (await isDirectory(next)) yield* readdirator(next)
      else yield next
    } catch {
      continue
    }
  }
}

function filter(x) {
  return !/^(?:node_modules|coverage|\.git)$/.test(x)
}

function downloadShark(core) {
  const telem = { offsets: [], count: 0 }
  core.on('download', (offset) => {
    telem.count++
    telem.offsets.push(offset)
  })
  return telem
}

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  return b4a.concat(chunks)
}

async function swarm(drive, swarm, mirror) {
  swarm.on('connection', (conn) => drive.corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()

  mirror.swarm.on('connection', (conn) => mirror.corestore.replicate(conn))
  mirror.swarm.join(drive.discoveryKey, { server: false, client: true })
}

function replicateDebugStream(t, a, b, opts = {}) {
  const { latency, speed, jitter } = opts

  const s1 = a.replicate(true, { keepAlive: false, ...opts })
  const s2Base = b.replicate(false, { keepAlive: false, ...opts })
  const s2 = new DebuggingStream(s2Base, { latency, speed, jitter })

  s1.on('error', (err) => t.comment(`replication stream error (initiator): ${err}`))
  s2.on('error', (err) => t.comment(`replication stream error (responder): ${err}`))

  if (opts.teardown !== false) {
    t.teardown(async function () {
      let missing = 2
      await new Promise((resolve) => {
        s1.on('close', onclose)
        s1.destroy()

        s2.on('close', onclose)
        s2.destroy()

        function onclose() {
          if (--missing === 0) resolve()
        }
      })
    })
  }

  s1.pipe(s2).pipe(s1)

  return [s1, s2]
}

async function ensureDbLength(drive, length) {
  while (drive.db.core.length < length) await once(drive.db.core, 'append')
}

function replicate(drive, mirror) {
  const s1 = drive.corestore.replicate(true, { keepAlive: false })
  const s2 = mirror.corestore.replicate(false, { keepAlive: false })
  s1.pipe(s2).pipe(s1)
  return [s1, s2]
}

async function syncDriveVersion(mirrorDrive, targetVersion) {
  while (mirrorDrive.version < targetVersion) {
    await once(mirrorDrive.db.core, 'append')
  }
}

async function waitForAppendIfEmpty(core, message, timeout = 20000) {
  if (core.length !== 0) return
  await waitForEvent(core, 'append', () => core.length !== 0, timeout, message)
}

async function waitForEvent(
  emitter,
  event,
  predicate = null,
  timeout = 20000,
  message = `Timed out waiting for ${event}`
) {
  await new Promise((resolve, reject) => {
    let timer = null

    function cleanup() {
      if (timer) clearTimeout(timer)
      emitter.removeListener(event, onevent)
    }

    function onevent(...args) {
      if (predicate && !predicate(...args)) return
      cleanup()
      resolve()
    }

    emitter.on(event, onevent)
    timer = setTimeout(() => {
      cleanup()
      reject(new Error(message))
    }, timeout)

    if (predicate && predicate()) {
      cleanup()
      resolve()
    }
  })
}

module.exports = {
  pkgRoot,
  sampleFile,
  localTestenv,
  localTestenvWithMirror,
  e2eTestenv,
  readdirator,
  filter,
  downloadShark,
  streamToBuffer,
  swarm,
  replicateDebugStream,
  ensureDbLength,
  replicate,
  syncDriveVersion,
  waitForAppendIfEmpty,
  waitForEvent,
  Hyperdrive
}
