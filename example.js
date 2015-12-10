var hyperdrive = require('./')
var addr = require('network-address')
var net = require('net')
var dc = require('discovery-channel')
var pump = require('pump')

var hash = new Buffer('cb8f51acc3e21baee2307c4425fe1c302a9a2c9eb02adfa980bda3461ed2a8df', 'hex')

function run (name) {
  var disc = dc()
  var peers = {}

  var drive = hyperdrive(require('level')(name + '.db'), {name: name})

  var feed = drive.get(hash)

  feed.get(0, function (err, entry) {
    if (err) throw err
    console.log('Downloaded metadata for entry #0,', entry)
    console.log('Fetching and printing file now')

    var file = drive.get(entry)
    var inc = 0

    file.get(inc++, function loop (err, block) {
      if (err) throw err
      process.stdout.write(block)
      if (inc === entry.link.blocks - entry.link.index.length) {
        console.log('\n(end of file)')
        return
      }
      file.get(inc++, loop)
    })
  })

  var server = net.createServer(function (socket) {
    console.log('Received new connection')
    pump(socket, drive.createPeerStream(), socket)
  })

  server.listen(0, function () {
    function ann () {
      console.log('Announcing hash (%s)', hash.toString('hex', 0, 20))
      disc.announce(hash.slice(0, 20), server.address().port)
    }

    ann()
    setInterval(ann, 10000)

    var lookup = disc.lookup(hash.slice(0, 20))

    lookup.on('peer', function (ip, port) {
      if (port === server.address().port && ip === addr()) return
      if (peers[ip + ':' + port]) return
      peers[ip + ':' + port] = true

      var socket = net.connect(port, ip)
      console.log('Connecting to %s:%d', ip, port)
      pump(socket, drive.createPeerStream(), socket, function () {
        delete peers[ip + ':' + port]
      })
    })
  })
}

run(process.argv[2] || 'test')
