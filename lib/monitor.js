const ReadyResource = require('ready-resource')

module.exports = class Monitor extends ReadyResource {
  constructor (drive, opts = {}) {
    super()
    this.drive = drive
    this.blobs = null
    this.name = opts.name
    this.entry = opts.entry

    this._boundOnAppend = this._onAppend.bind(this)
    this._boundUpdateStats = this._updateStats.bind(this)
    this.drive.on('close', () => this.close())

    // Updated on each upload/download event
    this.stats = {
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
    this.blobs.core.on('upload', this._boundUpdateStats)
    this.blobs.core.on('download', this._boundUpdateStats)
  }

  async _close () {
    this.blobs.core.off('append', this._boundOnAppend)
    this.blobs.core.off('upload', this._boundUpdateStats)
    this.blobs.core.off('download', this._boundUpdateStats)
  }

  async _onAppend () {
    if (this.entry) return
    await new Promise(resolve => setImmediate(resolve))
    this.entry = await this.drive.entry(this.name)
    if (this.entry) this._setEntryInfo()
  }

  _setEntryInfo () {
    if (this.stats.totalBytes || this.stats.totalBlocks) return
    this.stats.totalBytes = this.entry.value.blob.byteLength
    this.stats.totalBlocks = this.entry.value.blob.blockLength
  }

  _updateStats (index, bytes) {
    if (!this.entry || this.closing) return
    if (!isWithinRange(index, this.entry)) return
    if (!this.stats.startTime) this.stats.startTime = Date.now()

    this.stats.blocks++
    this.stats.bytes += bytes
    this.stats.percentage = Number(((this.stats.bytes / this.stats.totalBytes) * 100).toFixed(2))
    const timeElapsed = (Date.now() - this.stats.startTime) / 1000
    if (timeElapsed > 0) {
      this.stats.speed = Math.floor(this.stats.bytes / timeElapsed) // Speed in bytes/sec
    }

    this.emit('update')
  }
}

function isWithinRange (index, entry) {
  if (!entry || !entry.value) return
  const { blockOffset, blockLength } = entry.value.blob
  return index >= blockOffset && index < blockOffset + blockLength
}
