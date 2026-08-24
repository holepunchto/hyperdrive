const ReadyResource = require('ready-resource')

module.exports = class Download extends ReadyResource {
  constructor(drive, folder, options) {
    super()

    this.drive = drive
    this.folder = folder
    this.options = options || {}
    this.downloads = this.options.downloads || []
    this.diff = this.options.diff === undefined ? null : this.options.diff
    this._maps = []
    this._stream = null
    this._cancelled = new Promise((resolve) => {
      this._cancel = resolve
    })
    this.ready().catch(noop)
  }

  async _open() {
    try {
      await this._download()
    } catch (err) {
      this._destroyAll()
      if (!this._isCancelled()) throw err
    }
  }

  _isCancelled() {
    return this.destroyed || this.drive.closing !== null
  }

  _destroyAll() {
    if (this._stream) this._stream.destroy()
    for (const m of this._maps) m.destroy()
    for (const d of this.downloads) d.destroy()
  }

  async _download() {
    const drive = this.drive

    const blobs = await Promise.race([drive.getBlobs(), this._cancelled])
    if (!blobs) return

    if (this.diff !== null) return this._downloadDiff(blobs)

    const entry =
      !this.folder || this.folder.endsWith('/')
        ? null
        : await drive.entry(this.folder, this.options)

    if (entry) {
      const blob = entry.value.blob
      if (!blob || !blob.blockLength) return

      if (blob.blockMap) {
        const map = this.constructor.downloadEntryMap(blobs, blob)
        this._maps.push(map)

        const mapDownload = await this._cancellableDownload(map)
        if (!mapDownload) return
      }

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

      const entries = []
      for await (const entry of drive.list(this.folder, this.options)) {
        const blob = entry.value.blob
        if (!blob || !blob.blockLength) continue
        if (blob.blockMap && blob.blockLength) {
          this._maps.push(
            blobs.core.download({ start: blob.blockOffset, length: blob.blockLength })
          )
        }
        entries.push(entry) // cache entries
      }

      const results = await Promise.all(this._maps.map((m) => this._cancellableDownload(m)))
      if (results.includes(false)) return

      for (const entry of entries) {
        const blob = entry.value.blob
        const download = await this.constructor.downloadEntry(blobs, blob)
        this.downloads.push(download)
      }
    }
  }

  async _downloadDiff(blobs) {
    if (this._isCancelled()) return

    this._stream = this.drive.diff(this.diff, this.folder, this.options)

    const blobsDiff = []

    for await (const entry of this._stream) {
      if (!entry.left) continue

      const blob = entry.left.value.blob
      if (!blob || !blob.blockLength) continue

      if (blob.blockMap && blob.blockLength) {
        this._maps.push(this.constructor.downloadEntryMap(blobs, blob))
      }

      blobsDiff.push(blob)
    }

    const results = await Promise.all(this._maps.map((m) => this._cancellableDownload(m)))
    if (results.includes(false)) return

    for (const blob of blobsDiff) {
      const download = await this.constructor.downloadEntry(blobs, blob)
      this.downloads.push(download)
    }
  }

  static downloadEntryMap(blobs, blob) {
    return blobs.core.download({ start: blob.blockOffset, length: blob.blockLength })
  }

  static async downloadEntry(blobs, blob) {
    if (blob.blockMap) {
      const map = await blobs.getBlockMap(blob)
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

  async _cancellableDownload(download) {
    return Promise.race([
      download.done().then(() => true),
      this._cancelled.then(() => {
        download.destroy()
        return false
      })
    ])
  }

  _close() {
    this._destroyAll()
  }

  destroy() {
    this.destroyed = true
    this._cancel()
    this._destroyAll()
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
