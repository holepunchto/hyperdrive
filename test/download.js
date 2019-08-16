const test = require('tape')

const replicateAll = require('./helpers/replicate')
const create = require('./helpers/create')

test('single-file download', t => {
  const drive1 = create()
  var drive2 = null

  drive1.ready(err => {
    t.error(err, 'no error')
    drive2 = create(drive1.key)
    drive2.ready(err => {
      t.error(err, 'no error')
      replicateAll([drive1, drive2])
      onready()
    })
  })

  function onready () {
    drive1.writeFile('hello', 'world', err => {
      t.error(err, 'no error')
      setImmediate(() => {
        drive2.fileStats('hello', (err, totals) => {
          t.error(err, 'no error')
          t.same(totals.blocks, 1)
          t.same(totals.downloadedBlocks, 0)
          const handle = drive2.download('hello')
          ondownloading(handle)
        })
      })
    })
  }

  function ondownloading (handle) {
    console.log('HANDLE:', handle)
    handle.on('start', (...args) => console.log('start', ...args))
    handle.on('progress', (...args) => console.log('progress', ...args))
    handle.on('cancel', (...args) => console.log('cancel', ...args))
    handle.on('finish', (...args) => console.log('finish', ...args))
  }
})
