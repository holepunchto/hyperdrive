const Hyperbee = require('hyperbee')
const Hyperblobs = require('hyperblobs')
const isOptions = require('is-options')
const { Writable, Readable } = require('streamx')
const unixPathResolve = require('unix-path-resolve')
const MirrorDrive = require('mirror-drive')
const ReadyResource = require('ready-resource')

module.exports = class Hyperdrive extends ReadyResource {
  constructor (corestore, key, opts = {}) {
    super()

    if (isOptions(key)) {
      opts = key
      key = null
    }
    const { _checkout, _db, _files, onwait } = opts
    this._onwait = onwait || null

    this.corestore = corestore
    this.db = _db || makeBee(key, corestore, this._onwait)
    this.files = _files || this.db.sub('files')
    this.blobs = null
    this.supportsMetadata = true

    this._openingBlobs = null
    this._checkout = _checkout || null
    this._batching = !!_files

    this.ready().catch(noop)
  }

  [Symbol.asyncIterator] () {
    return this.entries()[Symbol.asyncIterator]()
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

  get core () {
    return this.db.core
  }

  get version () {
    return this.db.version
  }

  findingPeers () {
    return this.db.core.findingPeers()
  }

  update (opts) {
    return this.db.core.update(opts)
  }

  checkout (len) {
    return new Hyperdrive(this.corestore, this.key, {
      onwait: this._onwait,
      _checkout: this,
      _db: this.db.checkout(len),
      _files: null
    })
  }

  batch () {
    return new Hyperdrive(this.corestore, this.key, {
      onwait: this._onwait,
      _checkout: null,
      _db: this.db,
      _files: this.files.batch()
    })
  }

  flush () {
    return this.files.flush()
  }

  async _close () {
    if (this._batching) return this.files.close()

    try {
      await this.blobs.core.close()
      await this.db.close()
    } catch {}

    if (this._checkout) return

    try {
      await this.corestore.close()
    } catch {}
  }

  async _openBlobsFromHeader (opts) {
    if (this.blobs) return true

    const header = await this.db.getHeader(opts)
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

    this.blobs = new Hyperblobs(blobsCore)

    this.emit('blobs', this.blobs)
    this.emit('content-key', blobsCore.key)

    return true
  }

  async _open () {
    if (this._checkout) return this._checkout.ready()

    await this._openBlobsFromHeader({ wait: false })

    if (this.db.core.writable && !this.blobs) {
      const blobsCore = this.corestore.get({
        name: 'blobs',
        cache: false,
        onwait: this._onwait
      })
      await blobsCore.ready()

      this.blobs = new Hyperblobs(blobsCore)
      this.db.metadata.contentFeed = this.blobs.core.key
    }

    await this.db.ready()

    if (!this.blobs) {
      // eagerly load the blob store....
      this._openingBlobs = this._openBlobsFromHeader()
      this._openingBlobs.catch(noop)
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

  async get (name) {
    const node = await this.entry(name)
    if (!node?.value.blob) return null
    await this.getBlobs()
    return this.blobs.get(node.value.blob)
  }

  async put (name, buf, { executable = false, metadata = null } = {}) {
    await this.getBlobs()
    const id = await this.blobs.put(buf)
    return this.files.put(normalizePath(name), { executable, linkname: null, blob: id, metadata })
  }

  async del (name) {
    if (!this.opened) await this.ready()
    return this.files.del(normalizePath(name))
  }

  async clear (name) {
    const node = await this.entry(name)
    if (node === null) return

    await this.getBlobs()
    await this.blobs.clear(node.value.blob)
  }

  async symlink (name, dst, { metadata = null } = {}) {
    if (!this.opened) await this.ready()
    return this.files.put(normalizePath(name), { executable: false, linkname: dst, blob: null, metadata })
  }

  entry (name) {
    return typeof name === 'string'
      ? this.files.get(normalizePath(name))
      : Promise.resolve(name)
  }

  diff (length, folder, opts) {
    if (typeof folder === 'object' && folder && !opts) return this.diff(length, null, folder)
    if (folder) {
      if (folder.endsWith('/')) folder = folder.slice(0, -1)
      if (folder) folder = normalizePath(folder)
      opts = { gt: folder + '/', lt: folder + '0', ...opts }
    }
    return this.files.createDiffStream(length, opts)
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

  entries (opts) {
    return this.files.createReadStream(opts)
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
  list (folder = '/', { recursive = true } = {}) {
    if (typeof folder === 'object') return this.list(undefined, folder)

    if (folder.endsWith('/')) folder = folder.slice(0, -1)
    if (folder) folder = normalizePath(folder)

    if (recursive === false) return shallowReadStream(this.files, folder, false)
    // '0' is binary +1 of /
    return folder ? this.entries({ gt: folder + '/', lt: folder + '0' }) : this.entries()
  }

  readdir (folder = '/') {
    if (folder.endsWith('/')) folder = folder.slice(0, -1)
    if (folder) folder = normalizePath(folder)

    return shallowReadStream(this.files, folder, true)
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
      self.files.put(normalizePath(name), { executable, linkname: null, blob: ws.id, metadata }).then(() => cb(null), cb)
    }

    function callOndrain (err) {
      if (ondrain) {
        const cb = ondrain
        ondrain = null
        cb(err)
      }
    }
  }
}

function shallowReadStream (files, folder, keys) {
  let prev = '/'
  return new Readable({
    async read (cb) {
      let node = null

      try {
        node = await files.peek({
          gt: folder + prev,
          lt: folder + '0'
        })
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

      prev = '/' + name + '0'

      this.push(keys ? name : node)
      cb(null)
    }
  })
}

function noop () {}

function makeBee (key, corestore, onwait) {
  const metadataOpts = key
    ? { key, cache: true, onwait }
    : { name: 'db', cache: true, onwait }
  const core = corestore.get(metadataOpts)
  const metadata = { contentFeed: null }
  return new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'json', metadata })
}

function normalizePath (name) {
  return unixPathResolve('/', name)
}
