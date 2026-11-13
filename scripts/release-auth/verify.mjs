/** Build-side Ed25519 release verification; never activates Service Workers. */
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const HEX = /^[a-f0-9]{64}$/
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype
export class ReleaseAuthError extends Error {
  constructor(code) { super(code); this.name = 'ReleaseAuthError'; this.code = code }
}
const fail = code => { throw new ReleaseAuthError(code) }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0
function canonical(x) {
  if (x === null || typeof x === 'boolean' || typeof x === 'string') return JSON.stringify(x)
  if (typeof x === 'number' && Number.isFinite(x)) return JSON.stringify(x)
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`
  if (!plain(x)) fail('MALFORMED_JSON')
  return `{${Object.keys(x).sort(cmp).map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`
}
function parseCanonical(bytes, code) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 10_000_000) fail(code)
  const s = bytes.toString('utf8')
  if (!Buffer.from(s,'utf8').equals(bytes)) fail(code)
  let obj
  try { obj=JSON.parse(s) } catch { fail(code) }
  if (`${canonical(obj)}\n` !== s) fail(code)
  return obj
}

/** Strict schema mirror of #196 manifest_version=1. Signatures do not replace asset-byte checks. */
function validateManifestShape(m) {
  const exact = (obj, keys) => plain(obj) &&
    Object.keys(obj).length === keys.length && keys.every(key => Object.hasOwn(obj,key))
  if (!exact(m,['manifest_version','release_id','release_sequence','build_time',
    'minimum_client_version','feature_flags','service_worker','assets'])) fail('INVALID_MANIFEST')
  if (typeof m.build_time !== 'string' || Number.isNaN(Date.parse(m.build_time)) ||
      new Date(m.build_time).toISOString() !== m.build_time) fail('INVALID_MANIFEST')
  if (typeof m.minimum_client_version !== 'string' ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(m.minimum_client_version)) fail('INVALID_MANIFEST')
  if (!plain(m.feature_flags) || Object.entries(m.feature_flags).some(([name,value]) =>
      !/^[a-z][a-z0-9_.-]{0,63}$/.test(name) || typeof value !== 'boolean')) fail('INVALID_MANIFEST')
  const pathOk = path => typeof path === 'string' && path.length > 0 && path.length <= 1024 &&
    !path.startsWith('/') && !path.includes('\\') && !/[\u0000-\u001f\u007f%?#:]/.test(path) &&
    path.split('/').every(s => s !== '' && s !== '.' && s !== '..' &&
      s.length <= 255 && s === s.normalize('NFC'))
  if (m.service_worker !== null && (!pathOk(m.service_worker) || !m.service_worker.endsWith('.js'))) fail('INVALID_MANIFEST')
  if (!Array.isArray(m.assets) || m.assets.length === 0 || m.assets.length > 50000) fail('INVALID_MANIFEST')
  let last = '', workerCount=0
  // #196 auto-detects conventional worker filenames even if the manifest omits its reference.
  // A signed candidate must not silently relabel an auto-detected worker as ordinary JS.
  const conventionalWorker = /^(?:sw|service-worker)(?:\.[a-z0-9_-]+)?\.js$/i
  for (const asset of m.assets) {
    if (!exact(asset,['path','sha256','size','type']) || !pathOk(asset.path) ||
        (last && cmp(last,asset.path) >= 0) ||
        typeof asset.sha256 !== 'string' || !HEX.test(asset.sha256) ||
        !Number.isSafeInteger(asset.size) || asset.size < 0) fail('INVALID_MANIFEST')
    last=asset.path
    if (m.service_worker === null &&
        conventionalWorker.test(asset.path.split('/').at(-1))) fail('INVALID_MANIFEST')
    const ext=asset.path.slice(asset.path.lastIndexOf('.')+1).toLowerCase()
    const expected=asset.path === m.service_worker ? 'service-worker' :
      ['js','mjs','cjs'].includes(ext) ? 'js' : ext === 'css' ? 'css' :
      ['html','htm'].includes(ext) ? 'html' : ext === 'wasm' ? 'wasm' : 'asset'
    if (asset.type !== expected) fail('INVALID_MANIFEST')
    if (expected === 'service-worker') workerCount++
  }
  if (workerCount !== (m.service_worker === null ? 0 : 1)) fail('INVALID_MANIFEST')
}

export function verifyRelease({manifestBytes,envelopeBytes,trustedPublicKeyPem,trustedKeySha256,minimumSequence,trustedCheckpoint}) {
  if (typeof trustedKeySha256 !== 'string' || !HEX.test(trustedKeySha256) ||
      !Number.isSafeInteger(minimumSequence) || minimumSequence < 1) fail('UNTRUSTED_POLICY')
  // Optional out-of-origin trusted release checkpoint: prevent equivocation at the same sequence.
  // This value MUST NOT be derived from the candidate origin or unprotected local browser state.
  if (trustedCheckpoint !== undefined &&
      (!plain(trustedCheckpoint) || Object.keys(trustedCheckpoint).length !== 2 ||
       !Object.hasOwn(trustedCheckpoint,'releaseSequence') ||
       !Object.hasOwn(trustedCheckpoint,'manifestSha256') ||
       !Number.isSafeInteger(trustedCheckpoint.releaseSequence) ||
       trustedCheckpoint.releaseSequence < 1 ||
       typeof trustedCheckpoint.manifestSha256 !== 'string' ||
       !HEX.test(trustedCheckpoint.manifestSha256))) fail('UNTRUSTED_CHECKPOINT')
  let key
  try { key=createPublicKey(trustedPublicKeyPem) } catch { fail('INVALID_TRUSTED_KEY') }
  if (key.asymmetricKeyType !== 'ed25519') fail('INVALID_TRUSTED_KEY')
  const fingerprint=sha(key.export({type:'spki',format:'der'}))
  if (fingerprint !== trustedKeySha256) fail('TRUST_ANCHOR_MISMATCH')
  const manifest=parseCanonical(manifestBytes,'MALFORMED_MANIFEST')
  if (!plain(manifest) || manifest.manifest_version !== 1 ||
      typeof manifest.release_id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(manifest.release_id) ||
      !Number.isSafeInteger(manifest.release_sequence) || manifest.release_sequence < 1) fail('INVALID_RELEASE')
  validateManifestShape(manifest)
  if (manifest.release_sequence < minimumSequence) fail('ROLLBACK')
  const envelope=parseCanonical(envelopeBytes,'MALFORMED_SIGNATURE')
  if (!plain(envelope) || Object.keys(envelope).length !== 4 ||
      !['key_id','manifest_sha256','signature','signature_version'].every(k=>Object.hasOwn(envelope,k)) ||
      envelope.signature_version !== 1 || envelope.key_id !== fingerprint ||
      typeof envelope.manifest_sha256 !== 'string' || !HEX.test(envelope.manifest_sha256)) fail('MALFORMED_SIGNATURE')
  if (sha(manifestBytes) !== envelope.manifest_sha256) fail('MANIFEST_DIGEST_MISMATCH')
  if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) fail('MALFORMED_SIGNATURE')
  const sig=Buffer.from(envelope.signature,'base64url')
  if (sig.length !== 64 || sig.toString('base64url') !== envelope.signature) fail('MALFORMED_SIGNATURE')
  if (!edVerify(null,manifestBytes,key,sig)) fail('BAD_SIGNATURE')
  if (trustedCheckpoint !== undefined) {
    if (manifest.release_sequence < trustedCheckpoint.releaseSequence) fail('ROLLBACK')
    if (manifest.release_sequence === trustedCheckpoint.releaseSequence &&
        envelope.manifest_sha256 !== trustedCheckpoint.manifestSha256)
      fail('RELEASE_EQUIVOCATION')
  }
  return Object.freeze({status:'VERIFIED_WITH_PROVIDED_ANCHOR',releaseId:manifest.release_id,
    releaseSequence:manifest.release_sequence,manifestSha256:envelope.manifest_sha256,trustedKeySha256:fingerprint})
}
async function cli() {
  const args=process.argv.slice(2)
  if (args[0] !== 'verify' || (args.length !== 11 && args.length !== 15)) fail('USAGE')
  const fields=new Map()
  for(let i=1;i<args.length;i+=2) {
    if(!['--manifest','--signature','--trusted-key','--trusted-key-sha256','--minimum-sequence','--trusted-checkpoint-sequence','--trusted-checkpoint-sha256'].includes(args[i]) || fields.has(args[i])) fail('USAGE')
    fields.set(args[i],args[i+1])
  }
  const hasCheckpointSeq=fields.has('--trusted-checkpoint-sequence')
  const hasCheckpointHash=fields.has('--trusted-checkpoint-sha256')
  if (fields.size !== (hasCheckpointSeq ? 7 : 5) || hasCheckpointSeq !== hasCheckpointHash ||
      !/^[1-9][0-9]*$/.test(fields.get('--minimum-sequence')??'') ||
      (hasCheckpointSeq && !/^[1-9][0-9]*$/.test(fields.get('--trusted-checkpoint-sequence')??'')))
    fail('USAGE')
  const result=verifyRelease({
    manifestBytes:await readFile(fields.get('--manifest')),
    envelopeBytes:await readFile(fields.get('--signature')),
    trustedPublicKeyPem:await readFile(fields.get('--trusted-key'),'utf8'),
    trustedKeySha256:fields.get('--trusted-key-sha256'),
    minimumSequence:Number(fields.get('--minimum-sequence')),
    trustedCheckpoint:hasCheckpointSeq ? {
      releaseSequence:Number(fields.get('--trusted-checkpoint-sequence')),
      manifestSha256:fields.get('--trusted-checkpoint-sha256'),
    } : undefined})
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  cli().catch(e=>{process.stderr.write(`RELEASE_AUTH_REJECTED: ${e.code??'IO_ERROR'}\n`);process.exitCode=1})
