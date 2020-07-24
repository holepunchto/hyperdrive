const pathRoot = require('path')
const p = pathRoot.posix || pathRoot
const nanoiterator = require('nanoiterator')
const toStream = require('nanoiterator/to-stream')

const MountableHypertrie = require('mountable-hypertrie')
const { Stat } = require('hyperdrive-schemas')

function statIterator (drive, path, opts) {
  const stack = []

  return nanoiterator({ open, next })

  function open (cb) {
    drive.ready(err => {
      if (err) return cb(err)
      stack.unshift({ path: '/', target: null, iterator: drive.db.iterator(path, opts) })
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

      const trie = node[MountableHypertrie.Symbols.TRIE]
      const mount = node[MountableHypertrie.Symbols.MOUNT]
      const innerPath = node[MountableHypertrie.Symbols.INNER_PATH]

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
          if (linkStat) return cb(null, { stat: st, path: prefix(node.key), trie, mount, innerPath })
          return next(cb)
        })
      }
      linkPath = stack[0].path
      const resolved = (linkPath === '/') ? node.key : p.join(linkPath, node.key.slice(stack[0].target.length))
      return cb(null, { stat: st, path: prefix(resolved), trie, mount, innerPath })
    })
  }

  function pushLink (nodePath, linkPath, stat, cb) {
    if (opts && opts.recursive || (nodePath === path)) {
      return drive.stat(linkPath, (err, targetStat, _, resolvedLink) => {
        if (err && err.errno !== 2) return cb(err)
        if (!targetStat) return cb(null)
        if (targetStat.isDirectory()) {
          stack.unshift({ path: nodePath, target: resolvedLink, iterator: drive.db.iterator(resolvedLink, { gt: true, ...opts }) })
        }
        return cb(null, stat)
      })
    }
    return process.nextTick(cb, null, stat)
  }
}

function mountIterator (drive, opts) {
  const loadContent = !!(opts && opts.content)

  var ite = null
  var first = drive

  return nanoiterator({
    open (cb) {
      drive.ready(function (err) {
        if (err) return cb(err)
        ite = drive.db.mountIterator(opts)
        return cb(null)
      })
    },
    next (cb) {
      if (first) return onfirst()
      ite.next((err, val) => {
        if (err) return cb(err)
        if (!val) return cb(null, null)
        const contentState = drive._contentStates.cache.get(val.trie.feed)
        let mountMetadataFeed = val.trie.feed
        if (contentState) return process.nextTick(oncontent, val.path, mountMetadataFeed, contentState)
        mountMetadataFeed.has(0, (err, hasMetadataBlock) => {
          if (err) return cb(err)
          if (!(loadContent || hasMetadataBlock)) return oncontent(val.path, mountMetadataFeed, null)
          return drive._getContent(val.trie.feed, (err, contentState) => {
            if (err) return cb(err)
            return oncontent(val.path, mountMetadataFeed, contentState)
          })
        })
      })

      function onfirst () {
        first = null
        drive.metadata.has(0, (err, hasMetadataBlock) => {
          if (err) return cb(err)
          if (loadContent || hasMetadataBlock) {
            return drive._getContent(drive.db.feed, err => {
              if (err) return cb(err)
              return cb(null, {
                path: '/',
                metadata: drive.metadata,
                content: drive._contentStates.cache.get(drive.db.feed).feed
              })
            })
          } else {
            return cb(null, {
              path: '/',
              metadata: drive.metadata,
              content: null
            })
          }
        })
      }

      function oncontent (path, metadata, contentState) {
        return cb(null, {
          path,
          metadata,
          content: contentState ? contentState.feed : null
        })
      }
    }
  })
}

function readdirIterator (drive, name, opts) {
  const recursive = !!(opts && opts.recursive)
  const noMounts = !!(opts && opts.noMounts)
  const includeStats = !!(opts && opts.includeStats)

  const ite = statIterator(drive, name, { ...opts, recursive, noMounts, gt: false })

  return nanoiterator({ next })

  function next (cb) {
    ite.next((err, value) => {
      if (err) return cb(err)
      if (!value) return cb(null, null)
      const { path, stat, mount, innerPath } = value
      const relativePath = (name === path) ? path : p.relative(name, path)
      if (relativePath === name) return next(cb)
      if (recursive) {
        if (includeStats) return cb(null, { name: relativePath, path, stat, mount, innerPath })
        return cb(null, relativePath)
      }
      const split = relativePath.split('/')
      // Note: When doing a non-recursive readdir, we need to create a fake directory Stat (since the returned Stat might be a child file here)
      // If this is a problem, one should follow the readdir with the appropriate stat() calls.
      if (includeStats) return cb(null, { name: split[0], path, stat: split.length > 1 ? Stat.directory() : stat, mount, innerPath })
      return cb(null, split[0])
    })
  }
}

function createReaddirStream (drive, path, opts) {
  return toStream(readdirIterator(drive, path, opts))
}

function createStatStream (drive, path, opts) {
  return toStream(statIterator(drive, path, opts))
}

function createMountStream (drive, opts) {
  return toStream(mountIterator(drive, opts))
}

function prefix (key) {
  if (key.startsWith('/')) return key
  return '/' + key
}

module.exports = {
  statIterator,
  createStatStream,
  mountIterator,
  createMountStream,
  readdirIterator,
  createReaddirStream
}
