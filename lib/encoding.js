const c = require('compact-encoding')
const { compile, opt } = require('compact-encoding-struct')

const blob = compile({
  byteOffset: c.uint,
  blockOffset: c.uint,
  blockLength: c.uint,
  byteLength: c.uint
})

module.exports = compile({
  executable: c.bool,
  linkname: opt(c.string),
  blob: opt(blob),
  metadata: opt(c.json)
})
