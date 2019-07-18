const raf = require('random-access-file')
const corestore = require('corestore')
const { Corestore } = corestore

module.exports = function defaultCorestore (storage, opts) {
  if (storage instanceof Corestore) return storage
  if (typeof storage === 'function') {
    var factory = path => storage(path)
  } else if (typeof storage === 'string') {
    factory = path => raf(storage + '/' + path)
  }
  return corestore(factory, opts)
}
