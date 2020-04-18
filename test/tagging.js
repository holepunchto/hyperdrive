const test = require('tape')
const create = require('./helpers/create')

test('can create a tag for the current version', t => {
  var drive = create()
  drive.writeFile('/hello.txt', 'world', err => {
    t.error(err, 'no error')
    const taggedVersion = drive.version
    drive.createTag('version1', err => {
      t.error(err, 'no error')
      drive.getTaggedVersion('version1', (err, version) => {
        t.error(err, 'no error')
        t.same(version, taggedVersion)
        t.end()
      })
    })
  })
})

test('can create a tag for an explicit version', t => {
  var drive = create()
  drive.writeFile('/hello.txt', 'world', err => {
    t.error(err, 'no error')
    const taggedVersion = drive.version
    drive.writeFile('/goodbye.txt', 'goodbye', err => {
      t.error(err, 'no error')
      drive.createTag('version1', taggedVersion, err => {
        t.error(err, 'no error')
        drive.getTaggedVersion('version1', (err, version) => {
          t.error(err, 'no error')
          t.same(version, taggedVersion)
          t.end()
        })
      })
    })
  })
})

test('can list all tags', t => {
  var drive = create()
  const versions = new Map()

 drive.writeFile('/hello.txt', 'world', err => {
    t.error(err, 'no error')
    versions.set('version1', drive.version)
    drive.createTag('version1', err => {
      t.error(err, 'no error')
      drive.writeFile('/goodbye.txt', 'goodbye', err => {
        t.error(err, 'no error')
        versions.set('version2', drive.version)
        drive.createTag('version2', err => {
          t.error(err, 'no error')
          return ontagged()
        })
      })
    })
  })

  function ontagged () {
    drive.getAllTags((err, tagMap) => {
      t.error(err, 'no error')
      t.same(tagMap.size, 2)
      t.same(tagMap.get('version1'), versions.get('version1'))
      t.same(tagMap.get('version2'), versions.get('version2'))
      t.end()
    })
  }
})

test('can delete a tag', t => {
  var drive = create()
  const versions = new Map()

  drive.writeFile('/hello.txt', 'world', err => {
    t.error(err, 'no error')
    versions.set('version1', drive.version)
    drive.createTag('version1', err => {
      t.error(err, 'no error')
      drive.writeFile('/goodbye.txt', 'goodbye', err => {
        t.error(err, 'no error')
        versions.set('version2', drive.version)
        drive.createTag('version2', err => {
          t.error(err, 'no error')
          drive.deleteTag('version1', err => {
            t.error(err, 'no error')
            return ontagged()
          })
        })
      })
    })
  })

  function ontagged () {
    drive.getAllTags((err, tagMap) => {
      t.error(err, 'no error')
      t.same(tagMap.size, 1)
      t.same(tagMap.get('version2'), versions.get('version2'))
      t.false(tagMap.get('version1'))
      t.end()
    })
  }
})
