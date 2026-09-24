// Type declarations for the holepunchto/hyperdrive public API.

/**
 * `options`
 */
export interface HyperdriveUpdateOptions {
  wait?: any
}

/**
 * `options`
 */
export interface HyperdriveGetOptions {
  /** Wait for block to be downloaded */
  wait?: any
  /** Wait at max some milliseconds (0 means no timeout) */
  timeout?: any
}

/**
 * `options`
 */
export interface HyperdriveClearOptions {
  /** Returned `cleared` bytes object is null unless you enable this */
  diff?: any
}

/**
 * `options`
 */
export interface HyperdriveClearAllOptions {
  /** Returned `cleared` bytes object is null unless you enable this */
  diff?: any
}

/**
 * `options`
 */
export interface HyperdriveEntryOptions {
  seq?: any
  key?: any
  value?: any
}

export interface HyperdriveDiffOptions {
  /** Entry in folder at drive.version for some path */
  left?: any
  /** Entry in folder at drive.checkout(version) for some path */
  right?: any
}

/**
 * `options`
 */
export interface HyperdriveListOptions {
  /** Whether to descend into all subfolders or not */
  recursive?: any
  /** Ignore files and folders by name */
  ignore?: any
  /** Wait for block to be downloaded. */
  wait?: any
}

/**
 * `options`
 */
export interface HyperdriveReaddirOptions {
  /** Wait for block to be downloaded */
  wait?: any
}

/**
 * `options`
 */
export interface HyperdriveCreateReadStreamOptions {
  /** `start` and `end` are inclusive */
  start?: any
  end?: any
  /** `length` overrides `end`, they're not meant to be used together */
  length?: any
  /** Wait for blocks to be downloaded */
  wait?: any
  /** Wait at max some milliseconds (0 means no timeout) */
  timeout?: any
}

/**
 * `options`
 */
export interface HyperdriveCreateWriteStreamOptions {
  executable?: any
  /** Extended file information i.e. arbitrary JSON value */
  metadata?: any
}

export class Hyperdrive {
  /**
   * Creates a new Hyperdrive instance. `store` must be an instance of `Corestore`.
   * @param corestore - `store` must be an instance of `Corestore`.
   */
  constructor(corestore: any, key?: any, opts?: any)

  static getDriveKey(corestore: any): Promise<any>

  static getContentKey(m: any, key: any): any

  static getContentManifest(m: any, key: any): any

  /**
   * String containing the id (z-base-32 of the public key) identifying this drive.
   */
  readonly id: any

  /**
   * The public key of the Hypercore backing the drive.
   */
  readonly key: any

  /**
   * The hash of the public key of the Hypercore backing the drive.
   */
  readonly discoveryKey: any

  /**
   * The public key of the [Hyperblobs](https://github.com/holepunchto/hyperblobs) instance holding blobs associated with entries in the drive.
   */
  readonly contentKey: any

  /**
   * Number that indicates how many modifications were made, useful as a version identifier.
   */
  readonly version: any

  /**
   * Boolean indicating if we can write or delete data in this drive.
   */
  readonly writable: any

  /**
   * Boolean indicating if we can read from this drive. After closing the drive this will be `false`.
   */
  readonly readable: any

  /**
   * Indicate to Hyperdrive that you're finding peers in the background, requests will be on hold until this is done.
   */
  findingPeers(): any

  /**
   * Truncates the Hyperdrive to a previous version (both the file-structure reference and the blobs).
   */
  truncate(version: any, options?: any): Promise<any>

  /**
   * @returns Returns the length of the Hyperblobs instance at the time of the specified Hyperdrive version (defaults to the current version).
   */
  getBlobsLength(checkout: any): Promise<any>

  /**
   * Usage example:
   */
  replicate(isInitiator: any, opts: any): any

  /**
   * Waits for initial proof of the new drive version until all `findingPeers` are done.
   * @param opts - `options`
   */
  update(opts?: HyperdriveUpdateOptions): any

  /**
   * Get a read-only snapshot of a previous version.
   */
  checkout(version: any): Hyperdrive

  /**
   * Useful for atomically mutate the drive, has the same interface as Hyperdrive.
   */
  batch(): Hyperdrive

  setActive(bool: any): any

  /**
   * Commit a batch of mutations to the underlying drive.
   */
  flush(): Promise<any>

  /**
   * @returns Returns the [Hyperblobs](https://github.com/holepunchto/hyperblobs) instance storing the blobs indexed by drive entries.
   */
  getBlobs(): Promise<any>

  monitor(name: any, opts?: any): any

  closeMonitors(): Promise<any>

  /**
   * It also returns `null` for symbolic links.
   * @param opts - `options`
   * @returns Returns the blob at `path` in the drive.
   */
  get(name: any, opts?: HyperdriveGetOptions): Promise<any>

  putEntry(name: any, options?: any): Promise<any>

  /**
   * Creates a file at `path` in the drive. `options` are the same as in `createWriteStream`.
   * @param options - `options` are the same as in `createWriteStream`.
   */
  put(name: any, buf: any, options?: any): Promise<any>

  /**
   * Deletes the file at `path` from the drive.
   */
  del(name: any): Promise<any>

  /**
   * @returns Returns `0` if entries are the same, `1` if `entryA` is older, and `-1` if `entryB` is older.
   */
  compare(a: any, b: any): any

  /**
   * Deletes the blob from storage to free up space, but the file structure reference is kept.
   * @param opts - `options`
   */
  clear(name: any, opts?: HyperdriveClearOptions): Promise<any>

  /**
   * Deletes all the blobs from storage to free up space, similar to how `drive.clear()` works.
   * @param opts - `options`
   */
  clearAll(opts?: HyperdriveClearAllOptions): Promise<any>

  /**
   * Purge both cores (db and blobs) from your storage, completely removing all the drive's data.
   */
  purge(): Promise<any>

  /**
   * Creates an entry in drive at `path` that points to the entry at `linkname`.
   */
  symlink(name: any, dst: any, options?: any): Promise<any>

  /**
   * `options` include:
   * @param opts - `options`
   * @returns Returns the entry at `path` in the drive.
   */
  entry(name: any, opts?: HyperdriveEntryOptions): Promise<any>

  /**
   * @returns Returns `true` if the entry at `path` does exists, otherwise `false`.
   */
  exists(name: any): Promise<any>

  /**
   * Usage example:
   * @returns Returns an iterator that listens on `folder` to yield changes, by default on `/`.
   */
  watch(folder?: any): any

  /**
   * Efficiently create a stream of the shallow changes to `folder` between `version` and `drive.version`.
   */
  diff(length: any, folder: any, opts?: HyperdriveDiffOptions): any

  /**
   * Downloads all the blobs in `folder` corresponding to entries in `drive.checkout(version)` that are not in `drive.version`. Returns a `Download` object that resolves once all data has been downloaded:
   */
  downloadDiff(length: any, folder: any, opts?: any): Promise<any>

  /**
   * Downloads the entries and blobs stored in the ranges `dbRanges` and `blobRanges`. Returns a `Download` object that resolves once all data has been downloaded:
   */
  downloadRange(dbRanges: any, blobRanges: any): Promise<any>

  /**
   * `options` are the same as `Hyperbee().createReadStream([range], [options])`.
   * @param opts - `options` are the same as `Hyperbee().createReadStream([range], [options])`.
   * @returns Returns a read stream of entries in the drive.
   */
  entries(range?: any, opts?: any): any

  /**
   * Downloads the blobs corresponding to all entries in the drive at paths prefixed with `folder`. Returns a `Download` object that resolves once all data has been downloaded:
   * @param opts - `options` are the same as those for `drive.list(folder, [options])`.
   */
  download(folder?: any, opts?: any): any

  /**
   * Checks if path is saved to local store already.
   */
  has(path: any): Promise<any>

  /**
   * `options` include:
   * @param opts - `options`
   * @returns Returns a stream of all entries in the drive at paths prefixed with `folder`.
   */
  list(folder: any, opts?: HyperdriveListOptions): any

  /**
   * `options` include:
   * @param opts - `options`
   * @returns Returns a stream of all subpaths of entries in drive stored at paths prefixed by `folder`.
   */
  readdir(folder: any, opts?: HyperdriveReaddirOptions): any

  /**
   * Efficiently mirror this drive into another. Returns a [`MirrorDrive`](https://github.com/holepunchto/mirror-drive#api) instance constructed with `options`.
   */
  mirror(out: any, opts?: any): any

  /**
   * `options` include:
   * @param opts - `options`
   * @returns Returns a stream to read out the blob stored in the drive at `path`.
   */
  createReadStream(name: any, opts?: HyperdriveCreateReadStreamOptions): any

  /**
   * Stream a blob into the drive at `path`.
   * @param options - `options`
   */
  createWriteStream(name: any, options?: HyperdriveCreateWriteStreamOptions): any

  static normalizePath(name: any): any

  /**
   * Waits until internal state is loaded.
   */
  ready(): Promise<any>

  /**
   * Fully close this drive, including its underlying Hypercore backed datastructures.
   */
  close(): Promise<any>

  readonly opened: any

  readonly closed: any

  emit(event: any, arg1?: any): any

  /**
   * The Corestore instance used as storage.
   */
  corestore: any

  /**
   * The underlying Hyperbee backing the drive file structure.
   */
  db: any

  /**
   * The Hypercore used for `drive.db`.
   */
  core: any

  blobs: any

  /**
   * Boolean indicating if the drive handles or not metadata. Always `true`.
   */
  supportsMetadata: any

  encryptionKey: any

  monitors: any

  on(event: 'blobs', listener: (blobs: any) => void): this
  on(event: 'content-key', listener: (key: any) => void): this
}

export default Hyperdrive
