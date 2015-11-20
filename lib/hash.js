var crypto = require('crypto')
var equals = require('buffer-equals')

// https://en.wikipedia.org/wiki/Merkle_tree#Second_preimage_attack
var DATA_TYPE = new Buffer([0])
var TREE_TYPE = new Buffer([1])
var BLANK = createHash().update('').digest()

exports.blank = BLANK

exports.data = function (data) {
  return createHash().update(DATA_TYPE).update(data).digest()
}

exports.tree = function (a, b) {
  if (equals(b, BLANK)) return a
  if (equals(a, BLANK)) return b
  return createHash().update(TREE_TYPE).update(a).update(b).digest()
}

function createHash () {
  return crypto.createHash('sha256')
}
