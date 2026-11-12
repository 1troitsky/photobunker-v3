import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, unlink, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildManifest, canonicalJson, manifestDigest, verifyManifest,
  validateAssetPath, assertManifestOutsideRoot } from './integrity.mjs'

const BUILD = Object.freeze({
  releaseId:'pb3-v0007', releaseSequence:7,
  buildTime:'2026-11-12T09:00:00.000Z',
  minimumClientVersion:'1.2.0', featureFlags:{zeta:false, alpha:true},
  requireServiceWorker:true,
})
async function fixture(fn) {
  const base=await mkdtemp(join(tmpdir(),'pb3-release-integrity-'))
  const root=join(base,'dist')
  await mkdir(join(root,'assets'),{recursive:true})
  const sources={
    'index.html':'<!doctype html><script src="assets/app.js"></script>',
    'assets/app.js':'console.log("sample")',
    'assets/app.css':'html{background:#111}',
    'assets/mod.wasm':'wasm-placeholder',
    'assets/image.svg':'<svg/>',
    'sw.js':'self.addEventListener("install",()=>{})',
    'workbox-1234.js':'/* workbox worker dependency */',
  }
  try {
    for (const [name,data] of Object.entries(sources))
      await writeFile(join(root,name),data)
    return await fn({base,root,sources})
  } finally { await rm(base,{force:true,recursive:true}) }
}
function expectCode(promise,code) {
  return assert.rejects(promise, e => e?.code === code)
}
function json(manifest) { return canonicalJson(manifest) }
function create(root, options={}) { return buildManifest({root,...BUILD,...options}) }
function check(root, manifest, extra={}) {
  return verifyManifest({root,manifestText:json(manifest),...extra})
}

test('identical builds yield byte-for-byte canonical manifests and digest',()=>fixture(async ({root})=>{
  const a=await create(root)
  const b=await create(root)
  assert.equal(json(a),json(b))
  assert.equal(manifestDigest(a),manifestDigest(b))
  assert.equal(a.manifest_version,1)
  assert.equal(a.release_id,BUILD.releaseId)
  assert.equal(a.release_sequence,7)
  assert.equal(a.build_time,BUILD.buildTime)
  assert.equal(a.minimum_client_version,'1.2.0')
  assert.deepEqual(a.feature_flags,{zeta:false,alpha:true})
  assert.equal(a.service_worker,'sw.js')
  assert.deepEqual(a.assets.map(x=>x.path), [...a.assets.map(x=>x.path)].sort())
  assert.deepEqual(new Set(a.assets.map(x=>x.type)),
    new Set(['js','css','html','wasm','service-worker','asset']))
  const result=await check(root,a)
  assert.deepEqual([result.integrity,result.authenticity,result.signed],[true,'not-checked',false])
  assert.equal(result.file_count,7)
}))

test('one-byte edit changes SHA and is rejected by old manifest',()=>fixture(async ({root})=>{
  const old=await create(root)
  await writeFile(join(root,'assets/app.js'),'console.log("samplf")')
  await expectCode(check(root,old),'ASSET_MISMATCH')
  const newer=await create(root)
  assert.notEqual(manifestDigest(newer),manifestDigest(old))
}))

for (const file of ['index.html','assets/app.js','assets/app.css','sw.js','assets/mod.wasm','assets/image.svg']) {
  test(`tampered ${file} rejected`,()=>fixture(async ({root})=>{
    const manifest=await create(root)
    await writeFile(join(root,file),'tampered')
    await expectCode(check(root,manifest),'ASSET_MISMATCH')
  }))
}

test('missing file, unlisted file, missing SW and swapped source fail closed',()=>fixture(async ({root})=>{
  const manifest=await create(root)
  await unlink(join(root,'sw.js'))
  await expectCode(check(root,manifest),'MISSING_SW')
  await writeFile(join(root,'sw.js'),'self.addEventListener("install",()=>{})')
  await unlink(join(root,'assets/app.js'))
  await expectCode(check(root,manifest),'FILE_SET_MISMATCH')
  await writeFile(join(root,'assets/app.js'),'console.log("sample")')
  await writeFile(join(root,'assets/unlisted.js'),'sneaky')
  await expectCode(check(root,manifest),'FILE_SET_MISMATCH')
}))

test('manifest has no self-contained authenticity; independently anchored digest detects edited manifest',()=>fixture(async ({root})=>{
  const manifest=await create(root)
  const original=manifestDigest(manifest)
  const modified=structuredClone(manifest)
  modified.release_id='attacker-adjusted'
  await expectCode(check(root,modified,{expectedDigest:original}),'MANIFEST_DIGEST')
  // Without external trusted digest, the altered metadata cannot be authenticated.
  const untrusted=await check(root,modified)
  assert.equal(untrusted.authenticity,'not-checked')
  assert.equal(untrusted.signed,false)
}))

test('trusted minimum release sequence blocks rollback, including different release id',()=>fixture(async ({root})=>{
  const manifest=await create(root)
  await expectCode(check(root,manifest,{minimumSequence:8}),'ROLLBACK')
  assert.equal((await check(root,manifest,{minimumSequence:7})).integrity,true)
  await expectCode(check(root,manifest,{expectedReleaseId:'wrong-id'}),'RELEASE_MISMATCH')
  await expectCode(check(root,manifest,{expectedDigest:'0'.repeat(64)}),'MANIFEST_DIGEST')
}))

test('noncanonical, unknown fields, duplicate, unsorted and malformed paths fail',()=>fixture(async ({root})=>{
  const manifest=await create(root)
  await expectCode(verifyManifest({root,manifestText:JSON.stringify(manifest)}),'NONCANONICAL')
  await expectCode(verifyManifest({root,manifestText:json({...manifest, secret:'unexpected'})}),'SCHEMA')
  await expectCode(verifyManifest({root,manifestText:json({...manifest,manifest_version:2})}),'MANIFEST_VERSION')
  await expectCode(verifyManifest({root,manifestText:json({...manifest,
    assets:[manifest.assets[0],manifest.assets[0],...manifest.assets.slice(1)]})}),'SCHEMA')
  await expectCode(verifyManifest({root,manifestText:json({...manifest,
    assets: [...manifest.assets].reverse()})}),'SCHEMA')
  await expectCode(verifyManifest({root,manifestText:json({...manifest,
    assets: [{...manifest.assets[0],path:'../outside.js'},...manifest.assets.slice(1)]})}),'UNSAFE_PATH')
  await expectCode(verifyManifest({root,manifestText:json({...manifest,
    service_worker:'../../evil.js'})}),'UNSAFE_PATH')
  await expectCode(verifyManifest({root,manifestText:'{not json'}),'SCHEMA')
}))

for(const malformed of [
  '', '/absolute', '../escape', './dot', 'a/../b', 'a/./b', 'a//b', 'a/',
  'a\\b', 'a?b', 'a#fragment', 'a%2F..%2Fsecret', 'C:/windows',
  'a\0b', 'a\nb',
]) {
  test(`forbid unsafe POSIX asset path ${JSON.stringify(malformed)}`,()=>{
    assert.throws(()=>validateAssetPath(malformed),e=>e.code==='UNSAFE_PATH')
  })
}

test('reject symlinks for both files and directory traversal',()=>fixture(async({base,root})=>{
  const outside=join(base,'outside.js')
  await writeFile(outside,'console.log("outside")')
  await symlink(outside,join(root,'assets','external.js'))
  await expectCode(create(root),'UNSAFE_FILE')
  await unlink(join(root,'assets','external.js'))
  await mkdir(join(base,'linked'))
  await symlink(join(base,'linked'),join(root,'linked-dir'))
  await expectCode(create(root),'UNSAFE_FILE')
  await unlink(join(root,'linked-dir'))
  await symlink(root,join(base,'symlink-root'))
  await expectCode(create(join(base,'symlink-root')),'UNSAFE_ROOT')
}))

test('reject hard-linked assets and unsupported worker ambiguity',()=>fixture(async({base,root})=>{
  const { link }=await import('node:fs/promises')
  await link(join(root,'index.html'),join(root,'index-copy.html'))
  await expectCode(create(root),'UNSAFE_FILE')
  await unlink(join(root,'index-copy.html'))
  await writeFile(join(root,'service-worker.js'),'worker 2')
  await expectCode(create(root),'AMBIGUOUS_SW')
  const manifest=await create(root,{serviceWorker:'sw.js'})
  assert.equal(manifest.assets.find(x=>x.path==='sw.js').type,'service-worker')
  assert.equal(manifest.assets.find(x=>x.path==='service-worker.js').type,'js')
}))

test('nonstandard explicit SW, missing SW and missing required SW reject',()=>fixture(async({root})=>{
  await rename(join(root,'sw.js'),join(root,'my-custom-worker.js'))
  await expectCode(create(root),'MISSING_SW')
  const custom=await create(root,{serviceWorker:'my-custom-worker.js'})
  assert.equal(custom.service_worker,'my-custom-worker.js')
  assert.equal((await check(root,custom)).integrity,true)
  await expectCode(create(root,{serviceWorker:'does-not-exist.js'}),'MISSING_SW')
  await expectCode(create(root,{serviceWorker:'assets/app.css'}),'INVALID_SW')
}))

test('reject invalid release fields, flags and output path inside inventory',()=>fixture(async({root})=>{
  await expectCode(create(root,{releaseId:'../wrong'}),'INVALID_RELEASE')
  await expectCode(create(root,{releaseSequence:0}),'INVALID_RELEASE')
  await expectCode(create(root,{releaseSequence:2**54}),'INVALID_RELEASE')
  await expectCode(create(root,{buildTime:'now'}),'INVALID_RELEASE')
  await expectCode(create(root,{minimumClientVersion:'latest'}),'INVALID_RELEASE')
  await expectCode(create(root,{featureFlags:{secret:'token'}}),'INVALID_RELEASE')
  assert.throws(()=>assertManifestOutsideRoot(root,join(root,'release.json')),e=>e.code==='UNSAFE_OUTPUT')
}))

test('real CLI build/verify returns unsigned result and nonzero for tampering/rollback',()=>fixture(async({base,root})=>{
  const cli=resolve(import.meta.dirname,'cli.mjs')
  const output=join(base,'release.json')
  const buildArgs=['build','--root',root,'--out',output,
    '--release-id','pb3-v0007','--release-sequence','7',
    '--build-time','2026-11-12T09:00:00.000Z','--min-client-version','1.2.0','--require-sw']
  const exec=(args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'})
  const first=exec(buildArgs)
  assert.equal(first.status,0,first.stderr)
  assert.equal(JSON.parse(first.stdout).status,'UNSIGNED_CANDIDATE')
  const snapshot=await readFile(output,'utf8')
  const second=exec(buildArgs)
  assert.equal(second.status,0,second.stderr)
  assert.equal(await readFile(output,'utf8'),snapshot)
  const digest=JSON.parse(first.stdout).manifest_sha256
  const verifyArgs=['verify','--root',root,'--manifest',output,'--expected-sha256',digest,
    '--minimum-sequence','7','--require-sw']
  const verified=exec(verifyArgs)
  assert.equal(verified.status,0,verified.stderr)
  assert.equal(JSON.parse(verified.stdout).status,'INTEGRITY_OK_UNSIGNED')
  const rolledBack=exec([...verifyArgs,'--minimum-sequence','8'])
  assert.equal(rolledBack.status,1) // duplicate flag rejected fail-closed
  assert.match(rolledBack.stderr,/USAGE/)
  const mismatch=exec(['verify','--root',root,'--manifest',output,'--expected-sha256',digest,'--minimum-sequence','8','--require-sw'])
  assert.equal(mismatch.status,1)
  assert.match(mismatch.stderr,/ROLLBACK/)
  await writeFile(join(root,'sw.js'),'tampered')
  const failure=exec(verifyArgs)
  assert.equal(failure.status,1)
  assert.match(failure.stderr,/ASSET_MISMATCH/)
}))
