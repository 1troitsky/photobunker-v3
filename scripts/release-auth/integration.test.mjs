import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildManifest, canonicalJson, verifyManifest } from '../release-integrity/integrity.mjs'
import { verifyRelease } from './verify.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const canonicalBytes = value => Buffer.from(canonicalJson(value), 'utf8')

test('real #196 manifest -> detached #230 Ed25519 -> all asset bytes; tamper and rollback fail closed', async t => {
  // Keys and assets are ephemeral test fixtures; never a production signer or trust root.
  const root = await mkdtemp(join(tmpdir(), 'pb3-release-347-'))
  t.after(async () => { await rm(root, {recursive:true, force:true}) })
  await Promise.all([
    writeFile(join(root,'index.html'), '<!doctype html><script src="app.js"></script>'),
    writeFile(join(root,'app.js'), 'console.log("v17")'),
    writeFile(join(root,'styles.css'), 'body{color:black}'),
    writeFile(join(root,'sw.js'), 'self.addEventListener("install",()=>{})'),
  ])
  const manifest = await buildManifest({
    root, releaseId:'pb3-347-v17', releaseSequence:17,
    buildTime:'2026-11-14T00:00:00.000Z',
    minimumClientVersion:'1.0.0', featureFlags:{}, requireServiceWorker:true,
  })
  assert.equal(manifest.service_worker,'sw.js')
  assert.equal(manifest.assets.length,4)
  const manifestBytes = canonicalBytes(manifest)
  const {publicKey, privateKey} = generateKeyPairSync('ed25519')
  const trustedPublicKeyPem = publicKey.export({type:'spki',format:'pem'})
  const trustedKeySha256 = digest(publicKey.export({type:'spki',format:'der'}))
  const signManifest = bytes => canonicalBytes({
    key_id:trustedKeySha256, manifest_sha256:digest(bytes),
    signature:sign(null,bytes,privateKey).toString('base64url'), signature_version:1,
  })
  const envelopeBytes = signManifest(manifestBytes)
  const trustedPolicy = {trustedPublicKeyPem, trustedKeySha256, minimumSequence:17}
  const signed = verifyRelease({manifestBytes,envelopeBytes,...trustedPolicy})
  assert.equal(signed.status,'VERIFIED_WITH_PROVIDED_ANCHOR')
  assert.equal(signed.manifestSha256,digest(manifestBytes))
  const checked = await verifyManifest({root,manifestText:manifestBytes.toString('utf8'),
    expectedDigest:signed.manifestSha256,minimumSequence:17,requireServiceWorker:true})
  assert.equal(checked.integrity,true)
  assert.equal(checked.authenticity,'not-checked') // asset verifier alone never claims signed authenticity

  assert.throws(()=>verifyRelease({manifestBytes,envelopeBytes,...trustedPolicy,minimumSequence:18}),
    error => error.code === 'ROLLBACK')
  assert.throws(()=>verifyRelease({manifestBytes,envelopeBytes,...trustedPolicy,
    trustedCheckpoint:{releaseSequence:17,manifestSha256:'0'.repeat(64)}}),
    error => error.code === 'RELEASE_EQUIVOCATION')
  assert.throws(()=>verifyRelease({manifestBytes,envelopeBytes,...trustedPolicy,
    trustedKeySha256:'0'.repeat(64)}),
    error => error.code === 'TRUST_ANCHOR_MISMATCH')
  // A valid detached signature says nothing about files delivered separately by a hostile origin.
  await writeFile(join(root,'styles.css'),'body{color:red}')
  assert.equal(verifyRelease({manifestBytes,envelopeBytes,...trustedPolicy}).releaseSequence,17)
  await assert.rejects(
    verifyManifest({root,manifestText:manifestBytes.toString('utf8'),
      expectedDigest:signed.manifestSha256,minimumSequence:17,requireServiceWorker:true}),
    error => error.code === 'ASSET_MISMATCH'
  )
})
