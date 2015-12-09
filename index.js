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
var speedometer = require('speedometer')
var csv = require('csv-parser')

function createElem (tagName) {
  var elem = document.createElement(tagName)
  elem.controls = true
  elem.autoplay = true // for chrome
  elem.play() // for firefox
  document.body.appendChild(elem)
  return elem
}

function resetFrame () {
  document.getElementById('container').innerHTML = '<iframe id="display" style="width: 100%; margin: 0; padding: 0; border: 0; height: 400px"></iframe>'
  $display = document.getElementById('display')
}

var $intro = document.getElementById('intro')
var $sharing = document.getElementById('sharing')
var $linkBox = document.getElementById('link-box')
var $status = document.getElementById('status')
var $links = document.getElementById('links')
var $display = document.getElementById('display')
var $hint = document.getElementById('hint')
var $video = createElem('video')

$display.style.display = 'none'
$video.style.display = 'none'

var downloadSpeed = speedometer()
var db = memdb('hyperdrive-test')
var drive = hyperdrive(db)

if (window.location.hash) {
  ready(new Buffer(window.location.hash.replace('#', ''), 'hex'))
} else {
  $intro.style.display = 'block'
  add()
}

function ready (id) {
  $intro.style.display = 'none'
  $sharing.style.display = 'block'

  var key = id.toString('hex')
  var hub = signalhub('hyperdrive/' + key, ['https://signalhub.mafintosh.com'])

  // $share.innerText = window.location.toString().split('#')[0] + '#' + key
  // $share.href = $share.innerText

  $linkBox.value = window.location.toString().split('#')[0] + '#' + key
  $status.innerText = 'Joining swarm ...'

  var peers = 0
  var swarm = webrtcSwarm(hub)
  var feed = drive.get(id)

  feed._state.on('put', function (block, data) {
    downloadSpeed(data.length)
  })

  feed.createStream().on('data', function (entry) {
    $hint.style.display = 'block'
    console.log(entry, entry.link && entry.link.id.toString('hex'))
    var file = drive.get(entry) // hackish to fetch it always - should be an api for this!
    file._state.on('put', function (block, data) {
      downloadSpeed(data.length)
    })

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
      } else if (ext === 'csv') {
        $video.style.display = 'none'
        $display.style.display = 'block'
        resetFrame()
        var b = $display.contentDocument.body
        b.innerHTML = '<table id="table"></table>'
        var t = $display.contentDocument.getElementById('table')
        var parser = file.createStream().pipe(csv())
        var inc = 0

        var more = document.createElement('a')
        more.innerText = 'load 5 more'
        more.onclick = function () {
          parser.resume()
        }
        more.href = 'javascript:void(0)'

        parser.on('data', function (data) {
          if (!inc++) {
            var tr = document.createElement('tr')
            Object.keys(data).forEach(function (name) {
              var th = document.createElement('th')
              th.innerText = name
              tr.appendChild(th)
            })
            t.appendChild(tr)
          }
          var tr = document.createElement('tr')
          Object.keys(data).forEach(function (name) {
            var td = document.createElement('td')
            td.innerText = data[name]
            tr.appendChild(td)
          })
          t.appendChild(tr)

          if (inc % 5 === 0) {
            if (inc !== 5) $display.contentDocument.body.removeChild(more)
            $display.contentDocument.body.appendChild(more)
            parser.pause()
          }
        })
      } else {
        $video.style.display = 'none'
        $display.style.display = 'block'
        resetFrame()
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

  setInterval(function () {
    $status.innerText = 'Connected to ' + peers + ' peer(s) - Downloading ' + pretty(downloadSpeed() | 0) + '/s'
  }, 500)

  swarm.on('peer', function (peer) {
    console.log('New peer!')
    peers++
    $status.innerText = 'Connected to ' + peers + ' peer(s) - Downloading ' + pretty(downloadSpeed() | 0) + '/s'
    pump(peer, drive.createPeerStream(), peer, function () {
      peers--
      $status.innerText = 'Connected to ' + peers + ' peer(s) - Downloading ' + pretty(downloadSpeed() | 0) + '/s'
    })
  })
}

function add () {
  // $share.innerText = 'Drag and drop some files to get going'
}

drop(window, function (files) {
  $status.innerText = 'Adding files...'

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
      window.location.hash = '#' + pack.id.toString('hex')
      ready(pack.id)
    })
  }
})
