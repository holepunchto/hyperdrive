const test = require('tape')
const ram = require('random-access-memory')
const Corestore = require('corestore')

const Replicator = require('./helpers/replicator')
const create = require('./helpers/create')

test('single-file download and clear', t => {
  const r = new Replicator(t)
  const drive1 = create()
  var drive2 = null

  drive1.ready(err => {
    t.error(err, 'no error')
    drive2 = create(drive1.key)
    drive2.ready(err => {
      t.error(err, 'no error')
      r.replicate(drive1, drive2)
      onready()
    })
  })

  function onready () {
    drive1.writeFile('hello', 'world', err => {
      t.error(err, 'no error')
      setImmediate(() => {
        drive2.stats('hello', (err, totals) => {
          t.error(err, 'no error')
          t.same(totals.blocks, 1)
          t.same(totals.downloadedBlocks, 0)
          drive2.download('hello', err => {
            t.error(err)
            drive2.stats('hello', (err, totals) => {
              t.same(totals.downloadedBlocks, 1)
              drive2.clear('hello', (err) => {
                t.error(err)
                drive2.stats('hello', (err, totals) => {
                  t.same(totals.downloadedBlocks, 0)
                  r.end()
                })
              })
            })
          })
        })
      })
    })
  }
})
