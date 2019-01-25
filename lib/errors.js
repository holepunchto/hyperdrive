const CustomError = require('custom-error-class')

class FileNotFound extends CustomError {
  constructor (fileName) {
    super(`File '${fileName}' not found.`)
    this.code = 'ENOENT'
    this.errno = 2
  }
}

module.exports = {
  FileNotFound
}
