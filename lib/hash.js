var crypto = require('crypto')
var equals = require('buffer-equals')

var blank = createHash().update('').digest()

exports.blank = blank

exports.data = function (data) {
  return createHash().update(data).digest()
}

exports.tree = function (a, b) {
  if (equals(b, blank)) return a
  if (equals(a, blank)) return b
  return createHash().update(a).update(b).digest()
}

function createHash () {
  return crypto.createHash('sha256')
}
