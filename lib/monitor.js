const ReadyResource = require('ready-resource')

module.exports = class Monitor extends ReadyResource {
  constructor (drive, opts = {}) {
    super()
    this.drive = drive
    this.blobs = null
    this.name = opts.name
    this.entry = opts.entry
    this.upload = opts.upload !== false && opts.download !== true
    this.download = opts.download !== false && !this.upload

    this._boundOnAppend = this._onAppend.bind(this)
    this._boundOnUpload = this._onUpload.bind(this)
    this._boundOnDownload = this._onDownload.bind(this)
    this.drive.on('close', () => this.close())

    this.stats = {
      type: this.upload ? 'upload' : 'download',
      startTime: 0,
      percentage: 0,
      speed: null,
      blocks: null,
      bytes: null,
      totalBytes: null,
      totalBlocks: null
    }
  }

  async _open () {
    await this.drive.ready()
    this.blobs = await this.drive.getBlobs()
    this.entry = await this.drive.entry(this.name)
    if (this.entry) this._setEntryInfo()
    // Handlers
    this.blobs.core.on('append', this._boundOnAppend)
    if (this.upload) this.blobs.core.on('upload', this._boundOnUpload)
    if (this.download) this.blobs.core.on('download', this._boundOnDownload)
  }

  async _close () {
    this.blobs.core.off('append', this._boundOnAppend)
    if (this.upload) this.blobs.core.off('upload', this._boundOnUpload)
    if (this.download) this.blobs.core.off('download', this._boundOnDownload)
  }

  async _onAppend () {
    if (this.entry) return
    await new Promise(resolve => setImmediate(resolve))
    this.entry = await this.drive.entry(this.name)
    if (this.entry) this._setEntryInfo()
  }

  async _onUpload (index, bytes, from) {
    this._updateStats(index, bytes)
    this.emit('update', { stats: this.stats })
  }

  async _onDownload (index, bytes, from) {
    this._updateStats(index, bytes)
    this.emit('update', { stats: this.stats })
  }

  _setEntryInfo () {
    if (this.stats.totalBytes || this.stats.totalBlocks) return
    this.stats.totalBytes = this.entry.value.blob.byteLength
    this.stats.totalBlocks = this.entry.value.blob.blockLength
  }

  _updateStats (index, bytes) {
    if (!this.entry) return
    if (!isWithinRange(index, this.entry)) return
    if (!this.stats.startTime) this.stats.startTime = Date.now()

    this.stats.blocks++
    this.stats.bytes += bytes
    this.stats.percentage = Number(((this.stats.bytes / this.stats.totalBytes) * 100).toFixed(2))
    const timeElapsed = (Date.now() - this.stats.startTime) / 1000
    if (timeElapsed > 0) {
      this.stats.speed = Math.floor(this.stats.bytes / timeElapsed) // Speed in bytes/sec
    }
  }
}

function isWithinRange (index, entry) {
  if (!entry || !entry.value) return
  const { blockOffset, blockLength } = entry.value.blob
  return index >= blockOffset && index < blockOffset + blockLength
}
