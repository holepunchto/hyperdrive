const tape = require('tape')
const sodium = require('sodium-universal')
const collect = require('stream-collector')

const FuzzBuzz = require('fuzzbuzz') 
const create = require('./helpers/create')

const MAX_PATH_DEPTH = 30
const MAX_FILE_LENGTH = 1e3
const CHARACTERS = 1e3
const INVALID_CHARS = new Set(['/', '\\', '?', '%', '*', ':', '|', '"', '<', '>', '.', ' '])

class HyperdriveFuzzer extends FuzzBuzz {
  constructor (opts) {
    super(opts)

    this.add(10, this.writeFile)
    this.add(5, this.deleteFile)
    this.add(5, this.existingFileOverwrite)
    this.add(3, this.statFile)
    this.add(3, this.statDirectory)
    this.add(2, this.deleteInvalidFile)
    this.add(2, this.randomReadStream)
    this.add(1, this.writeAndMkdir)
  }

  // START Helper functions.

  _select (map) {
    let idx = this.randomInt(map.size -1)
    if (idx < 0) return null

    let ite = map.entries()
    while (idx--) ite.next()
    return ite.next().value
  }
  _selectFile () {
    return this._select(this.files)
  }
  _selectDirectory () {
    return this._select(this.directories)
  }

  _validChar () {
    do {
      var char = String.fromCharCode(this.randomInt(CHARACTERS))
    } while (INVALID_CHARS.has(char))
    return char
  }
  _fileName () {
    do {
      let depth = Math.max(this.randomInt(MAX_PATH_DEPTH), 1)
      var name = (new Array(depth)).fill(0).map(() => this._validChar()).join('/')
    } while (this.files.get(name) || this.directories.get(name))
    return name
  }
  _createFile () {
    let name = this._fileName()
    let content = Buffer.allocUnsafe(this.randomInt(MAX_FILE_LENGTH)).fill(0).map(() => this.randomInt(10))
    return { name, content }
  }
  _deleteFile (name) {
    return new Promise((resolve, reject) => {
      this.drive.unlink(name, err => {
        if (err) return reject(err)
        this.files.delete(name)
        return resolve({ type: 'delete', name })
      })
    })
  }

  // START FuzzBuzz interface

  _setup () {
    this.drive = create() 
    this.files = new Map()
    this.directories = new Map()
    this.streams = new Map()
    this.log = []

    return new Promise((resolve, reject) => {
      this.drive.contentReady(err => {
        if (err) return reject(err)
        return resolve()
      })
    })
  }

  _validationDrive () {
    return this.drive
  }
  _validateFile (name, content) {
    let drive = this._validationDrive()
    return new Promise((resolve, reject) => {
      drive.readFile(name, (err, data) => {
        if (err) return reject(err)
        if (!data.equals(content)) return reject(new Error(`Read data for ${name} does not match written content.`))
        return resolve()
      })
    })
  }
  _validateDirectory (name, list) {
    /*
    let drive = this._validationDrive()
    return new Promise((resolve, reject) => {
      drive.readdir(name, (err, list) => {
        if (err) return reject(err)
        let fileSet = new Set(list)
        for (const file of list) {
          if (!fileSet.has(file)) return reject(new Error(`Directory does not contain expected file: ${file}`))
          fileSet.delete(file)
        }
        if (fileSet.size) return reject(new Error(`Directory contains unexpected files: ${fileSet}`))
        return resolve()
      })
    })
    */
  }
  async _validate () {
    for (const [fileName, content] of this.files) {
      await this._validateFile(fileName, content)
    }
    for (const [dirName, list] of this.directories) {
      await this._validateDirectory(dirName, list)
    }
  }


  async call (ops) {
    if (!this._counter) this._counter = 0
    let res = await super.call(ops)
    this.log.push(res)
  }

  // START Fuzzing operations

  async writeFile () {
    let { name, content } = this._createFile()
    return new Promise((resolve, reject) => {
      this.drive.writeFile(name, content, err => {
        if (err) return reject(err)
        this.files.set(name, content)
        return resolve({ type: 'write', name, content })
      })
    })
  }

  async deleteFile () {
    let selected = this._selectFile()
    if (!selected) return

    let fileName = selected[0]
    return this._deleteFile(fileName)
  }

  async deleteInvalidFile () {
    let name = this._fileName()
    while (this.files.get(name)) name = this._fileName()
    try {
      await this._deleteFile(name)
    } catch (err) {
      if (err && err.code !== 'ENOENT') throw err
    }
  }

  statFile () {
    let selected = this._selectFile()
    if (!selected) return

    let [fileName, content] = selected
    return new Promise((resolve, reject) => {
      this.drive.stat(fileName, (err, st) => {
        if (err) return reject(err)
        if (!st) return reject(new Error(`File ${fileName} should exist but does not exist.`))
        if (st.size !== content.length) return reject(new Error(`Incorrect content length for file ${fileName}.`))
        return resolve({ type: 'stat', fileName, stat: st })
      })
    })
  }

  statDirectory () {
    let selected = this._selectDirectory()
    if (!selected) return

    let [dirName, { offset, byteOffset }] = selected

    this.debug(`Statting directory ${dirName}.`)
    let fileStat = JSON.stringify(this.files.get(dirName))
    this.debug(`   File stat for name: ${fileStat} and typeof ${typeof fileStat}`)
    return new Promise((resolve, reject) => {
      this.drive.stat(dirName, (err, st) => {
        if (err) return reject(err)
        this.debug(`Stat for directory ${dirName}: ${JSON.stringify(st)}`)
        if (!st) return reject(new Error(`Directory ${dirName} should exist but does not exist.`))
        if (!st.isDirectory()) return reject(new Error(`Stat for directory ${dirName} does not have directory mode`))
        if (st.offset !== offset || st.byteOffset !== byteOffset) return reject(new Error(`Invalid offsets for ${dirName}`))
        return resolve({ type: 'stat', dirName })
      })
    })
  }

  existingFileOverwrite () {
    let selected = this._selectFile()
    if (!selected) return
    let [fileName, content] = selected

    let { content: newContent } = this._createFile()

    return new Promise((resolve, reject) => {
      let writeStream = this.drive.createWriteStream(fileName)
      writeStream.on('error', err => reject(err))
      writeStream.on('finish', () => {
        this.files.set(fileName, newContent)
        resolve()
      })
      writeStream.end(newContent)
    })
  }

  randomReadStream () {
    let selected = this._selectFile()
    if (!selected) return
    let [fileName, content] = selected


    return new Promise((resolve, reject) => {
      let drive = this._validationDrive()
      let start = this.randomInt(content.length)
      this.debug(`Creating random read stream for ${fileName} at start ${start}`)
      let stream = drive.createReadStream(fileName, {
        start
      })
      collect(stream, (err, bufs) => {
        if (err) return reject(err)
        let buf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs)
        if (!buf.equals(content.slice(start))) return reject(new Error('Read stream does not match content slice.'))
        this.debug(`Random read stream for ${fileName} succeeded.`)
        return resolve()
      })
    })
  }

  writeAndMkdir () {
    const self = this

    let { name: fileName, content } = this._createFile()
    let dirName = this._fileName()

    return new Promise((resolve, reject) => {
      let pending = 2

      let offset = this.drive._contentFeedLength
      let byteOffset = this.drive._contentFeedByteLength

      let writeStream = this.drive.createWriteStream(fileName)
      writeStream.on('finish', done)

      this.drive.mkdir(dirName, done)
      writeStream.end(content)

      function done (err) {
        if (err) return reject(err)
        if (!--pending) {
          self.files.set(fileName, content)
          self.debug(`Created directory ${dirName}`)
          self.directories.set(dirName, {
            offset,
            byteOffset
          })
          return resolve()
        }
      }
    })
  }
}

class SparseHyperdriveFuzzer extends HyperdriveFuzzer {
  constructor(opts) {
    super(opts)
  }
  async _setup () {
    await super._setup()

    this.remoteDrive = create(this.drive.key)

    return new Promise((resolve, reject) => {
      this.remoteDrive.ready(err => {
        if (err) throw err
        let s1 = this.remoteDrive.replicate({ live: true })
        s1.pipe(this.drive.replicate({ live: true })).pipe(s1)
        this.remoteDrive.contentReady(err => {
          if (err) return reject(err)
          return resolve()
        })
      })
    })
  }
  _validationDrive () {
    return this.remoteDrive
  }
}

module.exports = HyperdriveFuzzer

tape('20000 mixed operations, single drive', async t => {
  t.plan(1)

  const fuzz = new HyperdriveFuzzer({
    seed: 'hyperdrive',
    debugging: false
  })

  try {
    await fuzz.run(20000)
    t.pass('fuzzing succeeded')
  } catch (err) {
    t.error(err, 'no error')
  }
})

tape('20000 mixed operations, replicating drives', async t => {
  t.plan(1)

  const fuzz = new SparseHyperdriveFuzzer({
    seed: 'hyperdrive2',
    debugging: false
  })

  try {
    await fuzz.run(20000)
    t.pass('fuzzing succeeded')
  } catch (err) {
    t.error(err, 'no error')
  }
})

tape('100 quick validations (initialization timing)', async t => {
  t.plan(1)

  try {
    for (let i = 0; i < 100; i++) {
      const fuzz = new SparseHyperdriveFuzzer({
        seed: 'iteration #' + i,
        debugging: false
      })
      await fuzz.run(100)
    }
    t.pass('fuzzing suceeded')
  } catch (err) {
    t.error(err, 'no error')
  }
})
