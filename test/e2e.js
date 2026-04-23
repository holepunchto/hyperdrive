const test = require('brittle')
const b4a = require('b4a')
const { e2eTestenv, swarm, waitForEvent } = require('./helpers.js')

test('drive.findingPeers()', async (t) => {
  t.plan(2)
  const { drive, hyperSwarm, mirror } = await e2eTestenv(t)
  await drive.put('/a', b4a.from('a'))

  await swarm(drive, hyperSwarm, mirror)

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
