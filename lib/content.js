const sodium = require('sodium-universal')

function contentKeyPair (secretKey) {
  var seed = Buffer.allocUnsafe(sodium.crypto_sign_SEEDBYTES)
  var context = Buffer.from('hyperdri', 'utf8') // 8 byte context
  var keyPair = {
    publicKey: Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES),
    secretKey: Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
  }

  sodium.crypto_kdf_derive_from_key(seed, 1, context, secretKey)
  sodium.crypto_sign_seed_keypair(keyPair.publicKey, keyPair.secretKey, seed)
  if (seed.fill) seed.fill(0)

  return keyPair
}

function contentOptions (self, secretKey) {
  return {
    sparse: self.sparse || self.latest,
    maxRequests: self.maxRequests,
    secretKey: secretKey,
    storeSecretKey: false,
    indexing: self.metadataFeed.writable && self.indexing,
    storageCacheSize: self.contentStorageCacheSize
  }
}

module.exports = {
  contentKeyPair,
  contentOptions
}

