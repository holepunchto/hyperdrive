const ReadyResource = require('ready-resource')
const safetyCatch = require('safety-catch')
const speedometer = require('speedometer')

module.exports = class Monitor extends ReadyResource {
  constructor(drive, opts = {}) {
    super()
    this.drive = drive
    this.blobs = null
    this.name = opts.name || null
    this.entry = opts.entry || null
    this.peers = 0

    this._boundOnBlobUpload = this._onUpload.bind(this, false)
    this._boundOnBlobDownload = this._onDownload.bind(this, false)
    this._boundOnDbUpload = this._onUpload.bind(this, true)
    this._boundOnDbDownload = this._onDownload.bind(this, true)
    this._boundPeerUpdate = this._updatePeers.bind(this)

    const stats = {
      startTime: 0,
      percentage: 0,
      peers: 0,
      speed: 0,
      blocks: 0,
      totalBytes: 0, // local + bytes loaded during monitoring
      dbBytes: 0, // bytes loaded from the db / preload
      blobBytes: 0, // bytes loaded from the blobs core
      monitoringBytes: 0, // bytes loaded during monitoring
      targetBytes: 0,
      targetBlocks: 0
    }

    // Updated on each upload/download event
    this.uploadStats = { ...stats }
    this.downloadStats = { ...stats }

    this.uploadSpeedometer = null
    this.downloadSpeedometer = null

    this.ready().catch(safetyCatch)
  }

  async _open() {
    await this.drive.ready()
    this.blobs = await this.drive.getBlobs()

    this.uploadSpeedometer = speedometer()
    this.downloadSpeedometer = speedometer()

    this._updatePeers()

    // Handlers
    this.blobs.core.on('peer-add', this._boundPeerUpdate)
    this.blobs.core.on('peer-remove', this._boundPeerUpdate)
    this.blobs.core.on('upload', this._boundOnBlobUpload)
    this.blobs.core.on('download', this._boundOnBlobDownload)

    this.drive.db.core.on('peer-add', this._boundPeerUpdate)
    this.drive.db.core.on('peer-remove', this._boundPeerUpdate)
    this.drive.db.core.on('upload', this._boundOnDbUpload)
    this.drive.db.core.on('download', this._boundOnDbDownload)

    if (!this.entry && this.name) this.entry = await this.drive.entry(this.name)
    if (this.entry) this._setEntryInfo()
  }

  async _close() {
    this.blobs.core.off('peer-add', this._boundPeerUpdate)
    this.blobs.core.off('peer-remove', this._boundPeerUpdate)
    this.blobs.core.off('upload', this._boundOnBlobUpload)
    this.blobs.core.off('download', this._boundOnBlobDownload)

    this.drive.db.core.off('peer-add', this._boundPeerUpdate)
    this.drive.db.core.off('peer-remove', this._boundPeerUpdate)
    this.drive.db.core.off('upload', this._boundOnDbUpload)
    this.drive.db.core.off('download', this._boundOnDbDownload)

    this.drive.monitors.delete(this)
  }

  _setEntryInfo() {
    if (!this.downloadStats.targetBytes || !this.downloadStats.targetBlocks) {
      this.downloadStats.targetBytes = this.entry.value.blob.byteLength
      this.downloadStats.targetBlocks = this.entry.value.blob.blockLength
    }

    if (!this.uploadStats.targetBytes || !this.uploadStats.targetBlocks) {
      this.uploadStats.targetBytes = this.entry.value.blob.byteLength
      this.uploadStats.targetBlocks = this.entry.value.blob.blockLength
    }
  }

  _onUpload(isDb, index, bytes, from) {
    this._updateStats(this.uploadSpeedometer, this.uploadStats, index, bytes, from, isDb)
  }

  _onDownload(isDb, index, bytes, from) {
    this._updateStats(this.downloadSpeedometer, this.downloadStats, index, bytes, from, isDb)
  }

  _updatePeers() {
    this.uploadStats.peers = this.downloadStats.peers = this.peers = this.blobs.core.peers.length
  }

  _updateStats(speed, stats, index, bytes, from, isDb) {
    if (this.closing) return
    if (!isDb && this.entry && !isWithinRange(index, this.entry)) return

    if (!stats.startTime) stats.startTime = Date.now()

    stats.speed = speed(bytes)

    if (!isDb) {
      // only tracking blob blocks
      stats.blocks++
    }

    stats.monitoringBytes += bytes
    stats.totalBytes += bytes
    stats[isDb ? 'dbBytes' : 'blobBytes'] += bytes
    stats.percentage = toFixed((stats.blocks / stats.targetBlocks) * 100)

    this.emit('update')
  }

  downloadSpeed() {
    return this.downloadSpeedometer ? this.downloadSpeedometer() : 0
  }

  uploadSpeed() {
    return this.uploadSpeedometer ? this.uploadSpeedometer() : 0
  }
}

function isWithinRange(index, entry) {
  if (!entry || !entry.value) return
  const { blockOffset, blockLength } = entry.value.blob
  return index >= blockOffset && index < blockOffset + blockLength
}

function toFixed(n) {
  return Math.round(n * 100) / 100
}
