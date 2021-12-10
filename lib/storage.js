const raf = require('random-access-file');
const Corestore = require('corestore');
const join = require('path').join;
const fsctl = require('fsctl');

module.exports = function defaultCorestore(storage, opts) {
  if (isCorestore(storage)) return storage;
  let factory = null;
  console.log(storage);
  switch (typeof storage) {
    case 'function':
      return new Corestore((path) => storage(path), opts);
    case 'string':
      const sparseWin =
        opts.sparseWin && process.platform === 'win32'
          ? fsctl.sparse
          : opts.sparse;
      return new Corestore(
        (path) => raf(join(storage, path), { ...opts, sparse: sparseWin }),
        opts
      );
    default:
      throw new Error(
        'hyperdrive expects "storage" of type function|string, but got ' +
          typeof storage
      );
  }
};

function isCorestore(storage) {
  return storage.default && storage.get && storage.replicate && storage.close;
}
