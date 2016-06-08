module.exports = Cursor

function Cursor (entry, content, offset) {
  if (!(this instanceof Cursor)) return new Cursor(entry, content, offset)
  this.entry = entry
  this.content = content
  this._position = offset
  this._bytesOffset = entry.content.bytesOffset + offset
}

Cursor.prototype.next = function (cb) {
  var self = this
  if (this._position > this.entry.length - 1) {
    return cb(null, null)
  }
  this.content.seek(this._bytesOffset, function (err, index, offset) {
    if (err) return cb(err)
    self.content.get(index, function (err, data) {
      if (err) return cb(err)
      var sliced = data.slice(offset)
      self._bytesOffset += sliced.length
      self._position += sliced.length
      return cb(null, sliced)
    })
  })
}

