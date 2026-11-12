#!/usr/bin/env node
/** Isolated CLI; neither CI nor runtime automatically invokes this tool. */
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { IntegrityError, assertManifestOutsideRoot, buildManifest, canonicalJson,
  manifestDigest, verifyManifest } from './integrity.mjs'

const USAGE = `Unsigned release manifest (not a security signature):
  node cli.mjs build --root DIR --out FILE --release-id ID --release-sequence N --build-time 2026-11-12T00:00:00.000Z --min-client-version X.Y.Z [--feature-flags FILE] [--service-worker PATH] [--require-sw]
  node cli.mjs verify --root DIR --manifest FILE [--expected-sha256 DIGEST] [--minimum-sequence N] [--expected-release-id ID] [--require-sw]

--expected-sha256 and --minimum-sequence are security-relevant ONLY if supplied
by an independent trusted channel. This tool does not verify Ed25519 signatures.`

function usage(message) {
  throw new IntegrityError('USAGE', `${message}\n\n${USAGE}`)
}
function parseArguments(argv) {
  const [action, ...args] = argv
  if (!['build', 'verify'].includes(action)) usage('Expected build or verify command')
  const allowed = action === 'build'
    ? new Set(['root','out','release-id','release-sequence','build-time',
      'min-client-version','feature-flags','service-worker','require-sw'])
    : new Set(['root','manifest','expected-sha256','minimum-sequence',
      'expected-release-id','require-sw'])
  const result = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--') || !allowed.has(arg.slice(2)))
      usage(`Unknown argument: ${arg}`)
    const flag = arg.slice(2)
    if (Object.hasOwn(result, flag)) usage(`Duplicate argument: ${flag}`)
    if (flag === 'require-sw') result[flag] = true
    else {
      if (args[i+1] === undefined || args[i+1].startsWith('--'))
        usage(`Missing value for ${arg}`)
      result[flag] = args[++i]
    }
  }
  for (const required of action === 'build'
    ? ['root','out','release-id','release-sequence','build-time','min-client-version']
    : ['root','manifest']) {
    if (!Object.hasOwn(result, required)) usage(`Missing required --${required}`)
  }
  return {action, options:result}
}
function numeric(value, name) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value))
    usage(`${name} must be a nonnegative integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) usage(`${name} is too large`)
  return parsed
}
async function readJsonFlags(file) {
  if (!file) return {}
  let parsed
  try { parsed = JSON.parse(await readFile(file, 'utf8')) }
  catch { usage('Could not read --feature-flags as JSON object') }
  return parsed
}
async function writeAtomic(file, body) {
  const output = resolve(file)
  let existing
  try { existing = await lstat(output) } catch (e) { if (e.code !== 'ENOENT') throw e }
  if (existing && (!existing.isFile() || existing.isSymbolicLink()))
    throw new IntegrityError('UNSAFE_OUTPUT', 'Output target must be a regular file')
  const tmp = resolve(dirname(output), `.release-manifest-${randomBytes(12).toString('hex')}.tmp`)
  const handle = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  try {
    await handle.writeFile(body, 'utf8')
    await handle.sync()
  } finally { await handle.close() }
  try { await rename(tmp, output) }
  catch (e) { await unlink(tmp).catch(() => {}); throw e }
}

async function main() {
  const {action, options} = parseArguments(process.argv.slice(2))
  if (action === 'build') {
    assertManifestOutsideRoot(options.root, options.out)
    const manifest = await buildManifest({
      root:options.root,
      releaseId:options['release-id'],
      releaseSequence:numeric(options['release-sequence'], 'release-sequence'),
      buildTime:options['build-time'],
      minimumClientVersion:options['min-client-version'],
      featureFlags:await readJsonFlags(options['feature-flags']),
      serviceWorker:options['service-worker'],
      requireServiceWorker:options['require-sw'] === true,
    })
    await writeAtomic(options.out, canonicalJson(manifest))
    process.stdout.write(JSON.stringify({status:'UNSIGNED_CANDIDATE',
      release_id:manifest.release_id, release_sequence:manifest.release_sequence,
      manifest_sha256:manifestDigest(manifest), files:manifest.assets.length}) + '\n')
    return
  }
  assertManifestOutsideRoot(options.root, options.manifest)
  const manifestText = await readFile(options.manifest, 'utf8')
  if (Buffer.byteLength(manifestText) > 16 * 1024 * 1024)
    throw new IntegrityError('SCHEMA', 'Manifest too large')
  const result = await verifyManifest({
    root:options.root, manifestText,
    minimumSequence:options['minimum-sequence'] === undefined
      ? 0 : numeric(options['minimum-sequence'], 'minimum-sequence'),
    expectedDigest:options['expected-sha256'],
    expectedReleaseId:options['expected-release-id'],
    requireServiceWorker:options['require-sw'] === true,
  })
  process.stdout.write(JSON.stringify({status:'INTEGRITY_OK_UNSIGNED', ...result}) + '\n')
}

main().catch(error => {
  const code = error instanceof IntegrityError ? error.code : 'IO_ERROR'
  process.stderr.write(`${code}: ${error.message}\n`)
  process.exitCode = 1
})
