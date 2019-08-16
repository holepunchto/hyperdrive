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
          const handle = drive2.download('hello', { detailed: true })
          ondownloading(handle)
        })
      })
    })
  }

  function ondownloading (handle) {
    handle.on('finish', (total, byFile) => {
      t.same(total.downloadedBlocks, 1)
      t.same(total.downloadedBytes, 5)
      t.same(byFile.get('hello').downloadedBlocks, 1)
      t.end()
    })
    handle.on('error', t.fail.bind(t))
    handle.on('cancel', t.fail.bind(t))
  }
})

test('directory download', t => {
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
    drive1.writeFile('a/1', '1', err => {
      t.error(err, 'no error')
      drive1.writeFile('a/2', '2',err => {
        t.error(err, 'no error')
        drive1.writeFile('a/3', '3', err => {
          t.error(err, 'no error')
          setImmediate(() => {
            const handle = drive2.download('a', { detailed: true })
            ondownloading(handle)
          })
        })
      })
    })
  }

  function ondownloading (handle) {
    handle.on('finish', (total, byFile) => {
      t.same(total.downloadedBlocks, 3)
      t.same(total.downloadedBytes, Buffer.from('1').length * 3)
      t.same(byFile.get('/a/1').downloadedBlocks, 1)
      t.same(byFile.get('/a/2').downloadedBlocks, 1)
      t.same(byFile.get('/a/3').downloadedBlocks, 1)
      t.end()
    })
    handle.on('error', t.fail.bind(t))
    handle.on('cancel', t.fail.bind(t))
  }
})

test('download cancellation', t => {
  t.end()
})

function printHandle (handle) {
  handle.on('start', (...args) => console.log('start', args))
  handle.on('progress', (...args) => console.log('progress', args))
  handle.on('error', (...args) => console.log('error', args))
  handle.on('finish', (...args) => console.log('finish', args))
}
