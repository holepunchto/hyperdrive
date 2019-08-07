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

      if (st.linkname && (opts.recursive || stack.length === 1)) {
        if (p.isAbsolute(st.linkname)) {
          var linkPath = st.linkname
        } else {
          linkPath = p.resolve('/', p.dirname(node.key), st.linkname)
        }
        return pushLink(prefix(node.key), linkPath, st, (err, linkStat) => {
          if (err) return cb(err)
          if (linkStat) return cb(null, { stat: st, path: prefix(node.key) })
          return next(cb)
        })
      }
      linkPath = stack[0].path
      const resolved = (linkPath === '/') ? node.key : p.join(linkPath, node.key.slice(stack[0].target.length))
      return cb(null, { stat: st, path: prefix(resolved) })
    })
  }

  function pushLink (nodePath, linkPath, stat, cb) {
    if (opts && opts.recursive || (nodePath === path)) {
      return drive.stat(linkPath, (err, targetStat, _, resolvedLink) => {
        if (err && err.errno !== 2) return cb(err)
        if (!targetStat) return cb(null)
        if (targetStat.isDirectory()) {
          stack.unshift({ path: nodePath, target: resolvedLink, iterator: db.iterator(resolvedLink, { gt: true, ...opts }) })
        }
        return cb(null, stat)
      })
    }
    return process.nextTick(cb, null, stat)
  }
}

function mountIterator (drive, db, opts) {
  var ite = db.mountIterator(opts)
  var first = drive

  return nanoiterator({
    next: function next (cb) {
      if (first) {
        first = null
        return cb(null, {
          path: '/',
          metadata: drive.metadata,
          content: drive._contentStates.get(db).feed
        })
      }

      ite.next((err, val) => {
        if (err) return cb(err)
        if (!val) return cb(null, null)

        const contentState = drive._contentStates.get(val.trie)
        if (contentState) return process.nextTick(oncontent, val.path, val.trie, contentState)
        return drive._getContent(val.trie, (err, contentState) => {
          if (err) return cb(err)
          return oncontent(val.path, val.trie, contentState)
        })
      })

      function oncontent (path, trie, contentState) {
        return cb(null, {
          path,
          // TODO: this means the feed property should not be hidden
          metadata: trie._trie.feed,
          content: contentState.feed
        })
      }
    }
  })
}

function createStatStream (drive, db, path, opts) {
  const ite = statIterator(drive, db, path, opts)
  return toStream(ite)
}

function createMountStream (drive, db, opts) {
  const ite = mountIterator(drive, db, opts)
  return toStream(ite)
}

function prefix (key) {
  if (key.startsWith('/')) return key
  return '/' + key
}

module.exports = {
  statIterator,
  createStatStream,
  mountIterator,
  createMountStream
}
