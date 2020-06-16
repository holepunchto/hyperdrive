const { Transform } = require('streamx')
const pumpify = require('pumpify')

module.exports = class Replicator {
  constructor (t) {
    this.t = t
    this.streams = []
  }

  replicate (a, b, opts = {}) {
    const s1 = a.replicate(true, { live: true, ...opts })
    const s2 = b.replicate(false, { live: true, ...opts })

    if (opts && opts.throttle) {
      const t1 = pumpify(s1, throttler(opts.throttle))
      const t2 = pumpify(s2, throttler(opts.throttle))
      t1.pipe(t2).pipe(t1)
    } else {
      s1.pipe(s2).pipe(s1)
    }

    this.streams.push([s1, s2])
    return [s1, s2]
  }

  end () {
    const t = this.t
    let missing = 1

    for (const [s1, s2] of this.streams) {
      if (!s1.destroyed) {
        missing++
        s1.on('error', noop).on('close', onclose)
        s1.destroy()
      }
      if (!s2.destroyed) {
        missing++
        s2.on('error', noop).on('close', onclose)
        s2.destroy()
      }
    }

    onclose()

    function onclose () {
      if (!--missing) {
        if (t) t.end()
      }
    }
  }
}

function noop () {}

function throttler (ms) {
  return new Transform({
    transform (chunk, cb) {
      setTimeout(() => {
        return cb(null, chunk)
      }, ms)
    }
  })
}
