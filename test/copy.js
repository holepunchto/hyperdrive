const tape = require('tape')
const create = require('./helpers/create')

tape('Should copy content', t => {
    var drive = create()

    drive.writeFile('hello', 'foo', err => {
        t.error(err, 'no error')
        drive.copy('hello', 'world', err => {
            t.error(err, 'no error')

            drive.readdir('/', (err, entries) => {
                t.error(err, 'no error')
                t.same(entries.sort(), ['hello', 'world'].sort())

                drive.readFile('hello', { encoding: 'utf8' }, (err, contents) => {
                    t.error(err, 'no error')
                    t.same(contents, 'foo')

                    drive.readFile('world', { encoding: 'utf8' }, (err, contents) => {
                        t.error(err, 'no error')
                        t.same(contents, 'foo')

                        t.end()
                    })
                })
            })
        })
    })
})

tape('Should copy content over existing one', t => {
    var drive = create()

    drive.writeFile('hello', 'foo', err => {
        t.error(err, 'no error')
        drive.writeFile('world', 'bar', err => {
            t.error(err, 'no error')

            drive.copy('hello', 'world', err => {
                t.error(err, 'no error')

                drive.readdir('/', (err, entries) => {
                    t.error(err, 'no error')
                    t.same(entries.sort(), ['hello', 'world'].sort())

                    drive.readFile('hello', { encoding: 'utf8' }, (err, contents) => {
                        t.error(err, 'no error')
                        t.same(contents, 'foo')

                        drive.readFile('world', { encoding: 'utf8' }, (err, contents) => {
                            t.error(err, 'no error')
                            t.same(contents, 'foo')

                            t.end()
                        })
                    })
                })
            })
        })
    })
})