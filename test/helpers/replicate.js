function replicateAll (drives, opts) {
  const streams = []
  const replicated = new Set()

  for (let i = 0; i < drives.length; i++) {
    for (let j = 0; j < drives.length; j++) {
      const source = drives[i]
      const dest = drives[j]
      if (i === j || replicated.has(j)) continue

      const s1 = source.replicate({ ...opts, live: true, encrypt: false })
      const s2 = dest.replicate({ ...opts, live: true, encrypt: false })
      streams.push([s1, s2])

      s1.pipe(s2).pipe(s1)
    }
    replicated.add(i)
  }

  return streams
}

module.exports = replicateAll
