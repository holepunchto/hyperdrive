var ram = require('random-access-memory')
var hyperdrive = require('../../')

module.exports = function (key, opts) {
  if (key && !(key instanceof Buffer)) {
    opts = key
    key = null
  }
  return hyperdrive((opts && opts.corestore) || ram, key, opts)
}
