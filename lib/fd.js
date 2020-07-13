const byteStream = require('byte-stream')
const errors = require('./errors')
const pumpify = require('pumpify')
const { Transform } = require('streamx')
const { linux: linuxConstants, parse } = require('filesystem-constants')
const {
  O_RDONLY,
  O_WRONLY,
  O_RDWR,
  O_CREAT,
  O_TRUNC,
  O_APPEND,
  O_SYNC,
  O_EXCL,
  O_ACCMODE
} = linuxConstants

class FileDescriptor {
  constructor (drive, path, stat, contentState, readable, writable, appending, creating) {
    this.drive = drive
    this.stat = stat
    this.path = path
    this.contentState = contentState

    this.readable = readable
    this.writable = writable
    this.creating = creating
    this.appending = appending

    this.position = null
    this.blockPosition = stat ? stat.offset : null
    this.blockOffset = 0

    this._gets = new Set()
    this._appendStream = null
    this._err = null
    if (this.writable) {
      if (this.appending) {
        this._appendStream = this.drive.createReadStream(this.path)
        this.position = this.stat.size
      }
    }

    this._batcher = byteStream({ time: 100, limit: 4096 * 16 })

    this._range = null
  }

  read (buffer, offset, len, pos, cb) {
    if (!this.readable) return cb(new errors.BadFileDescriptor('File descriptor not open for reading.'))
    this._readAcc(buffer, offset, len, pos, 0, cb)
  }

  _readAcc (buffer, offset, len, pos, totalRead, cb) {
    if (this.position !== null && this.position === pos) this._read(buffer, offset, len, totalRead, cb)
    else this._seekAndRead(buffer, offset, len, pos, totalRead, cb)
  }

  write (buffer, offset, len, pos, cb) {
    if (!this.writable) return cb(new errors.BadFileDescriptor('File descriptor not open for writing.'))
    if (!this.stat && !this.creating) {
      return process.nextTick(cb, new errors.BadFileDescriptor('File descriptor not open in create mode.'))
    }
    if (this.position !== null && pos !== this.position) {
      return process.nextTick(cb, new errors.BadFileDescriptor('Random-access writes are not currently supported.'))
    }
    if (this.appending && pos < this.stat.size) {
      return process.nextTick(cb, new errors.BadFileDescriptor('Position cannot be less than the file size when appending.'))
    }
    if (!this._writeStream && !this.appending && pos) {
      return process.nextTick(cb, new errors.BadFileDescriptor('Random-access writes are not currently supported.'))
    }

    const self = this
    const slice = buffer.slice(offset, len)

    if (!this._writeStream) {
      this._writeStream = createWriteStream(this.drive, this.stat, this.path)
      this.drive._writingFds.set(this.path, this)
    }

    this._writeStream.on('error', done)

    // TODO: This is a temporary (bad) way of supporting appends.
    if (this._appendStream) {
      this.position = this.stat.size
      // pump does not support the `end` option.
      this._appendStream.pipe(this._writeStream, { end: false })

      this._appendStream.on('error', err => this._writeStream.destroy(err))
      this._writeStream.on('error', err => this._appendStream.destroy(err))

      return this._appendStream.on('end', doWrite)
    }

    return doWrite()

    function done (err) {
      self._writeStream.removeListener('error', done)
      self._writeStream.removeListener('drain', done)
      if (err) return cb(err)
      self.position += slice.length
      self.stat.size += slice.length
      return cb(null, slice.length, buffer)
    }

    function doWrite (err) {
      self._appendStream = null
      if (err) return cb(err)
      if (self._err) return cb(self._err)
      if (self._writeStream.destroyed) return cb(new errors.BadFileDescriptor('Write stream was destroyed.'))

      if (self._writeStream.write(slice) === false) {
        self._writeStream.once('drain', done)
      } else {
        process.nextTick(done)
      }
    }
  }

  truncate (size, cb) {
    if (!this.writable) return cb(new errors.BadFileDescriptor('File descriptor is not writable'))
    // TODO: Handle all the different truncation scenarios (wait for inode table).
    if (size) return cb(new errors.InvalidArgument('Non-zero sizes are not currently supported in ftruncate.'))
    this.drive._update(this.path, { size: 0, blocks: 0 }, (err, st) => {
      if (err) return cb(err)
      this.stat = st
      return cb(null)
    })
  }

  close (cb) {
    // TODO: If we ever support multiple file descriptors for one path at one time, this will need updating.
    if (this.writable) this.drive._writingFds.delete(this.path)
    if (this._writeStream) {
      if (this._writeStream.destroyed) {
        this._writeStream = null
      } else {
        return this._writeStream.end(err => {
          if (err) return cb(err)
          this._writeStream = null
          return cb(null)
        })
      }
    }
    if (this._range) {
      for (const get of this._gets) this.contentState.feed.cancel(get)
      this.contentState.feed.undownload(this._range)
      this._range = null
    }
    process.nextTick(cb, null)
  }

  /**
   * Will currently request until the end of the file linearly.
   *
   * TODO: This behavior should be more customizable in the future.
   */
  _refreshDownload (start, cb) {
    // const end = Math.min(this.stat.blocks + this.stat.offset, start + 16)
    const end = this.stat.offset + this.stat.blocks

    if (this._range) {
      this.contentState.feed.undownload(this._range)
    }

    this._range = this.contentState.feed.download({ start, end, linear: true }, cb || noop)
  }

  _seekAndRead (buffer, offset, len, pos, totalRead, cb) {
    const start = this.stat.offset
    const end = start + this.stat.blocks

    this.contentState.feed.seek(this.stat.byteOffset + pos, { start, end }, (err, blk, blockOffset) => {
      if (err) return cb(err)
      this.position = pos
      this.blockPosition = blk
      this.blockOffset = blockOffset

      this._refreshDownload(blk)
      this._read(buffer, offset, len, totalRead, cb)
    })
  }

  _read (buffer, offset, len, totalRead, cb) {
    const self = this

    const position = this.position
    readNextBlock()

    function readNextBlock () {
      self._readBlock(buffer, offset + totalRead, Math.max(len - totalRead, 0), (err, bytesRead) => {
        if (err) return cb(err)
        if (!bytesRead) return cb(null, totalRead, buffer)

        totalRead += bytesRead

        if (totalRead < len) {
          return self._readAcc(buffer, offset, len, position + bytesRead, totalRead, cb)
        }
        return cb(null, totalRead, buffer)
      })
    }
  }

  _readBlock (buffer, offset, len, cb) {
    const buf = buffer.slice(offset, offset + len)
    const blkOffset = this.blockOffset
    const blk = this.blockPosition

    if (this._range && (blk < this._range.start || blk > this._range.end)) {
      this._refreshDownload(blk)
    }

    if ((this.stat.offset + this.stat.blocks) <= blk || blk < this.stat.offset) {
      return process.nextTick(cb, null, 0, buffer)
    }

    const get = this.contentState.feed.get(blk, (err, data) => {
      this._gets.delete(get)

      if (err) return cb(err)
      if (blkOffset) data = data.slice(blkOffset)

      data.copy(buf)
      const read = Math.min(data.length, buf.length)

      if (blk === this.blockPosition && blkOffset === this.blockOffset) {
        this.position += read
        if (read === data.length) {
          this.blockPosition++
          this.blockOffset = 0
        } else {
          this.blockOffset = blkOffset + read
        }
      }

      cb(null, read, buffer)
    })

    this._gets.add(get)
  }
}

module.exports = function create (drive, name, flags, cb) {
  try {
    flags = parse(linuxConstants, flags)
  } catch (err) {
    return process.nextTick(cb, new errors.InvalidArgument(err.message))
  }

  const accmode = flags & O_ACCMODE
  const writable = !!(accmode & (O_WRONLY | O_RDWR))
  const readable = accmode === 0 || !!(accmode & O_RDWR)
  const appending = !!(flags & O_APPEND)
  const truncating = !!(flags & O_TRUNC)
  const creating = !!(flags & O_CREAT)
  const canExist = !(flags & O_EXCL)

  drive.stat(name, { trie: true }, (err, st, trie) => {
    if (err && (err.errno !== 2)) return cb(err)
    if (st && !canExist) return cb(new errors.PathAlreadyExists(name))
    if (!st && (!writable || !creating)) return cb(new errors.FileNotFound(name))

    drive._getContent(trie.feed, (err, contentState) => {
      if (err) return cb(err)
      const fd = new FileDescriptor(drive, name, st, contentState, readable, writable, appending, creating)
      if (!contentState.feed.writable && writable) return cb(new errors.InvalidArgument('Cannot open a writable fd on a read-only drive.'))
      if (truncating) {
        return drive._upsert(name, { size: 0, blocks: 0 }, (err, st) => {
          if (err) return cb(err)
          fd.stat = st
          return cb(null, fd)
        })
      }
      if (creating || (writable && !appending)) {
        return drive.create(name, (err, st) => {
          if (err) return cb(err)
          fd.stat = st
          return cb(null, fd)
        })
      } else {
        return cb(null, fd)
      }
    })
  })
}

function createWriteStream (drive, opts, path) {
  const writeStream = drive.createWriteStream(path, opts)
  const batcher = byteStream({ time: 100, limit: 4096 * 16 })
  return pumpify(batcher, new Transform({
    transform (chunk, cb) {
      return cb(null, Buffer.concat(chunk))
    }
  }), writeStream)
}

function noop () {}
