module.exports = Cursor

function Cursor (archive, index, offset) {
  if (!(this instanceof Cursor)) return new Cursor(archive, index, offset)
  this.archive = archive
  this.index = index
  this._position = offset
  this._entry = null
  this._bytesOffset = null
}

Cursor.prototype.next = function (cb) {
  var self = this
  if (!this._entry) {
    this.archive.get(this.index, function (err, entry) {
      if (err) return cb(err)
      self._entry = entry
      self._bytesOffset = entry.content.bytesOffset + self._position
      return self.next(cb)
    })
  } else if (this._position > this._entry.length - 1) {
    return cb(null, null)
  } else {
    this.archive.content.seek(this._bytesOffset, function (err, index, offset) {
      if (err) return cb(err)
      self.archive.content.get(index, function (err, data) {
        if (err) return cb(err)
        var sliced = data.slice(offset)
        self._bytesOffset += sliced.length
        self._position += sliced.length
        return cb(null, sliced)
      })
    })
  }
}

