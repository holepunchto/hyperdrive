const raf = require('random-access-file')
const corestore = require('random-access-corestore')

module.exports = function defaultCorestore (storage, opts) {
  if (isCorestore(storage)) return storage
  if (typeof storage === 'function') {
    var factory = path => storage(path)
  } else if (typeof storage === 'string') {
    factory = path => raf(storage + '/' + path)
  }
  return corestore(factory, opts)
}

function isCorestore (storage) {
  return storage.get && storage.replicate && storage.close
}
