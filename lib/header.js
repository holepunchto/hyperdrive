const b4a = require('b4a')
const c = require('compact-encoding')

const SOFT_LIMIT = 128 * 1024

const uints = c.array(c.uint)

exports.encode = function ({ blocks, byteLengths }) {
  const result = []

  const state = { start: 0, end: 0, buffer: null }

  uints.preencode(state, blocks)
  uints.preencode(state, byteLengths)

  if (state.end > SOFT_LIMIT) {
    const result = []

    state.start = state.end = 0

    uints.preencode(state, blocks)
    state.buffer = b4a.allocUnsafe(state.end)
    uints.encode(state, blocks)

    result.push(state.buffer)

    state.start = state.end = 0

    uints.preencode(state, byteLengths)
    state.buffer = b4a.allocUnsafe(state.end)
    uints.encode(state, byteLengths)

    result.push(state.buffer)
    return result
  }

  state.buffer = b4a.allocUnsafe(state.end)
  uints.encode(state, blocks)
  uints.encode(state, byteLengths)

  result.push(state.buffer)

  return result
}

exports.decode = function (buf) {

}
