const pumpify = require('pumpify')
const through = require('through2')

function replicateAll (drives, opts) {
  const streams = []
  const replicated = new Set()

  for (let i = 0; i < drives.length; i++) {
    for (let j = 0; j < drives.length; j++) {
      const source = drives[i]
      const dest = drives[j]
      if (i === j || replicated.has(j)) continue

      var s1 = source.replicate(true, { ...opts, live: true })
      var s2 = dest.replicate(false, { ...opts, live: true })

      if (opts && opts.throttle) {
        s1 = pumpify(s1, throttler(opts.throttle))
        s2 = pumpify(s2, throttler(opts.throttle))
      }

      streams.push([s1, s2])

      s1.pipe(s2).pipe(s1)
    }
    replicated.add(i)
  }

  return streams
}

function throttler (ms) {
  return through.obj((chunk, enc, cb) => {
    setTimeout(() => {
      return cb(null, chunk)
    }, ms)
  })
}

module.exports = replicateAll
