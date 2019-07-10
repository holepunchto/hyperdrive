var tape = require('tape')
var create = require('./helpers/create')

var EXAMPLE_TYPE = 'example'
var EXTENSIONS = [EXAMPLE_TYPE]
var EXAMPLE_MESSAGE = Buffer.from([4, 20])

tape('send and receive extension messages', function (t) {
  var drive1 = create(null, {
    extensions: EXTENSIONS
  })

  drive1.ready(function () {
    t.plan(2)

    var drive2 = create(drive1.key, {
      extensions: EXTENSIONS
    })

    drive2.ready(function () {
      const replicate1 = drive1.replicate()
      const replicate2 = drive2.replicate()

      drive2.on('extension', function (type, message) {
        t.equal(type, EXAMPLE_TYPE)
        t.equal(message.toString('hex'), EXAMPLE_MESSAGE.toString('hex'))
      })

      drive1.metadata.on('peer-add', function () {
        drive1.extension(EXAMPLE_TYPE, EXAMPLE_MESSAGE)
      })

      replicate1.pipe(replicate2).pipe(replicate1)
    })
  })
})
