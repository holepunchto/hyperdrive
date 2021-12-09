const raf = require('random-access-file')
const Corestore = require('corestore')
const fsctl = require('fsctl')

module.exports = function defaultCorestore (storage, opts) {
  if (isCorestore(storage)) return storage
  let factory;
  if (typeof storage === 'function') {
    factory = path => storage(path)
  } else if (typeof storage === 'string') {
    const sparse = opts.sparseWin ? fsctl.sparse : null;
    factory = path => raf(storage + '/' + path, { sparse })
  }
  return new Corestore(factory, opts)
}

function isCorestore (storage) {
  return storage.default && storage.get && storage.replicate && storage.close
}
