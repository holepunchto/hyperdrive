module.exports.runAll = function (ops) {
  return new Promise((resolve, reject) => {
    runNext(ops.shift())
    function runNext (op) {
      op(err => {
        if (err) return reject(err)
        let next = ops.shift()
        if (!next) return resolve()
        return runNext(next)
      })
    }
  })
}
