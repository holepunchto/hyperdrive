class ExtendableError extends Error {
  constructor (msg, syscall, path, errno) {
    super(msg)

    this.name = this.constructor.name
    this.message = `${msg}, ${syscall} '${path}'`
    this.code = this.name
    this.errno = errno

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor)
    } else {
      this.stack = (new Error(msg)).stack
    }
  }
}

exports.ENOENT = class ENOENT extends ExtendableError {
  constructor (syscall, path) {
    super('no such file or directory', syscall, path, -2)
  }
}

exports.EPROTO = class EPROTO extends ExtendableError {
  constructor (syscall, path) {
    super('protocol error', syscall, path, 38)
  }
}
