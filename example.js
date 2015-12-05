var hyperdrive = require('./')
var addr = require('network-address')
var net = require('net')
var dc = require('discovery-channel')
var pump = require('pump')

var hash = new Buffer('ee4565bb12e34cfa90af4b8806251c1ddcd2350e7edafb971ef29faaee5b293d', 'hex')

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

    // var a = file.cursor()
    // a.read(2, console.log)

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

// var remote = hyperdrive(require('memdb')(), {name: 'remote'})

// var f = remote.get('0fc4a1644ec17df7e69a35a35fe1eb7e3823b41576dc2dab783ea41357a19487')

// var s1 = drive.swarm.createStream()
// var s2 = remote.swarm.createStream()

// s1.pipe(s2).pipe(s1)

// // f.get(0, function (err, entry) {
// //   console.log(entry, '<-- metadata feed')
// //   var f2 = remote.get(entry.link)
// //   f2.get(0, function () {
// //     f2.get(4, function (err, blk) {
// //       console.log('-->', blk)
// //     })
// //   })
// //   // var nested = drive.get(entry.link)
// // })
