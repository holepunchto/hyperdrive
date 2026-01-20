const Hyperbee = require('hyperbee2')
const Hyperblobs = require('hyperblobs')
const isOptions = require('is-options')
const { Writable, Readable, Transform, pipeline } = require('streamx')
const unixPathResolve = require('unix-path-resolve')
const MirrorDrive = require('mirror-drive')
const SubEncoder = require('sub-encoder')
const ReadyResource = require('ready-resource')
const safetyCatch = require('safety-catch')
const crypto = require('hypercore-crypto')
const Hypercore = require('hypercore')
const { BLOCK_NOT_AVAILABLE, BAD_ARGUMENT } = require('hypercore-errors')
const Monitor = require('./lib/monitor')
const Download = require('./lib/download')
const c = require('compact-encoding')

const keyEncoding = new SubEncoder('files', 'utf-8')
const writeEncoding = require('./lib/encoding')

const [BLOBS] = crypto.namespace('hyperdrive', 1)

module.exports = class Hyperdrive extends ReadyResource {
  constructor(corestore, key, opts = {}) {
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
    this.encryptionKey = opts.encryptionKey || null
    this.monitors = new Set()

    this._active = opts.active !== false
    this._openingBlobs = null
    this._onwait = opts.onwait || null
    this._checkout = opts._checkout || null
    this._batch = null

    this.ready().catch(safetyCatch)
  }

  [Symbol.asyncIterator]() {
    return this.entries()[Symbol.asyncIterator]()
  }

  static async getDriveKey(corestore) {
    const core = makeBee(undefined, corestore)
    await core.ready()
    const key = core.core.key
    await core.close()
    return key
  }

  static getContentKey(m, key) {
    if (m instanceof Hypercore) {
      if (m.core.compat) return null
      return Hyperdrive.getContentKey(m.manifest, m.key)
    }

    const manifest = generateContentManifest(m, key)
    if (!manifest) return null

    return Hypercore.key(manifest)
  }

  static getContentManifest(m, key) {
    return generateContentManifest(m, key)
  }

  _generateBlobsManifest() {
    const m = this.db.core.core.manifest
    if (this.db.core.core.compat) return null

    return generateContentManifest(m, this.core.key)
  }

  get id() {
    return this.core.id
  }

  get key() {
    return this.core.key
  }

  get discoveryKey() {
    return this.core.discoveryKey
  }

  get contentKey() {
    return this.blobs?.core.key
  }

  get version() {
    return this.db.core.length
  }

  get writable() {
    return this.core.writable
  }

  get readable() {
    return this.core.readable
  }

  findingPeers() {
    return this.corestore.findingPeers()
  }

  async truncate(version, { blobs = -1 } = {}) {
    if (!this.opened) await this.ready()

    if (version > this.core.length) {
      throw BAD_ARGUMENT('Bad truncation length')
    }

    const blobsVersion = blobs === -1 ? await this.getBlobsLength(version) : blobs
    const bl = await this.getBlobs()

    if (blobsVersion > bl.core.length) {
      throw BAD_ARGUMENT('Bad truncation length')
    }

    await this.core.truncate(version)
    await this.db.update()

    await bl.core.truncate(blobsVersion)
  }

  async getBlobsLength(checkout) {
    if (!this.opened) await this.ready()

    if (!checkout) checkout = this.version

    const c = this.db.checkout({ length: checkout })

    try {
      return await getBlobsLength(c)
    } finally {
      await c.close()
    }
  }

  replicate(isInitiator, opts) {
    return this.corestore.replicate(isInitiator, opts)
  }

  update(opts) {
    return this.db.update(opts)
  }

  _makeCheckout(snapshot) {
    return new Hyperdrive(this.corestore, this.key, {
      onwait: this._onwait,
      encryptionKey: this.encryptionKey,
      _checkout: this._checkout || this,
      _db: snapshot
    })
  }

  checkout(version) {
    return this._makeCheckout(this.db.checkout({ length: version }))
  }

  batch() {
    this._batch = this.db.write()
    return this
  }

  setActive(bool) {
    const active = !!bool
    if (active === this._active) return
    this._active = active
    this.core.setActive(active)
    if (this.blobs) this.blobs.core.setActive(active)
  }

  async flush() {
    await this._batch.flush()
    this._batch = null
  }

  async _close() {
    if (this.blobs && (!this._checkout || this.blobs !== this._checkout.blobs)) {
      await this.blobs.core.close()
    }

    await this.db.close()

    if (!this._checkout && !this._batch) {
      await this.corestore.close()
    }

    await this.closeMonitors()
  }

  async _ensureBlobs() {
    if (this.blobs) return true

    await this.core.ready()

    const blobsKey = Hypercore.key(this._generateBlobsManifest())
    if (!blobsKey || blobsKey.length < 32) throw new Error('Invalid or no Blob store key set')

    const blobsCore = this.corestore.get({
      key: blobsKey,
      cache: false,
      onwait: this._onwait,
      encryptionKey: this.encryptionKey,
      keyPair: this.db.core.writable ? this.db.core.keyPair : null,
      active: this._active
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

  async _open() {
    if (this._checkout) {
      await this._checkout.ready()
      this.blobs = this._checkout.blobs
      return
    }

    await this.db.ready()

    if (this.db.core.writable && !this.blobs) {
      const m = this._generateBlobsManifest()
      const blobsCore = this.corestore.get({
        manifest: m,
        name: m ? null : this.db.core.id + '/blobs', // simple trick to avoid blobs clashing if no namespace is provided...
        cache: false,
        onwait: this._onwait,
        encryptionKey: this.encryptionKey,
        compat: this.db.core.core.compat,
        active: this._active,
        keyPair: m && this.db.core.writable ? this.db.core.keyPair : null
      })
      await blobsCore.ready()

      this.blobs = new Hyperblobs(blobsCore)

      if (!m) getBee(this.db).metadata.contentFeed = this.blobs.core.key

      this.emit('blobs', this.blobs)
      this.emit('content-key', blobsCore.key)
    }
  }

  async getBlobs() {
    await this._ensureBlobs()
    if (this.blobs) return this.blobs

    if (this._checkout) {
      this.blobs = await this._checkout.getBlobs()
    } else {
      await this.ready()
      await this._openingBlobs
    }

    return this.blobs
  }

  monitor(name, opts = {}) {
    const monitor = new Monitor(this, { name, ...opts })
    this.monitors.add(monitor)
    return monitor
  }

  async closeMonitors() {
    const closing = []
    for (const monitor of this.monitors) closing.push(monitor.close())
    await Promise.allSettled(closing)
  }

  async get(name, opts) {
    await this._ensureBlobs()
    const node = await this.entry(name, opts)
    if (!node?.value.blob) return null
    await this.getBlobs()
    const res = await this.blobs.get(node.value.blob, opts)

    if (res === null) throw BLOCK_NOT_AVAILABLE()
    return res
  }

  async put(name, buf, { executable = false, metadata = null } = {}) {
    await this.getBlobs()
    const blob = await this.blobs.put(buf)
    const w = this._batch || this.db.write()
    w.tryPut(
      Buffer.from(std(name, false)),
      c.encode(writeEncoding, { executable, linkname: null, blob, metadata })
    )

    if (!this._batch) {
      return w.flush()
    }
  }

  async del(name) {
    const w = this.db.write()
    w.tryDelete(Buffer.from(std(name, false)))
    return w.flush()
  }

  compare(a, b) {
    const diff = a.seq - b.seq
    return diff > 0 ? 1 : diff < 0 ? -1 : 0
  }

  async clear(name, opts) {
    if (!this.opened) await this.ready()

    let node = null

    try {
      node = await this.entry(name, { wait: false })
    } catch {
      // do nothing, prop not available
    }

    if (node === null || this.blobs === null) {
      return opts && opts.diff ? { blocks: 0 } : null
    }

    return this.blobs.clear(node.value.blob, opts)
  }

  async clearAll(opts) {
    if (!this.opened) await this.ready()

    if (this.blobs === null) {
      return opts && opts.diff ? { blocks: 0 } : null
    }

    return this.blobs.core.clear(0, this.blobs.core.length, opts)
  }

  async purge() {
    if (this._checkout || this._batch) throw new Error('Can only purge the main session')

    await this.ready() // Ensure blobs loaded if present
    await this.close()

    const proms = [this.core.purge()]
    if (this.blobs) proms.push(this.blobs.core.purge())
    await Promise.all(proms)
  }

  async symlink(name, dst, { metadata = null } = {}) {
    const w = this.db.write()
    w.tryPut(
      Buffer.from(std(name, false)),
      c.encode(writeEncoding, { executable: false, linkname: dst, metadata })
    )
    return w.flush()
  }

  async entry(name, opts) {
    await this._ensureBlobs()

    if (!opts || !opts.follow) return this._entry(name, opts)

    for (let i = 0; i < 16; i++) {
      const node = await this._entry(name, opts)
      if (!node || !node.value.linkname) return node

      name = unixPathResolve(node.key, node.value.linkname)
    }

    throw new Error('Recursive symlink')
  }

  async _entry(name, opts) {
    if (typeof name !== 'string') return name

    const node = await this.db.get(Buffer.from(std(name, false)), { ...opts })
    if (!node) return null

    return { key: node.key.toString(), seq: node.seq, value: c.decode(writeEncoding, node.value) }
  }

  async exists(name) {
    return (await this.entry(name)) !== null
  }

  diff(length, folder, opts) {
    if (typeof folder === 'object' && folder && !opts) return this.diff(length, null, folder)

    folder = std(folder || '/', true)

    const snap = this.db.checkout({ length })
    const range = prefixRange(folder)

    const decodeNode = (node) => {
      if (!node) return null

      return {
        key: node.key.toString(),
        value: c.decode(writeEncoding, node.value)
      }
    }

    const transform = new Transform({
      transform(from, cb) {
        this.push({
          left: decodeNode(from.left),
          right: decodeNode(from.right)
        })
        cb()
      }
    })

    const stream = pipeline(this.db.createDiffStream(snap, { ...opts, ...range }), transform)
    return stream
  }

  async downloadDiff(length, folder, opts) {
    await this._ensureBlobs()
    const dls = []

    for await (const entry of this.diff(length, folder, opts)) {
      if (!entry.left) continue
      const b = entry.left.value.blob
      if (!b) continue
      const blobs = await this.getBlobs()
      dls.push(blobs.core.download({ start: b.blockOffset, length: b.blockLength }))
    }

    return new Download(this, null, { downloads: dls })
  }

  async downloadRange(dbRanges, blobRanges) {
    await this._ensureBlobs()
    const dls = []

    await this.ready()

    for (const range of dbRanges) {
      dls.push(this.db.core.download(range))
    }

    const blobs = await this.getBlobs()

    for (const range of blobRanges) {
      dls.push(blobs.core.download(range))
    }

    return new Download(this, null, { downloads: dls })
  }

  entries(range = {}, opts = {}) {
    const transform = new Transform({
      transform(from, cb) {
        this.push({ key: from.key.toString(), value: c.decode(writeEncoding, from.value) })
        cb()
      }
    })
    const stream = pipeline(
      this.db.createReadStream({ ...opts, ...transformRange(range) }),
      transform
    )
    if (opts && opts.ignore) stream._readableState.map = createStreamMapIgnore(opts.ignore)
    return stream
  }

  download(folder = '/', opts) {
    if (typeof folder === 'object') return this.download(undefined, folder)

    return new Download(this, folder, opts)
  }

  async has(path) {
    await this._ensureBlobs()
    const blobs = await this.getBlobs()
    const entry = !path || path.endsWith('/') ? null : await this.entry(path)
    if (entry) {
      const b = entry.value.blob
      if (!b) return false
      return await blobs.core.has(b.blockOffset, b.blockOffset + b.blockLength)
    }
    for await (const entry of this.list(path)) {
      const b = entry.value.blob
      if (!b) continue
      const has = await blobs.core.has(b.blockOffset, b.blockOffset + b.blockLength)
      if (!has) return false
    }
    return true
  }

  // atm always recursive, but we should add some depth thing to it
  list(folder, opts = {}) {
    if (typeof folder === 'object' && folder !== null) return this.list(undefined, folder)

    folder = std(folder || '/', true)

    const ignore = opts.ignore ? toIgnoreFunction(opts.ignore) : null
    const stream =
      opts && opts.recursive === false
        ? shallowReadStream(this.db, folder, false, ignore, opts)
        : this.entries(prefixRange(folder), { ...opts, ignore })
    return stream
  }

  readdir(folder, opts) {
    folder = std(folder || '/', true)
    return shallowReadStream(this.db, folder, true, null, opts)
  }

  mirror(out, opts) {
    return new MirrorDrive(this, out, opts)
  }

  createReadStream(name, opts) {
    const self = this

    let destroyed = false
    let rs = null

    const stream = new Readable({
      open(cb) {
        self.getBlobs().then(onblobs, cb)

        function onblobs() {
          self.entry(name).then(onnode, cb)
        }

        function onnode(node) {
          if (destroyed) return cb(null)
          if (!node) return cb(new Error('Blob does not exist'))
          if (self.closing) return cb(new Error('Closed'))

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
      read(cb) {
        rs.resume()
        cb(null)
      },
      predestroy() {
        destroyed = true
        if (rs) rs.destroy()
      }
    })

    return stream
  }

  createWriteStream(name, { executable = false, metadata = null } = {}) {
    const self = this

    let destroyed = false
    let ws = null
    let ondrain = null
    let onfinish = null

    const stream = new Writable({
      open(cb) {
        self.getBlobs().then(onblobs, cb)

        function onblobs() {
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
      write(data, cb) {
        if (ws.write(data) === true) return cb(null)
        ondrain = cb
      },
      final(cb) {
        onfinish = cb
        ws.end()
      },
      predestroy() {
        destroyed = true
        if (ws) ws.destroy()
      }
    })

    return stream

    function callOnfinish(err) {
      if (!onfinish) return

      const cb = onfinish
      onfinish = null

      if (err) return cb(err)

      const w = self.db.write()
      w.tryPut(
        Buffer.from(std(name, false)),
        c.encode(writeEncoding, { executable, linkname: null, blob: ws.id, metadata })
      )
      w.flush().then(() => cb(null), cb)
    }

    function callOndrain(err) {
      if (ondrain) {
        const cb = ondrain
        ondrain = null
        cb(err)
      }
    }
  }

  static normalizePath(name) {
    return std(name, false)
  }
}

function shallowReadStream(files, folder, keys, ignore, opts) {
  let prev = '/'
  let prevName = ''

  return new Readable({
    async read(cb) {
      let node = null

      try {
        node = await files.peek(prefixRange(folder, prev), {
          ...opts,
          keyEncoding
        })
      } catch (err) {
        return cb(err)
      }

      if (!node) {
        this.push(null)
        return cb(null)
      }

      node.key = node.key.toString()
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

      if (ignore && ignore(node.key)) {
        this._read(cb)
        return
      }

      this.push(keys ? name.toString() : node)
      cb(null)
    }
  })
}

function makeBee(key, corestore, opts = {}) {
  return new Hyperbee(corestore, {
    key,
    exclusive: true,
    onwait: opts.onwait,
    encryptionKey: opts.encryptionKey,
    compat: opts.compat,
    active: opts.active,
    autoUpdate: true
  })
}

function getBee(bee) {
  // A Batch instance will have a .tree property for the actual Hyperbee
  return bee.tree || bee
}

function std(name, removeSlash) {
  // Note: only remove slash if you're going to use it as prefix range
  name = unixPathResolve('/', name)
  if (removeSlash && name.endsWith('/')) name = name.slice(0, -1)
  validateFilename(name)
  return name
}

function validateFilename(name) {
  if (name === '/') throw new Error('Invalid filename: ' + name)
}

function prefixRange(name, prev = '/') {
  // '0' is binary +1 of /
  return { gt: Buffer.from(name + prev), lt: Buffer.from(name + '0') }
}

function generateContentManifest(m, key) {
  if (m.version < 1) return null

  const signers = []

  if (!key) key = Hypercore.key(m)

  for (const s of m.signers) {
    const namespace = crypto.hash([BLOBS, key, s.namespace])
    signers.push({ ...s, namespace })
  }

  return {
    version: m.version,
    hash: 'blake2b',
    allowPatch: m.allowPatch,
    quorum: m.quorum,
    signers,
    prologue: null // TODO: could be configurable through the header still...
  }
}

async function getBlobsLength(db) {
  let length = 0
  for await (const { value } of db.createReadStream()) {
    const b = value ? c.decode(writeEncoding, value) : null
    if (!b) continue
    const len = b.blob.blockOffset + b.blob.blockLength
    if (len > length) length = len
  }

  return length
}

function toIgnoreFunction(ignore) {
  if (typeof ignore === 'function') return ignore

  const all = [].concat(ignore).map((e) => unixPathResolve('/', e))
  return (key) =>
    all.some((path) => path === key.toString() || key.toString().startsWith(path + '/'))
}

function createStreamMapIgnore(ignore) {
  return (node) => (ignore(node.key) ? null : node)
}

function transformRange(range) {
  return {
    gt: range.gt ? Buffer.from(range.gt) : range.gt,
    gte: range.gte ? Buffer.from(range.gte) : range.gte,
    lt: range.lt ? Buffer.from(range.lt) : range.lt,
    lte: range.lte ? Buffer.from(range.lte) : range.lte
  }
}
