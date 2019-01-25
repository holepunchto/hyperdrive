var ram = require('random-access-memory')
var Hyperdrive = require('../../')

module.exports = function (key, opts) {
  return new Hyperdrive(ram, key, opts)
}
