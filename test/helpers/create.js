var ram = require('random-access-memory')
var Hyperdrive = require('../../')

module.exports = function (key, opts) {
  if (key && !(key instanceof Buffer)) {
    opts = key
    key = null
  }
  return new Hyperdrive((opts && opts.corestore) || ram, key, opts)
}
