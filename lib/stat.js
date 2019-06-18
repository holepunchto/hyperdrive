const { messages: { Stat: StatEncoder } } = require('hyperdrive-schemas')

// http://man7.org/linux/man-pages/man2/stat.2.html
var DEFAULT_FMODE = (4 | 2 | 0) << 6 | ((4 | 0 | 0) << 3) | (4 | 0 | 0) // rw-r--r--
var DEFAULT_DMODE = (4 | 2 | 1) << 6 | ((4 | 0 | 1) << 3) | (4 | 0 | 1) // rwxr-xr-x

class Stat {
  constructor (data) {
    this.dev = 0
    this.nlink = 1
    this.rdev = 0
    this.blksize = 0
    this.ino = 0

    this.mode = (data && data.mode) || 0
    this.uid = (data && data.uid) || 0
    this.gid = (data && data.gid) || 0
    this.size = (data && data.size) || 0
    this.offset = (data && data.offset) || 0
    this.byteOffset = (data && data.byteOffset) || 0
    this.blocks = (data && data.blocks) || 0
    this.atime = data && data.atime ? getTime(data.atime) : Date.now() // we just set this to mtime ...
    this.mtime = data && data.mtime ? getTime(data.mtime) : Date.now()
    this.ctime = data && data.ctime ? getTime(data.ctime) : Date.now()
    this.linkname = (data && data.linkname) || null
    this.mount = (data && data.mount) || null
    this.metadata = (data && data.metadata) || null
  }

  _check (mask) {
    return (mask & this.mode) === mask
  }

  encode () {
    return StatEncoder.encode(this)
  }

  isSocket () {
    return this._check(Stat.IFSOCK)
  }
  isSymbolicLink () {
    return this._check(Stat.IFLNK)
  }
  isFile () {
    return this._check(Stat.IFREG)
  }
  isBlockDevice () {
    return this._check(Stat.IFBLK)
  }
  isDirectory () {
    return this._check(Stat.IFDIR)
  }
  isCharacterDevice () {
    return this._check(Stat.IFCHR)
  }
  isFIFO () {
    return this._check(Stat.IFIFO)
  }
}

Stat.file = function (data) {
  data = data || {}
  data.mode = (data.mode || DEFAULT_FMODE) | Stat.IFREG
  return new Stat(data)
}
Stat.directory = function (data) {
  data = data || {}
  data.mode = (data.mode || DEFAULT_DMODE) | Stat.IFDIR
  return new Stat(data)
}
Stat.symlink = function (data) {
  data = data || {}
  data.mode = (data.mode || DEFAULT_FMODE) | Stat.IFLNK
  return new Stat(data)
}

Stat.decode = function (encodedStat) {
  const st = StatEncoder.decode(encodedStat)
  return new Stat(st)
}

Stat.IFSOCK = 0b1100 << 12
Stat.IFLNK = 0b1010 << 12
Stat.IFREG = 0b1000 << 12
Stat.IFBLK = 0b0110 << 12
Stat.IFDIR = 0b0100 << 12
Stat.IFCHR = 0b0010 << 12
Stat.IFIFO = 0b0001 << 12

function getTime (date) {
  if (typeof date === 'number') return date
  if (!date) return Date.now()
  return date.getTime()
}

module.exports = Stat
