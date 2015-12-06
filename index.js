var hyperdrive = require('hyperdrive')
var level = require('level-browserify')
var webrtcSwarm = require('webrtc-swarm')
var signalhub = require('signalhub')
var mimes = require('mimes')
var pump = require('pump')
var drop = require('drag-and-drop-files')
var fileReader = require('filereader-stream')
var pretty = require('pretty-bytes')
var choppa = require('choppa')
var memdb = require('memdb')
var videostream = require('videostream')

function createElem (tagName) {
  var elem = document.createElement(tagName)
  elem.controls = true
  elem.autoplay = true // for chrome
  elem.play() // for firefox
  document.body.appendChild(elem)
  return elem
}

var $share = document.getElementById('share')
var $status = document.getElementById('status')
var $links = document.getElementById('links')
var $display = document.getElementById('display')
var $video = createElem('video')

$display.style.display = 'none'
$video.style.display = 'none'


var db = memdb('hyperdrive-test')
var drive = hyperdrive(db)

if (window.location.hash) {
  ready(new Buffer(window.location.hash.replace('#', ''), 'hex'))
} else {
  add()
}

function ready (id) {
  var key = id.toString('hex')
  var hub = signalhub('hyperdrive/' + key, ['https://signalhub.mafintosh.com'])

  $share.innerText = window.location.toString().split('#')[0] + '#' + key
  $share.href = $share.innerText

  $status.innerText = 'Joining swarm ...'

  var peers = 0
  var swarm = webrtcSwarm(hub)
  var feed = drive.get(id)

  feed.createStream().on('data', function (entry) {
    console.log(entry)
    var file = drive.get(entry) // hackish to fetch it always - should be an api for this!

    var div = document.createElement('div')
    var a = document.createElement('a')

    a.href = 'javascript:void(0)'
    a.innerText = entry.value.name + ' (' + pretty(entry.value.size) + ')'

    a.onclick = function () {
      var buffers = []
      var ext = entry.value.name.split('.').pop().toLowerCase()
      var type = mimes[ext] || 'application/octet-stream'
      if (ext === 'mp4') {
        $display.style.display = 'none'
        $video.style.display = 'block'
        var f = {
          length: entry.value.size,
          createReadStream: function (opts) {
            console.log(opts)
            return file.createStream(opts)
          }
        }
        videostream(f, $video)
      } else {
        $video.style.display = 'none'
        $display.style.display = 'block'
        file.createStream()
          .on('data', function (data) {
            buffers.push(data)
          })
          .on('end', function () {
            $display.src = 'data:' + type + ';base64,' + Buffer.concat(buffers).toString('base64')
          })
      }
    }

    div.appendChild(a)
    $links.appendChild(div)
  })

  swarm.on('peer', function (peer) {
    console.log('New peer!')
    peers++
    $status.innerText = 'Connected to ' + peers + ' peer(s)'
    pump(peer, drive.createPeerStream(), peer, function () {
      peers--
      $status.innerText = 'Connected to ' + peers + ' peer(s)'
    })
  })
}

function add () {
  $share.innerText = 'Drag and drop some files to get going'
}

drop(window, function (files) {
  $share.innerText = 'Adding files...'

  var pack = drive.add()
  var i = 0
  loop()

  function loop () {
    if (i === files.length) return done()

    var file = files[i++]

    console.log('Adding', file.name)

    var reader = fileReader(file, {chunkSize: 5 * 1024 * 1024})
    var stream = pack.entry({
      name: file.name
    })

    reader.pipe(choppa(16 * 1024)).pipe(stream).on('finish', loop)
    reader.on('data', function (data) {
      console.log('reading ' + data.length)
    })
  }

  function done () {
    pack.finalize(function () {
      ready(pack.id)
    })
  }
})
