/**
 * Build-time content integrity, NOT a release signature or independent trust anchor.
 * This module does not run inside the PWA and does not activate updates.
 */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'

export const MANIFEST_VERSION = 1
const HASH_PATTERN = /^[a-f0-9]{64}$/
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/
const SW_PATTERN = /^(?:sw|service-worker)(?:\.[a-z0-9_-]+)?\.js$/i
const MAX_FILES = 50000
const ASSET_TYPES = new Set(['js', 'css', 'html', 'wasm', 'service-worker', 'asset'])

export class IntegrityError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'IntegrityError'
    this.code = code
  }
}
const fail = (code, message) => { throw new IntegrityError(code, message) }
const hasKeys = (obj, keys) => isPlain(obj) &&
  Object.keys(obj).length === keys.length && keys.every(key => Object.hasOwn(obj, key))
const isPlain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0

/** Deterministic UTF-8 JSON, key order by UTF-16 code unit, LF terminator. */
export function canonicalJson(value) {
  function encode(item) {
    if (item === null || typeof item === 'boolean' || typeof item === 'string')
      return JSON.stringify(item)
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('SCHEMA', 'Non-finite number')
      return JSON.stringify(item)
    }
    if (Array.isArray(item)) return `[${item.map(encode).join(',')}]`
    if (!isPlain(item)) fail('SCHEMA', 'Unexpected JSON value')
    return `{${Object.keys(item).sort(cmp).map(key =>
      `${JSON.stringify(key)}:${encode(item[key])}`).join(',')}}`
  }
  return `${encode(value)}\n`
}
export const manifestDigest = manifest => createHash('sha256')
  .update(canonicalJson(manifest), 'utf8').digest('hex')

/** Asset path is an URL-relative POSIX path. Never accept encoded or ambiguous names. */
export function validateAssetPath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024 ||
      isAbsolute(value) || value.startsWith('/') || value.includes('\\') ||
      /[\u0000-\u001f\u007f%?#:]/.test(value) ||
      value.split('/').some(segment => segment === '' || segment === '.' || segment === '..' ||
        segment.length > 255 || segment !== segment.normalize('NFC'))) {
    fail('UNSAFE_PATH', `Unsafe asset path: ${JSON.stringify(value)}`)
  }
  return value
}

function validReleaseFields({releaseId, releaseSequence, buildTime, minimumClientVersion, featureFlags}) {
  if (typeof releaseId !== 'string' || !RELEASE_ID_PATTERN.test(releaseId))
    fail('INVALID_RELEASE', 'release_id must be a compact non-path release identifier')
  if (!Number.isSafeInteger(releaseSequence) || releaseSequence < 1)
    fail('INVALID_RELEASE', 'release_sequence must be a positive safe integer')
  if (typeof buildTime !== 'string' || Number.isNaN(Date.parse(buildTime)) ||
      new Date(buildTime).toISOString() !== buildTime)
    fail('INVALID_RELEASE', 'build_time must be exact ISO-8601 UTC with milliseconds')
  if (typeof minimumClientVersion !== 'string' || !VERSION_PATTERN.test(minimumClientVersion))
    fail('INVALID_RELEASE', 'minimum_client_version must be a semantic version')
  if (!isPlain(featureFlags) || Object.entries(featureFlags).some(([key, value]) =>
    !/^[a-z][a-z0-9_.-]{0,63}$/.test(key) || typeof value !== 'boolean'))
    fail('INVALID_RELEASE', 'feature_flags must contain only named boolean flags')
}

function classify(path, worker) {
  if (path === worker) return 'service-worker'
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'js'
  if (ext === 'css') return 'css'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'wasm') return 'wasm'
  return 'asset'
}
async function assertRoot(root) {
  const full = resolve(root)
  let stat
  try { stat = await lstat(full) } catch { fail('MISSING_ROOT', 'Build directory not found') }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    fail('UNSAFE_ROOT', 'Build root must be a real directory, not a symlink')
  if ((await realpath(full)) !== full)
    fail('UNSAFE_ROOT', 'Build root has a symlinked ancestor')
  return full
}

async function hashFile(root, relative) {
  validateAssetPath(relative)
  const components = relative.split('/')
  let current = root
  for (let i = 0; i < components.length - 1; i++) {
    current = join(current, components[i])
    const stat = await lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      fail('UNSAFE_PATH', `Non-directory or symlink in asset parent: ${relative}`)
  }
  const full = join(root, ...components)
  const pre = await lstat(full)
  if (!pre.isFile() || pre.isSymbolicLink() || pre.nlink !== 1)
    fail('UNSAFE_FILE', `Not a unique regular file: ${relative}`)
  const fd = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await fd.stat()
    if (!before.isFile() || before.nlink !== 1 || before.ino !== pre.ino)
      fail('UNSAFE_FILE', `Asset changed during open: ${relative}`)
    const hash = createHash('sha256')
    let count = 0
    for await (const bytes of fd.createReadStream({autoClose:false})) {
      hash.update(bytes)
      count += bytes.length
    }
    const after = await fd.stat()
    const post = await lstat(full)
    if (before.size !== count || after.size !== count || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || before.ino !== after.ino ||
        before.ino !== post.ino || post.nlink !== 1 || post.isSymbolicLink())
      fail('UNSTABLE_FILE', `Asset changed during hashing: ${relative}`)
    return {sha256: hash.digest('hex'), size: count}
  } finally { await fd.close() }
}

async function listFiles(root) {
  const paths = []
  const stack = ['']
  while (stack.length) {
    const directory = stack.pop()
    const entries = await readdir(directory ? join(root, directory) : root)
    for (const entry of entries.sort(cmp)) {
      const path = directory ? `${directory}/${entry}` : entry
      validateAssetPath(path)
      const stat = await lstat(join(root, ...path.split('/')))
      if (stat.isSymbolicLink()) fail('UNSAFE_FILE', `Symlinks forbidden: ${path}`)
      if (stat.isDirectory()) stack.push(path)
      else if (stat.isFile() && stat.nlink === 1) {
        paths.push(path)
        if (paths.length > MAX_FILES) fail('TOO_MANY_FILES', 'Build exceeds file count cap')
      } else fail('UNSAFE_FILE', `Unsupported or hard-linked asset: ${path}`)
    }
  }
  return paths.sort(cmp)
}

function identifyWorker(paths, explicitWorker, requireWorker) {
  if (explicitWorker !== null && explicitWorker !== undefined) {
    validateAssetPath(explicitWorker)
    if (!paths.includes(explicitWorker))
      fail('MISSING_SW', `Required Service Worker not found: ${explicitWorker}`)
    if (!explicitWorker.endsWith('.js'))
      fail('INVALID_SW', 'Service Worker must have .js extension')
    return explicitWorker
  }
  const recognized = paths.filter(file => SW_PATTERN.test(basename(file)))
  if (recognized.length > 1) fail('AMBIGUOUS_SW', 'Multiple Service Worker candidates; choose --service-worker')
  if (requireWorker && recognized.length === 0) fail('MISSING_SW', 'Required Service Worker absent')
  return recognized[0] ?? null
}

async function scan(root, {serviceWorker = undefined, requireServiceWorker = false} = {}) {
  const full = await assertRoot(root)
  const paths = await listFiles(full)
  if (!paths.length) fail('EMPTY_BUILD', 'Refusing to publish an empty build')
  const worker = identifyWorker(paths, serviceWorker, requireServiceWorker)
  const assets = []
  for (const path of paths) {
    const {sha256, size} = await hashFile(full, path)
    assets.push({path, sha256, size, type:classify(path, worker)})
  }
  return {assets, service_worker:worker}
}

export async function buildManifest({root, releaseId, releaseSequence,
  buildTime, minimumClientVersion, featureFlags = {}, serviceWorker, requireServiceWorker = false}) {
  validReleaseFields({releaseId, releaseSequence, buildTime, minimumClientVersion, featureFlags})
  const inventory = await scan(root, {serviceWorker, requireServiceWorker})
  return {
    manifest_version:MANIFEST_VERSION,
    release_id:releaseId,
    release_sequence:releaseSequence,
    build_time:buildTime,
    minimum_client_version:minimumClientVersion,
    feature_flags:featureFlags,
    service_worker:inventory.service_worker,
    assets:inventory.assets,
  }
}

function validateManifest(manifest) {
  if (!hasKeys(manifest, ['manifest_version', 'release_id', 'release_sequence',
    'build_time', 'minimum_client_version', 'feature_flags', 'service_worker', 'assets']))
    fail('SCHEMA', 'Unexpected manifest fields')
  if (manifest.manifest_version !== MANIFEST_VERSION)
    fail('MANIFEST_VERSION', `Unsupported manifest version ${manifest.manifest_version}`)
  validReleaseFields({releaseId:manifest.release_id, releaseSequence:manifest.release_sequence,
    buildTime:manifest.build_time, minimumClientVersion:manifest.minimum_client_version,
    featureFlags:manifest.feature_flags})
  if (!Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length > MAX_FILES)
    fail('SCHEMA', 'Missing or oversized asset list')
  if (manifest.service_worker !== null) validateAssetPath(manifest.service_worker)
  let previous = ''
  let workerCount = 0
  for (const asset of manifest.assets) {
    if (!hasKeys(asset, ['path', 'sha256', 'size', 'type']))
      fail('SCHEMA', 'Unexpected asset fields')
    validateAssetPath(asset.path)
    if (previous && cmp(previous, asset.path) >= 0)
      fail('SCHEMA', 'Asset paths must be sorted and unique')
    previous = asset.path
    if (typeof asset.sha256 !== 'string' || !HASH_PATTERN.test(asset.sha256) ||
        !Number.isSafeInteger(asset.size) || asset.size < 0 || !ASSET_TYPES.has(asset.type))
      fail('SCHEMA', `Invalid asset metadata: ${asset.path}`)
    if (asset.type !== classify(asset.path, manifest.service_worker))
      fail('SCHEMA', `Asset classification mismatch: ${asset.path}`)
    if (asset.type === 'service-worker') workerCount++
  }
  if ((manifest.service_worker === null && workerCount !== 0) ||
      (manifest.service_worker !== null && workerCount !== 1))
    fail('SCHEMA', 'Service Worker reference inconsistent with assets')
}

/**
 * Returns an integrity-only diagnostic. Never represents signed authenticity.
 * expectedDigest and minimumSequence MUST come from an independent trusted source
 * to be security-relevant. No caller is permitted to infer signature validation.
 */
export async function verifyManifest({root, manifestText, expectedDigest, minimumSequence = 0,
  expectedReleaseId, requireServiceWorker = false}) {
  if (typeof manifestText !== 'string') fail('SCHEMA', 'Manifest must be UTF-8 JSON text')
  let manifest
  try { manifest = JSON.parse(manifestText) }
  catch { fail('SCHEMA', 'Manifest is not valid JSON') }
  validateManifest(manifest)
  if (canonicalJson(manifest) !== manifestText)
    fail('NONCANONICAL', 'Manifest bytes are not canonical JSON')
  const digest = manifestDigest(manifest)
  if (expectedDigest !== undefined && (typeof expectedDigest !== 'string' ||
    !HASH_PATTERN.test(expectedDigest) || digest !== expectedDigest))
    fail('MANIFEST_DIGEST', 'Manifest digest differs from expected digest')
  if (!Number.isSafeInteger(minimumSequence) || minimumSequence < 0)
    fail('SCHEMA', 'Invalid trusted minimum release sequence')
  if (manifest.release_sequence < minimumSequence)
    fail('ROLLBACK', 'Release sequence below trusted minimum')
  if (expectedReleaseId !== undefined && manifest.release_id !== expectedReleaseId)
    fail('RELEASE_MISMATCH', 'Unexpected release ID')
  const inventory = await scan(root, {serviceWorker:manifest.service_worker,
    requireServiceWorker:requireServiceWorker || manifest.service_worker !== null})
  if (inventory.assets.length !== manifest.assets.length)
    fail('FILE_SET_MISMATCH', 'Build contains missing or unlisted files')
  for (let i = 0; i < manifest.assets.length; i++) {
    const expected = manifest.assets[i]
    const actual = inventory.assets[i]
    if (expected.path !== actual.path || expected.type !== actual.type)
      fail('FILE_SET_MISMATCH', `Build path/type mismatch near ${expected.path}`)
    if (expected.size !== actual.size || expected.sha256 !== actual.sha256)
      fail('ASSET_MISMATCH', `Asset content mismatch: ${expected.path}`)
  }
  return {integrity:true, authenticity:'not-checked', signed:false,
    manifest_sha256:digest, release_id:manifest.release_id,
    release_sequence:manifest.release_sequence, file_count:inventory.assets.length}
}

export function assertManifestOutsideRoot(root, outputPath) {
  const rootPath = resolve(root)
  const out = resolve(outputPath)
  if (out === rootPath || out.startsWith(`${rootPath}${sep}`))
    fail('UNSAFE_OUTPUT', 'Manifest output must be outside build root to avoid recursive inventory')
}
