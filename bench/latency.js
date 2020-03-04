const { promisify } = require('util')
const nanobench = require('nanobench')
const pump = require('pump')
const LatencyStream = require('latency-stream')
const HypercoreProtocol = require('hypercore-protocol')

const replicateAll = require('../test/helpers/replicate')
const create = require('../test/helpers/create')
const { runAll } = require('../test/helpers/util')

nanobench('first read, 50ms latency', async b => {
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
    b.start()
    dest.readFile('hello', () => {
      b.end()
    })
    source.replicate({ stream: s1, live: true })
    dest.replicate({ stream: s2, live: true  })
  }
})

nanobench('subsequent read, 50ms latency', async b => {
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
      return reconnect(() => {
        b.start()
        source.replicate({ stream: s1, live: true })
        dest.replicate({ stream: s2, live: true  })
        dest.readFile('something', () => {
          b.end()
        })
      })
    })
    source.replicate({ stream: s1, live: true })
    dest.replicate({ stream: s2, live: true  })
  }
})

nanobench('subsequent seek, 50ms latency', async b => {
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
      source.writeFile('something', Buffer.allocUnsafe(1024 * 1024).fill('abc123'), () => {
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
      return reconnect(() => {
        b.start()
        source.replicate({ stream: s1, live: true })
        dest.replicate({ stream: s2, live: true  })
        dest.open('something', 'r', (_, fd) => {
          dest.read(fd, Buffer.allocUnsafe(1024), 0, 1024, 1024 * 800, () => {
            b.end()
          })
        })
      })
    })
    source.replicate({ stream: s1, live: true })
    dest.replicate({ stream: s2, live: true  })
  }
})

nanobench('reading the same file twice, 50ms latency', async b => {
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
    dest.readFile('hello', () => {
      return reconnect(() => {
        b.start()
        source.replicate({ stream: s1, live: true })
        dest.replicate({ stream: s2, live: true  })
        dest.readFile('hello', () => {
          b.end()
        })
      })
    })
    source.replicate({ stream: s1, live: true })
    dest.replicate({ stream: s2, live: true  })
  }
})

nanobench('listing a directory with 100 files, 50ms latency', async b => {
  const LATENCY = 50
  const NUM_FILES = 100

  const source = create()
  var dest, s1, s2

  source.ready(() => {
    dest = create(source.key)
    dest.ready(() => {
      return configure()
    })
  })

  async function configure () {
    const files = (new Array(NUM_FILES)).fill(0).map((_, i) => '' + i)
    await runAll(files.map(name => {
      return cb => source.writeFile(name, name, cb)
    }))
    return reconnect(bench)
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
    dest.readFile('0', () => {
      b.start()
      dest.readdir('/', (err, list) => {
        b.end()
      })
    })
    source.replicate({ stream: s1, live: true })
    dest.replicate({ stream: s2, live: true  })
  }
})
