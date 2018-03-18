const tape = require('tape')
const create = require('./helpers/create')

const DATA = Buffer.alloc(800 * 1000).fill('012345678')

tape('basic read stream', function (t) {
  oneFile(function (archive) {
    concat(archive.createReadStream('file'), function (data) {
      t.same(data, DATA)
      t.end()
    })
  })
})

tape('one file, read stream, start=1', function (t) {
  oneFile(function (archive) {
    concat(archive.createReadStream('file', {start: 1}), function (data) {
      t.same(data, DATA.slice(1))
      t.end()
    })
  })
})

tape('one file, read stream, start=70000', function (t) {
  oneFile(function (archive) {
    concat(archive.createReadStream('file', {start: 70000}), function (data) {
      t.same(data, DATA.slice(70000))
      t.end()
    })
  })
})

tape('one file, read stream, start=1, end=700000', function (t) {
  oneFile(function (archive) {
    concat(archive.createReadStream('file', {start: 1, end: 700000}), function (data) {
      t.same(data, DATA.slice(1, 700001))
      t.end()
    })
  })
})

tape('one file, read stream, start=70000, end=700000', function (t) {
  oneFile(function (archive) {
    concat(archive.createReadStream('file', {start: 70000, end: 700000}), function (data) {
      t.same(data, DATA.slice(70000, 700001))
      t.end()
    })
  })
})

tape('two files, basic read stream', function (t) {
  twoFiles(function (archive) {
    concat(archive.createReadStream('file'), function (data) {
      t.same(data, DATA)
      t.end()
    })
  })
})

tape('two files, read stream, start=1', function (t) {
  twoFiles(function (archive) {
    concat(archive.createReadStream('file', {start: 1}), function (data) {
      t.same(data, DATA.slice(1))
      t.end()
    })
  })
})

tape('two files, read stream, start=70000', function (t) {
  twoFiles(function (archive) {
    concat(archive.createReadStream('file', {start: 70000}), function (data) {
      t.same(data, DATA.slice(70000))
      t.end()
    })
  })
})

tape('two files, read stream, start=1, end=700000', function (t) {
  twoFiles(function (archive) {
    concat(archive.createReadStream('file', {start: 1, end: 700000}), function (data) {
      t.same(data, DATA.slice(1, 700001))
      t.end()
    })
  })
})

tape('two files, read stream, start=70000, end=700000', function (t) {
  twoFiles(function (archive) {
    concat(archive.createReadStream('file', {start: 70000, end: 700000}), function (data) {
      t.same(data, DATA.slice(70000, 700001))
      t.end()
    })
  })
})

function concat (stream, cb) {
  const bufs = []
  stream.on('data', data => bufs.push(data))
  stream.on('end', () => cb(Buffer.concat(bufs)))
}

function oneFile (ready) {
  const archive = create()

  archive.writeFile('file', DATA, function () {
    ready(archive)
  })
}

function twoFiles (ready) {
  const archive = create()

  archive.writeFile('another', DATA, function () {
    archive.writeFile('file', DATA, function () {
      ready(archive)
    })
  })
}
