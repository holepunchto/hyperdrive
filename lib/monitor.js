const ReadyResource = require('ready-resource')
const speedometer = require('speedometer')
const debounce = require('debounceify')

module.exports = class Monitor extends ReadyResource {
  constructor (drive, opts = {}) {
    super()
    this.drive = drive
    this.blobs = null
    this.name = opts.name
    this.entry = opts.entry

    this._boundOnAppend = debounce(this._onAppend.bind(this))
    this._boundOnUpload = this._onUpload.bind(this)
    this._boundOnDownload = this._onDownload.bind(this)
    this.drive.on('close', () => this.close())

    const stats = {
      startTime: 0,
      percentage: 0,
      peersCount: 0,
      speed: 0,
      blocks: 0,
      totalBytes: 0, // local + bytes loaded during monitoring
      monitoringBytes: 0, // bytes loaded during monitoring
      targetBytes: 0,
      targetBlocks: 0
    }

    // Updated on each upload/download event
    this.uploadStats = { ...stats }
    this.downloadStats = { ...stats }

    this.uploadSpeedometer = null
    this.downloadSpeedometer = null
  }

  async _open () {
    await this.drive.ready()
    this.blobs = await this.drive.getBlobs()
    this.entry = await this.drive.entry(this.name)
    if (this.entry) this._setEntryInfo()

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
    if (!this.downloadStats.targetBytes || !this.downloadStats.targetBlocks) {
      this.downloadStats.targetBytes = this.entry.value.blob.byteLength
      this.downloadStats.targetBlocks = this.entry.value.blob.blockLength
    }

    if (!this.uploadStats.targetBytes || !this.uploadStats.targetBlocks) {
      this.uploadStats.targetBytes = this.entry.value.blob.byteLength
      this.uploadStats.targetBlocks = this.entry.value.blob.blockLength
    }
  }

  _onUpload (index, bytes, from) {
    if (!this.uploadSpeedometer) this.uploadSpeedometer = speedometer()
    this.uploadStats.speed = this.uploadSpeedometer(bytes)
    this._updateStats(this.uploadStats, index, bytes, from)
  }

  _onDownload (index, bytes, from) {
    if (!this.downloadSpeedometer) this.downloadSpeedometer = speedometer()
    this.downloadStats.speed = this.downloadSpeedometer(bytes)
    this._updateStats(this.downloadStats, index, bytes, from)
  }

  _updateStats (stats, index, bytes, from) {
    if (!this.entry || this.closing) return
    if (!isWithinRange(index, this.entry)) return

    if (!stats.startTime) stats.startTime = Date.now()
    stats.peersCount = from.replicator.peers.length
    stats.blocks++
    stats.monitoringBytes += bytes
    stats.totalBytes += bytes
    stats.percentage = Number(((stats.totalBytes / stats.targetBytes) * 100).toFixed(2))

    this.emit('update')
  }

  downloadSpeed () {
    return this.downloadSpeedometer ? this.downloadSpeedometer() : 0
  }

  uploadSpeed () {
    return this.uploadSpeedometer ? this.uploadSpeedometer() : 0
  }
}

function isWithinRange (index, entry) {
  if (!entry || !entry.value) return
  const { blockOffset, blockLength } = entry.value.blob
  return index >= blockOffset && index < blockOffset + blockLength
}
