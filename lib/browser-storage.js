module.exports = BrowserStore

function BrowserStore (drive, feed) {
  if (!(this instanceof BrowserStore)) return new BrowserStore(drive, feed)
  // TODO: use level-browserify or something
  this.store = []
}

BrowserStore.prototype.get = function (index, cb) {
  if (!index) return cb(new Error('Index required'))
  if (!this.store[index]) return cb(new Error('No value found'))
  return cb(null, this.store[index])
}

BrowserStore.prototype.put = function (index, buf, cb) {
  this.store[index] = buf
  return cb(null)
}

BrowserStore.prototype.append = function (bufs, cb) {
  for (var i = 0; i < bufs.length; i++) { this.store.push(bufs[i]) }
  return cb()
}
