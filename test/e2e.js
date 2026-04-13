const test = require('brittle')
const b4a = require('b4a')
const { e2eTestenv, waitForEvent } = require('./helpers.js')

test('drive.findingPeers()', async (t) => {
  t.plan(2)
  const { drive, corestore, swarm, mirror } = await e2eTestenv(t)
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
