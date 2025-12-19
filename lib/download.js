const ReadyResource = require('ready-resource')

module.exports = class Download extends ReadyResource {
  constructor(drive, folder, options) {
    super()

    // it's a batch of downloads
    if (Array.isArray(drive)) {
      const downloads = drive
      this.downloads = downloads
      return
    }

    this.drive = drive
    this.folder = folder
    this.options = options || {}
    this.downloads = []
    this.destroyed = false
    this.ready().catch(noop)
  }

  async _open() {
    // it's a batch of downloads
    if (this.downloads.length > 0) {
      return Promise.allSettled(this.downloads.map((d) => d.ready()))
    }
    const drive = this.drive
    const entry =
      !this.folder || this.folder.endsWith('/')
        ? null
        : await drive.entry(this.folder, this.options)

    if (entry) {
      const b = entry.value.blob
      if (!b) return
      const blobs = await drive.getBlobs()
      const download = blobs.core.download({
        start: b.blockOffset,
        length: b.blockLength
      })
      this.downloads.push(download)
      return
    }

    // first preload the list so we can use the full power afterwards to actually preload everything
    // eslint-disable-next-line
    for await (const _ of drive.list(this.folder, this.options)) {
      // ignore
    }

    for await (const entry of drive.list(this.folder, this.options)) {
      const b = entry.value.blob
      if (!b) continue

      const blobs = await drive.getBlobs()
      this.downloads.push(blobs.core.download({ start: b.blockOffset, length: b.blockLength }))
    }
  }

  _close() {
    for (const d of this.downloads) {
      d.destroy()
    }
  }

  destroy() {
    this.destroyed = true
    this._safeBackgroundDestroy()
  }

  async _safeBackgroundDestroy() {
    try {
      await this.ready()
    } catch {}

    await this.close()
  }

  async done() {
    await this.ready()
    await Promise.allSettled(this.downloads.map((d) => d.done()))
  }
}

function noop() {}
