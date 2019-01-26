const CustomError = require('custom-error-class')

class FileNotFound extends CustomError {
  constructor (fileName) {
    super(`File '${fileName}' not found.`)
    this.code = 'ENOENT'
    this.errno = 2
  }
}

class DirectoryNotEmpty extends CustomError {
  constructor (dirName) {
    super(`Directory '${dirName}' is not empty.`)
    this.code = 'ENOTEMPTY'
    this.errno = 39
  }
}

module.exports = {
  FileNotFound,
  DirectoryNotEmpty
}
