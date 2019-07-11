var tape = require('tape')
var create = require('./helpers/create')

tape('simple diff stream', async function (t) {
  let drive = create()

  var v1, v2, v3
  let v3Diff = ['del-hello']
  let v2Diff = [...v3Diff, 'put-other']
  let v1Diff = [...v2Diff, 'put-hello']

  await writeVersions()
  console.log('drive.version:', drive.version, 'v1:', v1)
  await verifyDiffStream(v1, v1Diff)
  await verifyDiffStream(v2, v2Diff)
  await verifyDiffStream(v3, v3Diff)
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

  async function verifyDiffStream (version, diffList) {
    let diffSet = new Set(diffList)
    console.log('diffing to version:', version, 'from version:', drive.version)
    let diffStream = drive.createDiffStream(version)
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
})
