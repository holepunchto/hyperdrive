# hyperdrive

A file sharing network based on [rabin](https://github.com/maxogden/rabin) file chunking and
append only feeds of data verified by merkle trees.

```
npm install hyperdrive
```

[![build status](http://img.shields.io/travis/mafintosh/hyperdrive.svg?style=flat)](http://travis-ci.org/mafintosh/hyperdrive)

# Status

## Almost ready for prime time :rocket:
## Feel free to open issues and ask questions

APIs/protocols might be still break.

Main things missing are:

- [ ] Storing downloaded files as actual files (not in leveldb doh)
- [ ] Full documention of the apis/protocols
- [ ] Tit-for-tat swarm logic
- [ ] Integrate peer discovery (currently has be handled externally)
- [ ] Tests for internal logic
- [x] A bit of refactoring

## Usage

First create a new feed to share

``` js
var hyperdrive = require('hyperdrive')
var fs = require('fs')

var drive = hyperdrive(aLevelDB)

var pack = drive.add()

var stream = pack.entry({
  name: 'my-file.txt',
  mode: 0644
})

fs.createReadStream('my-file.txt').pipe(stream)

pack.finalize(function () {
  var link = pack.id.toString('hex')
  console.log(link, '<-- this is your hyperdrive link')
})
```

Then to share it

``` js
var disc = require('discovery-channel')()

var server = net.createServer(function (socket) {
  socket.pipe(drive.createPeerStream()).pipe(socket)
})

server.listen(0, function () {
  function ann () {
    // discovery-channel currently only works with 20 bytes hashes
    disc.announce(link.slice(0, 20), server.address().port)
  }

  ann()
  setInterval(ann, 10000)

  var lookup = disc.lookup(hash.slice(0, 20))

  lookup.on('peer', function (ip, port) {
    var socket = net.connect(port, ip)
    socket.pipe(drive.createPeerStream()).pipe(socket)
  })
})
```

If you run this code on multiple computers you should be able to access
the content in the feed by doing

``` js
var feed = drive.get(link) // the link identifies/verifies the content

feed.get(0, function (err, entry) { // get the first entry
  console.log(entry) // prints {name: 'my-file.txt', ...}
  var content = drive.get(entry.link)
  content.get(0, function (err, data) {
    console.log('first block of the file', data)
    content.get(1, ...)
  })
})
```

## License

MIT
