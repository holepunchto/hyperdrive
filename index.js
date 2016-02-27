var constants = require('constants')
var hypercore = require('hypercore')
var sublevel = require('subleveldown')
var fs = require('fs')
var mkdirp = require('mkdirp')
var bulk = require('bulk-write-stream')
var path = require('path')
var deltas = require('delta-list')
var from = require('from2')
var through = require('through2')
var pump = require('pump')
var pumpify = require('pumpify')
var octal = require('octal')
var util = require('util')
var events = require('events')
var storage
var rabin
if (process.browser) rabin = through
else rabin = require('rabin')
if (process.browser) storage = require('./lib/browser-storage')
else storage = require('./lib/storage')
var messages = require('./lib/messages')

var DMODE = octal(755)
var FMODE = octal(644)

module.exports = Hyperdrive

function Hyperdrive (db) {
  if (!(this instanceof Hyperdrive)) return new Hyperdrive(db)
  var self = this

  this.db = db
  this.drives = sublevel(db, 'drives', {valueEncoding: 'binary'})
  this.core = hypercore(db, {
    storage: function (feed) {
      return storage(self, feed)
    }
  })
}

// Hyperdrive.prototype.list = function () {
//   return this.drives.createKeyStream()
// }

Hyperdrive.prototype.createPeerStream = function () {
  return this.core.createPeerStream()
}

Hyperdrive.prototype.get = function (id, folder) {
  if (!folder || !id) throw new Error('id and folder required')
  return new Archive(this, folder, id)
}

Hyperdrive.prototype.add = function (folder) {
  if (!folder) throw new Error('folder required')
  return new Archive(this, folder, null)
}

function Progress () {
  this.bytesInitial = 0
  this.bytesRead = 0
  this.bytesTotal = 0
  events.EventEmitter.call(this)
}

util.inherits(Progress, events.EventEmitter)

Progress.prototype.end = function (err) {
  if (!err) return this.emit('end')
  if (this.listeners('error').length) this.emit('error', err)
  return
}

function Archive (drive, folder, id) {
  events.EventEmitter.call(this)

  var self = this

  this.id = id
  this.directory = folder
  this.core = drive.core
  this.entries = 0
  this.metadata = {type: 'hyperdrive'}
  this.stats = {
    bytesRead: 0,
    bytesDownloaded: 0,
    filesRead: 0,
    filesDownloaded: 0
  }

  this._first = true

  if (!id) {
    this.feed = this.core.add({filename: null})
  } else {
    this.feed = this.core.get(id)
    this.feed.get(0, onmetadata)
  }

  this.feed.on('put', function (block, data) {
    self.stats.bytesDownloaded += data.length
    self.emit('download', data, block)
  })

  this.feed.ready(function (err) {
    if (err) return
    self.entries = self.feed.blocks - 1
    self.emit('ready')
  })

  function onmetadata (err, json) {
    if (err) self.emit('error', err)

    var doc

    try {
      doc = JSON.parse(json.toString())
    } catch (err) {
      // do nothing
    }

    if (!doc || doc.type !== 'hyperdrive') {
      self.emit('error', new Error('feed is not a hyperdrive'))
    } else {
      self.metadata = doc
      self.emit('metadata')
    }
  }
}

util.inherits(Archive, events.EventEmitter)

Archive.prototype.close = function (cb) {
  this.feed.close(cb)
}

Archive.prototype.lookup = function (name, cb) {
  // TODO: use binary search or something more performant
  var stream = this.createEntryStream()
  var found = false
  stream.on('data', function (entry) {
    if (found || entry.name !== name) return
    found = true
    stream.destroy()
    cb(null, entry)
  })
  stream.on('error', cb)
  stream.on('end', function () {
    stream.removeListener('error', cb)
    if (!found) cb(null)
  })
}

Archive.prototype.ready = function (cb) {
  this.feed.ready(cb)
}

Archive.prototype.download = function (i, cb) {
  if (!cb) cb = noop

  var ptr = 0
  var self = this
  var stats = new Progress()
  var offset = 0

  if (typeof i === 'number') this.entry(i, onentry)
  else onentry(null, i)

  return stats

  function onentry (err, entry) {
    if (err) return cb(err)

    var feed = self._getFeed(entry)
    var dest = join(self.directory, entry.name)

    if (!feed) return createEmptyEntry()

    feed.on('put', kick)
    feed.open(kick)
    stats.bytesTotal = entry.size

    if (feed._storage) onstorage(feed._storage)
    else feed.on('_storage', onstorage)

    function onstorage (storage) {
      if (!storage._bytesWritten) return
      storage._bytesWritten(function (_, bytes) {
        if (bytes) {
          stats.bytesInitial = bytes - offset
          stats.bytesRead = bytes
          stats.emit('ready')
        }
      })
    }

    function kick (block, data) {
      if (!feed.blocks) return

      if (data && this === feed && entry.link && block < feed.blocks - entry.link.index.length) {
        stats.bytesRead += data.length
        offset += data.length
      }
      for (; ptr < feed.blocks; ptr++) {
        if (!feed.has(ptr)) return
      }

      if (process.browser) return done()

      fs.stat(dest, function (_, st) {
        feed.removeListener('put', kick)

        // the size check probably isn't nessary here...
        if (st && st.size === entry.size) return done(null)

        // duplicate - just copy it in
        mkdirp(path.dirname(dest), function () {
          pump(self.createFileStream(entry), fs.createWriteStream(dest), done)
        })
      })
    }

    function done (err) {
      if (!err) self.stats.filesDownloaded++
      stats.bytesRead = stats.bytesTotal
      stats.end(err)
      cb(err)
    }

    function createEmptyEntry () {
      var dir = dest
      if (entry.type === 'file') dir = path.dirname(dest)
      mkdirp(dir, function (err) {
        if (err) return cb(err)
        if (entry.type !== 'file') return cb(null)
        fs.open(dest, 'a', function (err, fd) {
          if (err) return cb(err)
          fs.close(fd, cb)
        })
      })
    }
  }
}

Archive.prototype.select = function (i, cb) {
  if (!cb) cb = noop

  var self = this

  if (typeof i === 'number') this.entry(i, onentry)
  else onentry(null, i)

  function onentry (err, entry) {
    if (err) return cb(err)
    if (!entry || !entry.link) return cb(null, null)
    cb(null, self._getFeed(entry))
  }
}

Archive.prototype.deselect = function (i, cb) {
  throw new Error('not yet implemented')
}

Archive.prototype.entry = function (i, cb) {
  this.feed.get(i + 1, function (err, data) {
    if (err) return cb(err)
    if (!data) return cb(null, null)
    cb(null, messages.Entry.decode(data))
  })
}

Archive.prototype.finalize = function (cb) {
  if (!cb) cb = noop
  var self = this
  this.feed.finalize(function (err) {
    if (err) return cb(err)
    self.id = self.feed.id
    self.entries = self.feed.blocks - 1
    cb()
  })
}

Archive.prototype.createEntryStream = function (opts) {
  if (!opts) opts = {}
  var start = opts.start || 0
  var limit = opts.limit || Infinity
  var self = this
  return from.obj(read)

  function read (size, cb) {
    if (limit-- === 0) return cb(null, null)
    self.entry(start++, cb)
  }
}

Archive.prototype._getFeed = function (entry) {
  if (!entry.link) return null

  var self = this
  var done = false
  var contentBlocks = entry.link.blocks - entry.link.index.length
  var feed = this.core.get(entry.link.id, {
    filename: join(this.directory, entry.name),
    index: deltas.unpack(entry.link.index),
    contentBlocks: contentBlocks
  })

  var ptr = 0

  feed.on('put', function (block, data) {
    self.emit('file-download', entry, data, block)
    kick()
  })

  feed.open(function (err) {
    if (err) return
    kick()
    for (var i = 0; i < entry.link.index.length; i++) {
      if (!feed.has(i + contentBlocks)) feed.want.push({block: i + contentBlocks, callback: noop, critical: true})
    }
  })

  return feed

  function kick () {
    if (done || !feed.blocks) return
    for (; ptr < feed.blocks; ptr++) {
      if (!feed.has(ptr)) return
    }
    done = true
    self.emit('file-downloaded', entry)
  }
}

Archive.prototype.createFileCursor = function (i, opts) {
  throw new Error('not yet implemented')
}

Archive.prototype.createFileStream = function (i, opts) { // TODO: expose random access stuff
  if (!opts) opts = {}
  var start = opts.start || 0
  var limit = opts.limit || Infinity
  var self = this
  var feed = null
  return from.obj(read)

  function read (size, cb) {
    if (feed) {
      if (limit-- === 0) return cb(null, null)
      feed.get(start++, cb)
      return
    }

    if (typeof i === 'string') self.lookup(i, onentry)
    else if (typeof i === 'number') self.entry(i, onentry)
    else onentry(null, i)

    function onentry (err, entry) {
      if (err) return cb(err)
      if (!entry.link) return cb(null, null)
      feed = self._getFeed(entry)
      limit = Math.min(limit, entry.link.blocks - entry.link.index.length)
      read(0, cb)
    }
  }
}

Archive.prototype.append = function (entry, opts, cb) {
  if (typeof opts === 'function') return this.append(entry, null, opts)
  if (typeof entry === 'string') entry = {name: entry, type: 'file'}
  if (!entry.name) throw new Error('entry.name is required')
  if (!entry.type && entry.mode) entry.type = modeToType(entry.mode)
  if (entry.type && !entry.mode) entry.mode = entry.type === 'directory' ? DMODE : FMODE
  if (!opts) opts = {}

  var self = this

  if (entry.type !== 'file') {
    append(null, cb)
    return null
  }

  if (opts.filename === true) opts.filename = entry.name

  var size = 0
  var stats = opts.stats
  var feed = this.core.add({filename: opts.filename && path.resolve(this.directory, opts.filename)})
  var stream = pumpify(rabin(), bulk(write, end))

  if (cb) {
    stream.on('error', cb)
    stream.on('finish', forward)
  }

  return stream

  function forward () {
    cb(null, entry)
  }

  function append (link, cb) {
    if (link) self.stats.filesRead++
    entry.size = size
    entry.link = link
    if (self._first) {
      // first block is gonna be a human readable metadata block
      // this makes updating the protocol easier in the future
      self.feed.append(JSON.stringify(self.metadata))
      self._first = false
    }
    self.feed.append(messages.Entry.encode(entry), done)

    function done (err) {
      if (err) return cb(err)
      self.entries++
      cb(null)
    }
  }

  function write (buffers, cb) {
    for (var i = 0; i < buffers.length; i++) {
      size += buffers[i].length
      if (stats) stats.bytesRead += buffers[i].length
      self.stats.bytesRead += buffers[i].length
    }
    feed.append(buffers, cb)
  }

  function end (cb) {
    feed.finalize(function (err) {
      if (err) return cb(err)
      if (!feed.id) return append(null, cb)

      var link = {
        id: feed.id,
        blocks: feed.blocks,
        index: deltas.pack(feed._storage._index)
      }

      append(link, cb)
    })
  }
}

Archive.prototype.appendFile = function (filename, name, cb) {
  if (typeof name === 'function') return this.appendFile(filename, null, name)
  if (!cb) cb = noop
  if (!name) name = filename

  var self = this
  var stats = new Progress()

  fs.lstat(filename, function (err, st) {
    if (err) return done(err)

    var opts = {filename: filename, stats: stats}
    var ws = self.append({
      name: name,
      mode: st.mode,
      size: 0,
      link: null
    }, opts, done)

    stats.bytesTotal = st.size
    stats.emit('ready')

    if (ws) {
      var readStream = fs.createReadStream(path.resolve(self.directory, filename))
      pump(readStream, ws)
    }
  })

  return stats

  function done (err) {
    stats.end(err)
    cb(err)
  }
}

function noop () {}

function modeToType (mode) { // from tar-stream
  switch (mode & constants.S_IFMT) {
    case constants.S_IFBLK: return 'block-device'
    case constants.S_IFCHR: return 'character-device'
    case constants.S_IFDIR: return 'directory'
    case constants.S_IFIFO: return 'fifo'
    case constants.S_IFLNK: return 'symlink'
  }

  return 'file'
}

function join (a, b) {
  return path.join(a, path.resolve('/', b))
}
