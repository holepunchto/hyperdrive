const { promisify } = require('util')
const test = require('tape')
const pump = require('pump')
const LatencyStream = require('latency-stream')
const HypercoreProtocol = require('hypercore-protocol')

const replicateAll = require('../test/helpers/replicate')
const create = require('../test/helpers/create')

test('first read, 50ms latency', async t => {
  const LATENCY = 50
  const source = create()
  var dest, s1, s2

  source.ready(() => {
    dest = create(source.key)
    dest.ready(() => {
      return configure()
    })
  })

  function configure () {
    source.writeFile('hello', 'world', () => {
      source.writeFile('something', 'other', () => {
        return reconnect(bench)
      })
    })
  }

  function reconnect (cb) {
    if (s1) {
      s1.destroy()
      s2.destroy()
      s2.on('close', connect)
    } else {
      return connect()
    }

    function connect () {
      s1 = new HypercoreProtocol(true, { live: true })
      s2 = new HypercoreProtocol(false, { live: true })
      pump(s1, new LatencyStream([LATENCY, LATENCY]), s2, new LatencyStream([LATENCY, LATENCY]), s1, err => {
        // Suppress stream errors
      })
      s1.on('handshake', cb)
    }
  }

  function bench () {
    console.time('first-read')
    dest.readFile('hello', (err, contents) => {
      console.timeEnd('first-read')
      t.error(err, 'no error')
      t.same(contents, Buffer.from('world'))
      t.end()
    })
    source.replicate({ stream: s1, live: true })
    dest.replicate({ stream: s2, live: true  })
  }
})

test('subsequent read, 50ms latency', async t => {
  const LATENCY = 50
  const source = create()
  var dest, s1, s2

  source.ready(() => {
    dest = create(source.key)
    dest.ready(() => {
      return configure()
    })
  })

  function configure () {
    source.writeFile('hello', 'world', () => {
      source.writeFile('something', 'other', () => {
        return reconnect(bench)
      })
    })
  }

  function reconnect (cb) {
    if (s1) {
      s1.destroy()
      s2.destroy()
      s2.on('close', connect)
    } else {
      return connect()
    }

    function connect () {
      s1 = new HypercoreProtocol(true, { live: true })
      s2 = new HypercoreProtocol(false, { live: true })
      pump(s1, new LatencyStream([LATENCY, LATENCY]), s2, new LatencyStream([LATENCY, LATENCY]), s1, err => {
        // Suppress stream errors
      })
      s1.on('handshake', cb)
    }
  }

  function bench () {
    dest.readFile('hello', err => {
      t.error(err, 'no error')
      return reconnect(() => {
        console.time('subsequent-read')
        source.replicate({ stream: s1, live: true })
        dest.replicate({ stream: s2, live: true  })
        dest.readFile('something', (err, contents) => {
          console.timeEnd('subsequent-read')
          t.error(err, 'no error')
          t.same(contents, Buffer.from('other'))
          t.end()
        })
      })
    })
    source.replicate({ stream: s1, live: true })
    dest.replicate({ stream: s2, live: true  })
  }
})

test('reading the same file twice, 50ms latency', async t => {
  const LATENCY = 50
  const source = create()
  var dest, s1, s2

  source.ready(() => {
    dest = create(source.key)
    dest.ready(() => {
      return configure()
    })
  })

  function configure () {
    source.writeFile('hello', 'world', () => {
      source.writeFile('something', 'other', () => {
        return reconnect(bench)
      })
    })
  }

  function reconnect (cb) {
    if (s1) {
      s1.destroy()
      s2.destroy()
      s2.on('close', connect)
    } else {
      return connect()
    }

    function connect () {
      s1 = new HypercoreProtocol(true, { live: true })
      s2 = new HypercoreProtocol(false, { live: true })
      pump(s1, new LatencyStream([LATENCY, LATENCY]), s2, new LatencyStream([LATENCY, LATENCY]), s1, err => {
        // Suppress stream errors
      })
      s1.on('handshake', cb)
    }
  }

  function bench () {
    dest.readFile('hello', err => {
      t.error(err, 'no error')
      return reconnect(() => {
        console.time('subsequent-read')
        source.replicate({ stream: s1, live: true })
        dest.replicate({ stream: s2, live: true  })
        dest.readFile('hello', (err, contents) => {
          console.timeEnd('subsequent-read')
          t.error(err, 'no error')
          t.same(contents, Buffer.from('world'))
          t.end()
        })
      })
    })
    source.replicate({ stream: s1, live: true })
    dest.replicate({ stream: s2, live: true  })
  }
})
