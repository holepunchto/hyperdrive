const p = require('path').posix
const nanoiterator = require('nanoiterator')
const toStream = require('nanoiterator/to-stream')

const Stat = require('./stat')

function statIterator (drive, db, path, opts) {
  const stack = []
  return nanoiterator({ open, next })

  function open (cb) {
    db.ready(err => {
      if (err) return cb(err)
      stack.unshift({ path: '/', target: null, iterator: db.iterator(path, opts) })
      return cb(null)
    })
  }

  function next (cb) {
    if (!stack.length) return cb(null, null)
    stack[0].iterator.next((err, node) => {
      if (err) return cb(err)
      if (!node) {
        stack.shift()
        return next(cb)
      }

      try {
        var st = Stat.decode(node.value)
      } catch (err) {
        return cb(err)
      }

      console.log('NEXT NODE:', node)

      if (st.linkname) {
        if (p.isAbsolute(st.linkname)) {
          var linkPath = st.linkname
        } else {
          linkPath = p.resolve('/', p.dirname(node.key), st.linkname)
        }
        console.log('HANDLING A LINK HERE, linkPath:', linkPath, 'path:', node.key, 'linkname:', st.linkname)
        return pushLink(prefix(node.key), linkPath, (err, linkStat) => {
          if (err) return cb(err)
          console.log('linkStat:', linkStat)
          if (linkStat) return cb(null, { stat: linkStat, path: prefix(node.key) })
          return next(cb)
        })
      }
      linkPath = stack[0].path
      const resolved = (linkPath === '/') ? node.key : p.join(linkPath, node.key.slice(stack[0].target.length))
      console.log('RETURNING PATH:', resolved, 'STACK PATH:', stack[0].path, 'KEY:', node.key)
      return cb(null, { stat: st, path: prefix(resolved) })
    })
  }

  function pushLink (nodePath, linkPath, cb) {
    drive.stat(linkPath, (err, stat, _, resolvedLink) => {
      console.log('GOT LINK INFO', linkPath, 'NODEPATH:', nodePath, 'STAT:', stat, 'RESOLVED LINK', resolvedLink)
      if (!stat) return cb(null)
      if (stat.isDirectory()) {
        console.log('IT IS A DIRECTORY, NODEPATH:', nodePath, 'PATH:', path)
        if (opts && opts.recursive || nodePath === path) {
          stack.unshift({ path: nodePath, target: resolvedLink, iterator: db.iterator(resolvedLink, { gt: true, ...opts }) })
          console.log('UNSHIFTED ITERATOR FOR', 'path:', nodePath, 'target:', resolvedLink)
          return cb(null)
        }
        return cb(null, { stat, path: linkPath})
      }
      return cb(null, stat)
    })
  }
}

function createStatStream (drive, db, path, opts) {
  const ite = statIterator(drive, db, path, opts)
  return toStream(ite)
}

function prefix (key) {
  if (key.startsWith('/')) return key
  return '/' + key
}

module.exports = {
  statIterator,
  createStatStream
}

