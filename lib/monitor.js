const ReadyResource = require('ready-resource')
const debounce = require('debounceify')
const safetyCatch = require('safety-catch')

module.exports = class Monitor extends ReadyResource {
  constructor (drive, opts = {}) {
    super()
    this.drive = drive
    this.blobs = null
    this.name = opts.name
    this.entry = opts.entry
    this.isDownload = opts.download === true

    this._boundOnAppend = debounce(this._onAppend.bind(this))
    this._boundOnUpload = this._onUpload.bind(this)
    this._boundOnDownload = this._onDownload.bind(this)
    this.drive.on('close', () => this.close())

    // Updated on each upload/download event
    this.stats = {
      startTime: 0,
      percentage: 0,
      peersCount: 0,
      speed: null,
      blocks: null,
      totalBytes: null, // local + bytes loaded during monitoring
      monitoringBytes: null, // bytes loaded during monitoring
      targetBytes: null,
      targetBlocks: null
    }
  }

  async _open () {
    await this.drive.ready()
    this.blobs = await this.drive.getBlobs()
    this.entry = await this.drive.entry(this.name)
    if (this.entry) this._setEntryInfo()

    // load the local state for the file.
    // upload is a bit more tricky
    if (this.entry && this.isDownload) {
      await this._loadLocalState().catch(safetyCatch).finally(() => {
        this._calculateStats()
        this.emit('update')
      })
    }

    // Handlers
    this.blobs.core.on('append', this._boundOnAppend)
    this.blobs.core.on('upload', this._boundOnUpload)
    this.blobs.core.on('download', this._boundOnDownload)
  }

  async _close () {
    this.blobs.core.off('append', this._boundOnAppend)
    this.blobs.core.off('upload', this._boundOnUpload)
    this.blobs.core.off('download', this._boundOnDownload)
  }

  async _onAppend () {
    if (this.entry) return
    await new Promise(resolve => setImmediate(resolve))
    this.entry = await this.drive.entry(this.name)
    if (this.entry) this._setEntryInfo()
  }

  _setEntryInfo () {
    if (this.stats.targetBytes || this.stats.targetBlocks) return
    this.stats.targetBytes = this.entry.value.blob.byteLength
    this.stats.targetBlocks = this.entry.value.blob.blockLength
    this.stats.blockOffset = this.entry.value.blob.blockOffset
    this.stats.byteOffset = this.entry.value.blob.byteOffset
  }

  async _onUpload (index, bytes, from) {
    this._updateStats(index, bytes, from)
  }

  async _onDownload (index, bytes, from) {
    this._updateStats(index, bytes, from)
  }

  async _loadLocalState () {
    // TODO: think this will only work if its linear
    const stream = this.blobs.createReadStream(this.entry.value.blob, { wait: false })
    for await (const bytes of stream) {
      this.stats.totalBytes += bytes.length
      this.stats.blocks++
    }
  }

  _updateStats (index, bytes, from) {
    if (!this.entry || this.closing) return
    if (!isWithinRange(index, this.entry)) return

    this.stats.peersCount = from.replicator.peers.length
    this.stats.blocks++
    this.stats.monitoringBytes += bytes
    this.stats.totalBytes += bytes

    this._calculateStats()
    this.emit('update')
  }

  _calculateStats () {
    if (!this.stats.startTime) this.stats.startTime = Date.now()
    this.stats.percentage = Number(((this.stats.totalBytes / this.stats.targetBytes) * 100).toFixed(2))
    const timeElapsed = (Date.now() - this.stats.startTime) / 1000
    if (timeElapsed > 0) {
      this.stats.speed = Math.floor(this.stats.monitoringBytes / timeElapsed) // Speed in bytes/sec
    }
  }
}

function isWithinRange (index, entry) {
  if (!entry || !entry.value) return
  const { blockOffset, blockLength } = entry.value.blob
  return index >= blockOffset && index < blockOffset + blockLength
}
