/**
 * A promisified version of the Hyperdrive API
 *
 * Note: The promises API does not currently include file descriptor operations.
*/

module.exports = class HyperdrivePromises {
  constructor (drive) {
    this._drive = drive
  }

  ready () {
    return new Promise((resolve, reject) => {
      this._drive.ready(err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  close () {
    return new Promise((resolve, reject) => {
      this._drive.close(err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  create (name, opts) {
    return new Promise((resolve, reject) => {
      this._drive.create(name, opts, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })

  }

  readFile (name, opts) {
    return new Promise((resolve, reject) => {
      this._drive.readFile(name, opts, (err, contents) => {
        if (err) return reject(err)
        return resolve(contents)
      })
    })

  }

  writeFile (name, buf, opts) {
    return new Promise((resolve, reject) => {
      this._drive.writeFile(name, buf, opts, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })

  }

  truncate (name, size) {
    return new Promise((resolve, reject) => {
      this._drive.truncate(name, size, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })

  }

  mkdir (name, opts) {
    return new Promise((resolve, reject) => {
      this._drive.mkdir(name, opts, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })

  }

  lstat (name, opts) {
    return new Promise((resolve, reject) => {
      this._drive.lstat(name, opts, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })
  }

  stat (name, opts) {
    return new Promise((resolve, reject) => {
      this._drive.stat(name, opts, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })
  }

  access (name, opts) {
    return new Promise((resolve, reject) => {
      this._drive.access(name, opts, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  exists (name, opts) {
    return new Promise((resolve, reject) => {
      this._drive.exists(name, opts, (exists) => {
        return resolve(exists)
      })
    })
  }

  readdir (name, opts) {
    return new Promise((resolve, reject) => {
      this._drive.readdir(name, opts, (err, entries) => {
        if (err) return reject(err)
        return resolve(entries)
      })
    })

  }

  unlink (name) {
    return new Promise((resolve, reject) => {
      this._drive.unlink(name, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  rmdir (name) {
    return new Promise((resolve, reject) => {
      this._drive.rmdir(name, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })

  }

  checkout (version, opts) {
    return this._drive.checkout(version, opts)
  }

  destroyStorage () {
    return new Promise((resolve, reject) => {
      this._drive.destroyStorage(err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  stats (path, opts) {
    return new Promise((resolve, reject) => {
      this._drive.stats(path, opts, (err, stats) => {
        if (err) return reject(err)
        return resolve(stats)
      })
    })
  }

  watchStats (path, opts) {
    return this._drive.watchStats(path, opts)
  }

  mirror () {
    return this._drive.mirror()
  }

  download (path, opts) {
    var handle = null
    const prom = new Promise((resolve, reject) => {
      handle = this._drive.download(path, opts, err => {
        if (err) return reject(err)
        return resolve(handle)
      })
    })
    prom.destroy = handle.destroy
    return prom
  }

  mount (path, key, opts) {
    return new Promise((resolve, reject) => {
      this._drive.mount(path, key, opts, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  unmount (path) {
    return new Promise((resolve, reject) => {
      this._drive.unmount(path, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  symlink (target, linkname) {
    return new Promise((resolve, reject) => {
      this._drive.symlink(target, linkname, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })
  }

  getAllMounts (opts) {
    return new Promise((resolve, reject) => {
      this._drive.getAllMounts(opts, (err, allMounts) => {
        if (err) return reject(err)
        return resolve(allMounts)
      })
    })
  }

  setMetadata (path, key, value) {
    return new Promise((resolve, reject) => {
      this._drive.setMetadata(path, key, value, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })
  }

  removeMetadata (path, key) {
    return new Promise((resolve, reject) => {
      this._drive.removeMetadata(path, key, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })
  }

  copy (from, to) {
    return new Promise((resolve, reject) => {
      this._drive.copy(from, to, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })
  }

  createTag (name, version) {
    return new Promise((resolve, reject) => {
      this._drive.createTag(name, version, (err) => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  getAllTags () {
    return new Promise((resolve, reject) => {
      this._drive.getAllTags((err, allTags) => {
        if (err) return reject(err)
        return resolve(allTags)
      })
    })
  }

  deleteTag (name) {
    return new Promise((resolve, reject) => {
      this._drive.deleteTag(name, (err) => {
        if (err) return reject(err)
        return resolve(null)
      })
    })

  }

  getTaggedVersion (name) {
    return new Promise((resolve, reject) => {
      this._drive.getTaggedVersion(name, (err, version) => {
        if (err) return reject(err)
        return resolve(version)
      })
    })
  }
}
