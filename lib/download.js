module.exports = class Download {
  constructor (coreDownloads = []) {
    this._coreDownloads = Array.isArray(coreDownloads) ? coreDownloads : [coreDownloads]
  }

  destroy () {
    this._coreDownloads.forEach((d) => d.destroy())
  }

  async done () {
    await Promise.allSettled(this._coreDownloads.map((d) => d.done()))
  }
}
