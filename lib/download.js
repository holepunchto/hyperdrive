const ReadyResource = require('ready-resource')

module.exports = class Download extends ReadyResource {
  constructor(drive, folder, options) {
    super()

    this.drive = drive
    this.folder = folder
    this.options = options || {}
    this.downloads = this.options.downloads || []
    this.destroyed = false
    this.ready().catch(noop)
  }

  async _open() {
    const drive = this.drive
    const blobs = await drive.getBlobs()

    const entry =
      !this.folder || this.folder.endsWith('/')
        ? null
        : await drive.entry(this.folder, this.options)

    if (entry) {
      const blob = entry.value.blob
      if (!blob) return
      const download = await this.constructor.downloadEntry(blobs, blob)
      this.downloads.push(download)
      return
    }

    if (this.folder !== null) {
      // first preload the list so we can use the full power afterwards to actually preload everything
      // eslint-disable-next-line
      for await (const _ of drive.list(this.folder, this.options)) {
        // ignore
      }

      const maps = []
      const entries = []
      for await (const entry of drive.list(this.folder, this.options)) {
        const blob = entry.value.blob
        if (!blob) continue
        if (blob.blockMap && blob.blockLength) {
          maps.push(blobs.core.download({ start: blob.blockOffset, length: blob.blockLength }))
        }
        entries.push(entry) // cache entries
      }

      await Promise.all(maps.map((m) => m.done()))

      for (const entry of entries) {
        const blob = entry.value.blob
        const download = await this.constructor.downloadEntry(blobs, blob)
        this.downloads.push(download)
      }
    }
  }

  static async downloadEntry(blobs, blob) {
    if (blob.blockMap) {
      const map = await blobs.getBlockMap(blob)
      if (!map) return null

      const blocks = []
      for (const block of map.blocks) blocks.push(block.index)

      const download = blobs.core.download({ blocks })
      await download.ready()
      return download
    } else {
      const download = blobs.core.download({
        start: blob.blockOffset,
        length: blob.blockLength
      })
      await download.ready()
      return download
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
