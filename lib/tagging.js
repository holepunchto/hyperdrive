const TAGS_PREFIX = 'hyperdrive-tags/'
const varint = require('varint')

module.exports = class TagManager {
  constructor (drive) {
    this.drive = drive
  }

  _toTag (name) {
    return TAGS_PREFIX + name
  }

  _fromTag (tag) {
    return tag.slice(TAGS_PREFIX.length)
  }

  create (name, version, cb) {
    if (typeof version === 'function') {
      cb = version
      version = null
    }
    if (typeof name !== 'string') return cb(new Error('Tag name must be a string.'))
    this.drive.ready(err => {
      if (err) return cb(err)
      if (version === null) version = this.drive.version
      const buf = Buffer.alloc(varint.encodingLength(version))
      varint.encode(version, buf)
      return this.drive.db.put(this._toTag(name), buf, { hidden: true }, cb)
    })
  }

  get (name, cb) {
    this.drive.ready(err => {
      if (err) return cb(err)
      this.drive.db.get(this._toTag(name), { hidden : true }, (err, node) => {
        if (err) return cb(err)
        if (!node) return cb(null, null)
        return cb(null, varint.decode(node.value))
      })
    })
  }

  getAll (cb) {
    this.drive.ready(err => {
      if (err) return cb(err)
      this.drive.db.list(TAGS_PREFIX, { hidden: true }, (err, nodes) => {
        if (err) return cb(err)
        if (!nodes || !nodes.length) return cb(null, [])
        const tagMap = new Map()
        for (const node of nodes) {
          tagMap.set(this._fromTag(node.key), varint.decode(node.value))
        }
        return cb(null, tagMap)
      })
    })
  }

  delete (name, cb) {
    this.drive.ready(err => {
      if (err) return cb(err)
      return this.drive.db.del(this._toTag(name), { hidden: true }, cb)
    })
  }
}
