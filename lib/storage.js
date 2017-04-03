var path = require('path')
var raf = require('random-access-file')
var multi = require('multi-random-access')
var messages = require('append-tree/messages')
var stat = require('./messages').Stat

module.exports = storage

function storage (self, dir) {
  return multi({limit: 64}, function (offset, cb) {
    self.ready(function (err) {
      if (err) return cb(err)

      find(self.metadata, offset, function (err, node, st) {
        if (err) return cb(err)
        if (!node) return cb(new Error('Could not locate data'))

        cb(null, {
          start: st.head.byteLength - st.size,
          end: st.head.byteLength,
          storage: raf(path.join(dir, node.name))
        })
      })
    })
  })
}

function get (metadata, btm, seq, cb) {
  if (seq < btm) return cb(null, -1, null)

  // TODO: this can be done a lot faster using the hypercore internal iterators, expose!
  var i = seq
  while (!metadata.has(i) && i > btm) i--
  if (!metadata.has(i)) return cb(null, -1, null)

  metadata.get(i, {valueEncoding: messages.Node}, function (err, node) {
    if (err) return cb(err)
    if (!node.value) return get(btm, i - 1, cb) // TODO: check the index instead for fast lookup
    cb(null, i, node)
  })
}

function find (metadata, bytes, cb) {
  var top = metadata.length - 1
  var btm = 1
  var mid = Math.floor((top + btm) / 2)

  get(metadata, btm, mid, function loop (err, actual, node) {
    if (err) return cb(err)

    var st = stat.decode(node.value)
    var head = st.head
    var start = head.byteLength - st.size
    var end = head.byteLength

    if (start <= bytes && bytes < end) return cb(null, node, st)
    if (top <= btm) return cb(null, null, null)

    var oldMid = mid

    if (bytes < start) {
      top = mid
      mid = Math.floor((top + btm) / 2)
    } else {
      btm = mid
      mid = Math.floor((top + btm) / 2)
    }

    if (mid === oldMid) {
      if (btm < top) mid++
      else return cb(null, null, null)
    }

    get(metadata, btm, mid, loop)
  })
}
