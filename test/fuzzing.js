const tape = require('tape')
const sodium = require('sodium-universal')
const FuzzBuzz = require('fuzzbuzz') 
const create = require('./helpers/create')

const MAX_PATH_DEPTH = 30
const MAX_FILE_LENGTH = 1e4
const CHARACTERS = 1e3
const INVALID_CHARS = new Set(['/', '\\', '?', '%', '*', ':', '|', '"', '<', '>', '.', ' '])

class Peer {
  constructor (drive, files) {
    this.drive = drive
    this.files = files
  }
}

class HyperdriveFuzzer extends FuzzBuzz {
  constructor (opts) {
    super(opts)

    this.add(10, this.writeFile)
    this.add(5, this.deleteFile)
    this.add(5, this.existingFileOverwrite)
    this.add(3, this.statFile)
    this.add(2, this.deleteInvalidFile)
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
    } while(INVALID_CHARS.has(char))
    return char
  }
  _fileName () {
    let depth = this.randomInt(MAX_PATH_DEPTH)
    let name = (new Array(depth)).fill(0).map(() => this._validChar()).join('/')
    return name
  }
  _createFile () {
    let name = this._fileName()
    let content = Buffer.allocUnsafe(this.randomInt(MAX_FILE_LENGTH)).fill(this.randomInt(10))
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
      this.drive.ready(err => {
        if (err) return reject(err)
        return resolve()
      })
    })
  }

  _validateFile (name, content) {
    return new Promise((resolve, reject) => {
      this.drive.readFile(name, (err, data) => {
        if (err) return reject(err)
        if (!data.equals(content)) return reject(new Error(`Read data for ${name} does not match written content.`))
        return resolve()
      })
    })
  }
  _validateDirectory (name, list) {
    return new Promise((resolve, reject) => {
      this.drive.readdir(name, (err, list) => {
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
        if (!st) return reject(new Error(`File ${fileName} should exist does not exist.`))
        if (st.size !== content.length) return reject(new Error(`Incorrect content length for file ${fileName}.`))
        return resolve({ type: 'stat', fileName, stat: st })
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

  readFileStream () {
  }
}

module.exports = HyperdriveFuzzer

tape('100000 mixed operations', async t => {
  t.plan(1)

  const fuzz = new HyperdriveFuzzer({
    seed: 'hyperdrive'
  })

  try {
    await fuzz.run(100000)
    t.pass('fuzzing succeeded')
  } catch (err) {
    t.error(err, 'no error')
  }
})
