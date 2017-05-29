module.exports = Cursor

function Cursor (archive) {
  if (!(this instanceof Cursor)) return new Cursor(archive)
  this.archive = archive
}

Cursor.prototype.seek = function (bytes, cb) {

}

Cursor.prototype.next = function (cb) {

}

Cursor.prototype.prev = function (cb) {

}
