module.exports = class Download {
  constructor (coreDownloads = []) {
    this._coreDownloads = coreDownloads
  }

  destroy () {
    for (const d of this._coreDownloads) {
      d.destroy()
    }
  }

  async done () {
    await Promise.allSettled(this._coreDownloads.map((d) => d.done()))
  }
}
