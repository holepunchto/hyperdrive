const Hyperbee = require('hyperbee')
const Hyperblobs = require('hyperblobs')
const isOptions = require('is-options')
const { Writable, Readable } = require('streamx')
const unixPathResolve = require('unix-path-resolve')
const MirrorDrive = require('mirror-drive')
const SubEncoder = require('sub-encoder')
const ReadyResource = require('ready-resource')
const safetyCatch = require('safety-catch')

const keyEncoding = new SubEncoder('files', 'utf-8')

module.exports = class Hyperdrive extends ReadyResource {
  constructor (corestore, key, opts = {}) {
    super()

    if (isOptions(key)) {
      opts = key
      key = null
    }

    this.corestore = corestore
    this.db = opts._db || makeBee(key, corestore, opts)
    this.core = this.db.core
    this.blobs = null
    this.supportsMetadata = true

    this._openingBlobs = null
    this._onwait = opts.onwait || null
    this._batching = !!(opts._checkout === null && opts._db)
    this._checkout = opts._checkout || null

    this.ready().catch(safetyCatch)
  }

  [Symbol.asyncIterator] () {
    return this.entries()[Symbol.asyncIterator]()
  }

  get id () {
    return this.core.id
  }

  get key () {
    return this.core.key
  }

  get discoveryKey () {
    return this.core.discoveryKey
  }

  get contentKey () {
    return this.blobs?.core.key
  }

  get version () {
    return this.db.version
  }

  get writable () {
    return this.core.writable
  }

  get readable () {
    return this.core.readable
  }

  findingPeers () {
    return this.corestore.findingPeers()
  }

  replicate (isInitiator, opts) {
    return this.corestore.replicate(isInitiator, opts)
  }

  update (opts) {
    return this.db.update(opts)
  }

  _makeCheckout (snapshot) {
    return new Hyperdrive(this.corestore, this.key, {
      onwait: this._onwait,
      _checkout: this._checkout || this,
      _db: snapshot
    })
  }

  checkout (version) {
    return this._makeCheckout(this.db.checkout(version))
  }

  batch () {
    return new Hyperdrive(this.corestore, this.key, {
      onwait: this._onwait,
      _checkout: null,
      _db: this.db.batch()
    })
  }

  async flush () {
    await this.db.flush()
    return this.close()
  }

  async _close () {
    if (this.blobs && (!this._checkout || this.blobs !== this._checkout.blobs)) {
      await this.blobs.core.close()
    }

    await this.db.close()

    if (!this._checkout && !this._batching) {
      await this.corestore.close()
    }
  }

  async _openBlobsFromHeader (opts) {
    if (this.blobs) return true

    const header = await getBee(this.db).getHeader(opts)
    if (!header) return false

    if (this.blobs) return true

    const blobsKey = header.metadata && header.metadata.contentFeed.subarray(0, 32)
    if (!blobsKey || blobsKey.length < 32) throw new Error('Invalid or no Blob store key set')

    const blobsCore = this.corestore.get({
      key: blobsKey,
      cache: false,
      onwait: this._onwait
    })
    await blobsCore.ready()

    if (this.closing) {
      await blobsCore.close()
      return false
    }

    this.blobs = new Hyperblobs(blobsCore)

    this.emit('blobs', this.blobs)
    this.emit('content-key', blobsCore.key)

    return true
  }

  async _open () {
    if (this._checkout) {
      await this._checkout.ready()
      this.blobs = this._checkout.blobs
      return
    }

    await this._openBlobsFromHeader({ wait: false })

    if (this.db.core.writable && !this.blobs) {
      const blobsCore = this.corestore.get({
        name: 'blobs',
        cache: false,
        onwait: this._onwait
      })
      await blobsCore.ready()

      this.blobs = new Hyperblobs(blobsCore)
      getBee(this.db).metadata.contentFeed = this.blobs.core.key

      this.emit('blobs', this.blobs)
      this.emit('content-key', blobsCore.key)
    }

    await this.db.ready()

    if (!this.blobs) {
      // eagerly load the blob store....
      this._openingBlobs = this._openBlobsFromHeader()
      this._openingBlobs.catch(safetyCatch)
    }
  }

  async getBlobs () {
    if (this.blobs) return this.blobs

    if (this._checkout) {
      this.blobs = await this._checkout.getBlobs()
    } else {
      await this.ready()
      await this._openingBlobs
    }

    return this.blobs
  }

  async get (name, opts) {
    const node = await this.entry(name, opts)
    if (!node?.value.blob) return null
    await this.getBlobs()
    return this.blobs.get(node.value.blob, opts)
  }

  async put (name, buf, { executable = false, metadata = null } = {}) {
    await this.getBlobs()
    const blob = await this.blobs.put(buf)
    return this.db.put(std(name, false), { executable, linkname: null, blob, metadata }, { keyEncoding })
  }

  async del (name) {
    return this.db.del(std(name, false), { keyEncoding })
  }

  compare (a, b) {
    const diff = a.seq - b.seq
    return diff > 0 ? 1 : (diff < 0 ? -1 : 0)
  }

  async clear (name, opts) {
    if (!this.opened) await this.ready()

    let node = null

    try {
      node = await this.entry(name, { wait: false })
    } catch {
      // do nothing, prop not available
    }

    if (node === null || this.blobs === null) {
      return (opts && opts.diff) ? { blocks: 0 } : null
    }

    return this.blobs.clear(node.value.blob, opts)
  }

  async clearAll (opts) {
    if (!this.opened) await this.ready()

    if (this.blobs === null) {
      return (opts && opts.diff) ? { blocks: 0 } : null
    }

    return this.blobs.core.clear(0, this.blobs.core.length, opts)
  }

  async purge () {
    if (this._checkout || this._batch) throw new Error('Can only purge the main session')

    await this.ready() // Ensure blobs loaded if present
    await this.close()

    const proms = [this.core.purge()]
    if (this.blobs) proms.push(this.blobs.core.purge())
    await Promise.all(proms)
  }

  async symlink (name, dst, { metadata = null } = {}) {
    return this.db.put(std(name, false), { executable: false, linkname: dst, blob: null, metadata }, { keyEncoding })
  }

  async entry (name, opts) {
    if (!opts || !opts.follow) return this._entry(name, opts)

    for (let i = 0; i < 16; i++) {
      const node = await this._entry(name, opts)
      if (!node || !node.value.linkname) return node

      name = unixPathResolve(node.key, node.value.linkname)
    }

    throw new Error('Recursive symlink')
  }

  async _entry (name, opts) {
    if (typeof name !== 'string') return name

    return this.db.get(std(name, false), { ...opts, keyEncoding })
  }

  async exists (name) {
    return await this.entry(name) !== null
  }

  watch (folder) {
    folder = std(folder || '/', true)

    return this.db.watch(prefixRange(folder), { keyEncoding, map: (snap) => this._makeCheckout(snap) })
  }

  diff (length, folder, opts) {
    if (typeof folder === 'object' && folder && !opts) return this.diff(length, null, folder)

    folder = std(folder || '/', true)

    return this.db.createDiffStream(length, prefixRange(folder), { ...opts, keyEncoding })
  }

  async downloadDiff (length, folder, opts) {
    const dls = []

    for await (const entry of this.diff(length, folder, opts)) {
      if (!entry.left) continue
      const b = entry.left.value.blob
      if (!b) continue
      const blobs = await this.getBlobs()
      dls.push(blobs.core.download({ start: b.blockOffset, length: b.blockLength }))
    }

    const proms = []
    for (const r of dls) proms.push(r.downloaded())

    await Promise.allSettled(proms)
  }

  async downloadRange (dbRanges, blobRanges) {
    const dls = []

    await this.ready()

    for (const range of dbRanges) {
      dls.push(this.db.core.download(range))
    }

    const blobs = await this.getBlobs()

    for (const range of blobRanges) {
      dls.push(blobs.core.download(range))
    }

    const proms = []
    for (const r of dls) proms.push(r.downloaded())

    await Promise.allSettled(proms)
  }

  entries (range, opts) {
    return this.db.createReadStream(range, { ...opts, keyEncoding })
  }

  async download (folder = '/', opts) {
    if (typeof folder === 'object') return this.download(undefined, folder)

    const dls = []

    for await (const entry of this.list(folder, opts)) {
      const b = entry.value.blob
      if (!b) continue

      const blobs = await this.getBlobs()
      dls.push(blobs.core.download({ start: b.blockOffset, length: b.blockLength }))
    }

    const proms = []
    for (const r of dls) proms.push(r.downloaded())

    await Promise.allSettled(proms)
  }

  // atm always recursive, but we should add some depth thing to it
  list (folder, opts) {
    if (typeof folder === 'object') return this.list(undefined, folder)

    folder = std(folder || '/', true)

    if (opts && opts.recursive === false) return shallowReadStream(this.db, folder, false)

    return this.entries(prefixRange(folder))
  }

  readdir (folder) {
    folder = std(folder || '/', true)
    return shallowReadStream(this.db, folder, true)
  }

  mirror (out, opts) {
    return new MirrorDrive(this, out, opts)
  }

  createReadStream (name, opts) {
    const self = this

    let destroyed = false
    let rs = null

    const stream = new Readable({
      open (cb) {
        self.getBlobs().then(onblobs, cb)

        function onblobs () {
          self.entry(name).then(onnode, cb)
        }

        function onnode (node) {
          if (destroyed) return cb(null)
          if (!node) return cb(new Error('Blob does not exist'))

          if (!node.value.blob) {
            stream.push(null)
            return cb(null)
          }

          rs = self.blobs.createReadStream(node.value.blob, opts)

          rs.on('data', function (data) {
            if (!stream.push(data)) rs.pause()
          })

          rs.on('end', function () {
            stream.push(null)
          })

          rs.on('error', function (err) {
            stream.destroy(err)
          })

          cb(null)
        }
      },
      read (cb) {
        rs.resume()
        cb(null)
      },
      predestroy () {
        destroyed = true
        if (rs) rs.destroy()
      }
    })

    return stream
  }

  createWriteStream (name, { executable = false, metadata = null } = {}) {
    const self = this

    let destroyed = false
    let ws = null
    let ondrain = null
    let onfinish = null

    const stream = new Writable({
      open (cb) {
        self.getBlobs().then(onblobs, cb)

        function onblobs () {
          if (destroyed) return cb(null)

          ws = self.blobs.createWriteStream()

          ws.on('error', function (err) {
            stream.destroy(err)
          })

          ws.on('close', function () {
            const err = new Error('Closed')
            callOndrain(err)
            callOnfinish(err)
          })

          ws.on('finish', function () {
            callOnfinish(null)
          })

          ws.on('drain', function () {
            callOndrain(null)
          })

          cb(null)
        }
      },
      write (data, cb) {
        if (ws.write(data) === true) return cb(null)
        ondrain = cb
      },
      final (cb) {
        onfinish = cb
        ws.end()
      },
      predestroy () {
        destroyed = true
        if (ws) ws.destroy()
      }
    })

    return stream

    function callOnfinish (err) {
      if (!onfinish) return

      const cb = onfinish
      onfinish = null

      if (err) return cb(err)
      self.db.put(std(name, false), { executable, linkname: null, blob: ws.id, metadata }, { keyEncoding }).then(() => cb(null), cb)
    }

    function callOndrain (err) {
      if (ondrain) {
        const cb = ondrain
        ondrain = null
        cb(err)
      }
    }
  }

  static normalizePath (name) {
    return std(name, false)
  }
}

function shallowReadStream (files, folder, keys) {
  let prev = '/'
  let prevName = ''

  return new Readable({
    async read (cb) {
      let node = null

      try {
        node = await files.peek(prefixRange(folder, prev), { keyEncoding })
      } catch (err) {
        return cb(err)
      }

      if (!node) {
        this.push(null)
        return cb(null)
      }

      const suffix = node.key.slice(folder.length + 1)
      const i = suffix.indexOf('/')
      const name = i === -1 ? suffix : suffix.slice(0, i)

      prev = '/' + name + (i === -1 ? '' : '0')

      // just in case someone does /foo + /foo/bar, but we should prop not even support that
      if (name === prevName) {
        this._read(cb)
        return
      }

      prevName = name
      this.push(keys ? name : node)
      cb(null)
    }
  })
}

function makeBee (key, corestore, opts) {
  const name = key ? undefined : 'db'
  const core = corestore.get({ key, name, cache: true, exclusive: true, onwait: opts.onwait })

  return new Hyperbee(core, {
    keyEncoding: 'utf-8',
    valueEncoding: 'json',
    metadata: { contentFeed: null }
  })
}

function getBee (bee) {
  // A Batch instance will have a .tree property for the actual Hyperbee
  return bee.tree || bee
}

function std (name, removeSlash) {
  // Note: only remove slash if you're going to use it as prefix range
  name = unixPathResolve('/', name)
  if (removeSlash && name.endsWith('/')) name = name.slice(0, -1)
  validateFilename(name)
  return name
}

function validateFilename (name) {
  if (name === '/') throw new Error('Invalid filename: ' + name)
}

function prefixRange (name, prev = '/') {
  // '0' is binary +1 of /
  return { gt: name + prev, lt: name + '0' }
}
