var tape = require('tape')
var create = require('./helpers/create')
var { runAll } = require('./helpers/util')
var collect = require('stream-collector')

tape('simple diff stream', async function (t) {
  let drive = create()

  var v1, v2, v3

  // TODO: The v3 diff currently has a false-positive for put-other.
  let v3Diff = ['del-hello', 'put-other']
  // Since hello was already written in v2, its corresponding delete should be recorded in v2diff.
  let v2Diff = ['put-other', 'del-hello']
  // Since hello has been put/deleted, it does not appear in the complete diff.
  let v1Diff = ['put-other']

  await writeVersions()
  await verifyDiffStream(t, drive, [v1], v1Diff)
  await verifyDiffStream(t, drive, [v2], v2Diff)
  await verifyDiffStream(t, drive, [v3], v3Diff)
  t.end()

  function writeVersions () {
    return new Promise(resolve => {
      drive.ready(err => {
        t.error(err, 'no error')
        v1 = drive.version
        drive.writeFile('/hello', 'world', err => {
          t.error(err, 'no error')
          v2 = drive.version
          drive.writeFile('/other', 'file', err => {
            t.error(err, 'no error')
            v3 = drive.version
            drive.unlink('/hello', err => {
              t.error(err, 'no error')
              return resolve()
            })
          })
        })
      })
    })
  }
})

tape.skip('diff stream with mounts', async function (t) {
  let drive1 = create()
  let drive2 = create()
  let drive3 = create()

  var v1, v2, v3

  let v3Diff = ['unmount-hello', 'mount-goodbye']
  let v2Diff = ['mount-hello', 'put-other']
  let v1Diff = ['mount-goodbye', 'put-other']

  await ready()
  await writeVersions()
  await verifyDiffStream(t, drive1, [v1], v1Diff)
  await verifyDiffStream(t, drive1, [v1, v2], v2Diff)
  await verifyDiffStream(t, drive1, [v2, v3], v3Diff)
  t.end()

  function ready () {
    return new Promise(resolve => {
      drive1.ready(err => {
        t.error(err, 'no error')
        drive2.ready(err => {
          t.error(err, 'no error')
          drive3.ready(err => {
            t.error(err, 'no error')
            return resolve()
          })
        })
      })
    })
  }

  function writeVersions () {
    return new Promise(resolve => {
      v1 = drive1.version
      drive1.mount('/hello', drive2.key, err => {
        t.error(err, 'no error')
        drive1.writeFile('/other', 'file', err => {
          t.error(err, 'no error')
          v2 = drive1.version
          drive1.mount('/goodbye', drive3.key, err => {
            t.error(err, 'no error')
            drive1.unmount('/hello', err => {
              t.error(err, 'no error')
              v3 = drive1.version
              return resolve()
            })
          })
        })
      })
    })
  }
})

tape('diff stream returns seqs', t => {
  const drive = create()
  runAll([
    cb => drive.writeFile('one', Buffer.from('one'), cb),
    cb => drive.writeFile('two', Buffer.from('two'), cb),
    cb => drive.writeFile('one', Buffer.from('mod'), cb),
    cb => {
      const diff = drive.createDiffStream(0)
      collect(diff, (err, res) => {
        t.error(err)
        res = res.map(map)
        t.deepEqual(res, [
          'put one 3 x',
          'put two 2 x'
        ], 'seqs are correct')
        cb()
      })
    },
    cb => drive.writeFile('three', Buffer.from('three'), cb),
    cb => drive.unlink('one', cb),
    cb => {
      const diff = drive.createDiffStream(4)
      collect(diff, (err, res) => {
        t.error(err)
        res = res.map(map)
        t.deepEqual(res, [
          'del one x 3',
          'put three 5 x'
        ], 'seqs are correct')
        t.end()
      })
    }
  ])

  function map (row) {
    return `${row.type} ${row.name} ${row.seq || 'x'} ${row.previous ? row.previous.seq : 'x'}`
  }
})

async function verifyDiffStream (t, drive, [from, to], diffList) {
  let diffSet = new Set(diffList)

  const fromDrive = from ? drive.checkout(from) : drive
  const toDrive = to ? drive.checkout(to) : drive
  let diffStream = toDrive.createDiffStream(fromDrive)

  return new Promise(resolve => {
    diffStream.on('data', ({ type, name }) => {
      let key = `${type}-${name}`
      if (!diffSet.has(key)) {
        return t.fail('an incorrect diff was streamed')
      }
      diffSet.delete(key)
    })
    diffStream.on('end', () => {
      t.same(diffSet.size, 0)
      return resolve()
    })
  })
}
