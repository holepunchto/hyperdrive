var ram = require('random-access-memory')
var hyperdrive = require('../../')

module.exports = function (key, opts) {
  return hyperdrive(ram, key, opts)
}
