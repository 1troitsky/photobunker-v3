import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { verifyRelease } from './verify.mjs'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const encode = object => Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(object).sort(([a],[b])=>a<b?-1:a>b?1:0)))+'\n')
function fixture(sequence=12) {
  // Fresh ephemeral test signing key; never a production secret.
  const {publicKey,privateKey}=generateKeyPairSync('ed25519')
  const trustedPublicKeyPem=publicKey.export({type:'spki',format:'pem'})
  const trustedKeySha256=sha(publicKey.export({type:'spki',format:'der'}))
  const manifestBytes=encode({assets:[{path:'index.html',sha256:'a'.repeat(64),size:12,type:'html'}],build_time:'2026-11-13T00:00:00.000Z',feature_flags:{},manifest_version:1,minimum_client_version:'1.0.0',release_id:'r12',release_sequence:sequence,service_worker:null})
  const envelopeBytes=encode({key_id:trustedKeySha256,manifest_sha256:sha(manifestBytes),
    signature:sign(null,manifestBytes,privateKey).toString('base64url'),signature_version:1})
  const candidate={manifestBytes,envelopeBytes,trustedPublicKeyPem,trustedKeySha256,minimumSequence:12}
  candidate.resign=()=>{
    candidate.envelopeBytes=encode({key_id:trustedKeySha256,manifest_sha256:sha(candidate.manifestBytes),
      signature:sign(null,candidate.manifestBytes,privateKey).toString('base64url'),signature_version:1})
  }
  return candidate
}
const rejects=(s,code)=>assert.throws(()=>verifyRelease(s),e=>e?.code===code)
test('valid Ed25519 signature under externally supplied policy',()=>{
  const r=verifyRelease(fixture());assert.equal(r.status,'VERIFIED_WITH_PROVIDED_ANCHOR');assert.equal(r.releaseSequence,12)
})
test('modified manifest rejected',()=>{
  const s=fixture();s.manifestBytes=Buffer.from(s.manifestBytes.toString().replace('r12','r13'));rejects(s,'MANIFEST_DIGEST_MISMATCH')
})
test('changed signature rejected',()=>{
  const s=fixture(),e=JSON.parse(s.envelopeBytes)
  e.signature=(e.signature[0]==='A'?'B':'A')+e.signature.slice(1)
  s.envelopeBytes=encode(e);rejects(s,'BAD_SIGNATURE')
})
test('different pinned fingerprint rejected',()=>{const s=fixture();s.trustedKeySha256='0'.repeat(64);rejects(s,'TRUST_ANCHOR_MISMATCH')})
test('different trusted public key rejected',()=>{const s=fixture();s.trustedPublicKeyPem=fixture().trustedPublicKeyPem;rejects(s,'TRUST_ANCHOR_MISMATCH')})
test('missing external fingerprint rejected',()=>{const s=fixture();delete s.trustedKeySha256;rejects(s,'UNTRUSTED_POLICY')})
test('missing independent floor rejected',()=>{const s=fixture();delete s.minimumSequence;rejects(s,'UNTRUSTED_POLICY')})
test('signed rollback rejected',()=>rejects(fixture(11),'ROLLBACK'))
test('raised trusted floor blocks older signed release',()=>{const s=fixture();s.minimumSequence=13;rejects(s,'ROLLBACK')})
test('noncanonical manifest rejected',()=>{const s=fixture();s.manifestBytes=Buffer.from(' '+s.manifestBytes);rejects(s,'MALFORMED_MANIFEST')})
test('noncanonical envelope rejected',()=>{const s=fixture();s.envelopeBytes=Buffer.from(' '+s.envelopeBytes);rejects(s,'MALFORMED_SIGNATURE')})
test('unsigned release rejected',()=>{const s=fixture();s.envelopeBytes=Buffer.from('{}\n');rejects(s,'MALFORMED_SIGNATURE')})
test('unexpected signature envelope field rejected',()=>{const s=fixture(),e=JSON.parse(s.envelopeBytes);e.extra=true;s.envelopeBytes=encode(e);rejects(s,'MALFORMED_SIGNATURE')})
test('wrong key algorithm rejected',()=>{const s=fixture(),{publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});s.trustedPublicKeyPem=publicKey.export({type:'spki',format:'pem'});rejects(s,'INVALID_TRUSTED_KEY')})
test('unsafe sequence floor rejected',()=>{const s=fixture();s.minimumSequence=Number.MAX_SAFE_INTEGER+1;rejects(s,'UNTRUSTED_POLICY')})
test('incorrect manifest digest rejected',()=>{const s=fixture(),e=JSON.parse(s.envelopeBytes);e.manifest_sha256='0'.repeat(64);s.envelopeBytes=encode(e);rejects(s,'MANIFEST_DIGEST_MISMATCH')})
test('invalid signature base64url rejected',()=>{const s=fixture(),e=JSON.parse(s.envelopeBytes);e.signature='!!!';s.envelopeBytes=encode(e);rejects(s,'MALFORMED_SIGNATURE')})
test('missing sequence rejected',()=>{const s=fixture();s.manifestBytes=encode({manifest_version:1,release_id:'r12'});rejects(s,'INVALID_RELEASE')})

test('duplicate JSON object key is not accepted as a canonical signed manifest',()=>{
  const s=fixture()
  s.manifestBytes=Buffer.from('{"assets":[],"manifest_version":1,"release_id":"r12","release_id":"r12","release_sequence":12}\\n'.replace('\\n','\n'))
  rejects(s,'MALFORMED_MANIFEST')
})
test('CLI verifies a genuine detached signature only with independently supplied policy',async()=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const {fileURLToPath}=await import('node:url')
  const {spawnSync}=await import('node:child_process')
  const dir=await mkdtemp(join(tmpdir(),'pb3-release-auth-'))
  try {
    const s=fixture()
    await Promise.all([
      writeFile(join(dir,'manifest.json'),s.manifestBytes),
      writeFile(join(dir,'signature.json'),s.envelopeBytes),
      writeFile(join(dir,'public.pem'),s.trustedPublicKeyPem),
    ])
    const args=['verify','--manifest',join(dir,'manifest.json'),'--signature',join(dir,'signature.json'),
      '--trusted-key',join(dir,'public.pem'),'--trusted-key-sha256',s.trustedKeySha256,
      '--minimum-sequence',String(s.minimumSequence)]
    const script=fileURLToPath(new URL('./verify.mjs',import.meta.url))
    const valid=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:10000})
    assert.equal(valid.status,0,valid.stderr)
    assert.equal(JSON.parse(valid.stdout).releaseSequence,12)
    const withoutPin=spawnSync(process.execPath,[script,...args.slice(0,7),...args.slice(9)],{encoding:'utf8',timeout:10000})
    assert.notEqual(withoutPin.status,0)
    assert.match(withoutPin.stderr,/RELEASE_AUTH_REJECTED/)
  } finally {await rm(dir,{recursive:true,force:true})}
})

test('signed empty asset inventory is rejected (no executable release)',()=>{
  const s=fixture(), m=JSON.parse(s.manifestBytes);m.assets=[]
  s.manifestBytes=encode(m);s.resign();rejects(s,'INVALID_MANIFEST')
})
test('signed unexpected manifest fields are rejected',()=>{
  const s=fixture(),m=JSON.parse(s.manifestBytes);m.unexpected='hidden'
  s.manifestBytes=encode(m);s.resign();rejects(s,'INVALID_MANIFEST')
})
test('signed duplicate or unsorted assets are rejected',()=>{
  const s=fixture(),m=JSON.parse(s.manifestBytes);m.assets.push({...m.assets[0]})
  s.manifestBytes=encode(m);s.resign();rejects(s,'INVALID_MANIFEST')
})
test('signed unsafe path traversal is rejected',()=>{
  const s=fixture(),m=JSON.parse(s.manifestBytes);m.assets[0].path='../index.html'
  s.manifestBytes=encode(m);s.resign();rejects(s,'INVALID_MANIFEST')
})
test('signed encoded path traversal is rejected',()=>{
  const s=fixture(),m=JSON.parse(s.manifestBytes);m.assets[0].path='%2e%2e/index.html'
  s.manifestBytes=encode(m);s.resign();rejects(s,'INVALID_MANIFEST')
})
test('signed incorrect asset type is rejected',()=>{
  const s=fixture(),m=JSON.parse(s.manifestBytes);m.assets[0].type='js'
  s.manifestBytes=encode(m);s.resign();rejects(s,'INVALID_MANIFEST')
})
test('signed mismatched Service Worker reference is rejected',()=>{
  const s=fixture(),m=JSON.parse(s.manifestBytes);m.service_worker='sw.js'
  s.manifestBytes=encode(m);s.resign();rejects(s,'INVALID_MANIFEST')
})
test('signed bad asset digest is rejected',()=>{
  const s=fixture(),m=JSON.parse(s.manifestBytes);m.assets[0].sha256='not-sha256'
  s.manifestBytes=encode(m);s.resign();rejects(s,'INVALID_MANIFEST')
})
test('signed unsafe build timestamp is rejected',()=>{
  const s=fixture(),m=JSON.parse(s.manifestBytes);m.build_time='tomorrow'
  s.manifestBytes=encode(m);s.resign();rejects(s,'INVALID_MANIFEST')
})

test('validly re-signed PWA service worker metadata passes signature+schema contract',()=>{
 const s=fixture(),m=JSON.parse(s.manifestBytes)
 m.assets.push({path:'sw.js',sha256:'b'.repeat(64),size:123,type:'service-worker'})
 m.service_worker='sw.js'
 s.manifestBytes=encode(m);s.resign()
 const r=verifyRelease(s);assert.equal(r.releaseSequence,12)
})
test('validly re-signed HTML masquerading as Service Worker rejected',()=>{
 const s=fixture(),m=JSON.parse(s.manifestBytes)
 m.service_worker='index.html';m.assets[0].type='service-worker'
 s.manifestBytes=encode(m);s.resign();rejects(s,'INVALID_MANIFEST')
})

test('trusted checkpoint allows matching signed release at equal sequence',()=>{
  const s=fixture()
  s.trustedCheckpoint={releaseSequence:12,manifestSha256:sha(s.manifestBytes)}
  assert.equal(verifyRelease(s).releaseSequence,12)
})
test('trusted checkpoint detects same-sequence signed equivocation',()=>{
  const s=fixture()
  s.trustedCheckpoint={releaseSequence:12,manifestSha256:sha(s.manifestBytes)}
  const m=JSON.parse(s.manifestBytes)
  m.release_id='rewritten'
  s.manifestBytes=encode(m);s.resign()
  rejects(s,'RELEASE_EQUIVOCATION')
})
test('trusted checkpoint rejects earlier signed version despite lower minimum floor',()=>{
  const s=fixture()
  s.minimumSequence=1
  s.trustedCheckpoint={releaseSequence:13,manifestSha256:'b'.repeat(64)}
  rejects(s,'ROLLBACK')
})
test('trusted checkpoint permits independently authorized higher release sequence',()=>{
  const s=fixture(13)
  s.trustedCheckpoint={releaseSequence:12,manifestSha256:'a'.repeat(64)}
  assert.equal(verifyRelease(s).releaseSequence,13)
})
test('untrusted malformed checkpoint rejected before signature verification',()=>{
  const invalid=[null,{}, {releaseSequence:12},{releaseSequence:12,manifestSha256:'bad'},
    {releaseSequence:0,manifestSha256:'a'.repeat(64)},
    {releaseSequence:12,manifestSha256:'a'.repeat(64),extra:true}]
  for(const trustedCheckpoint of invalid){
    const s=fixture();s.trustedCheckpoint=trustedCheckpoint
    rejects(s,'UNTRUSTED_CHECKPOINT')
  }
})
test('CLI accepts externally provided matching checkpoint and rejects re-signed equivocation',async()=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const {fileURLToPath}=await import('node:url')
  const {spawnSync}=await import('node:child_process')
  const dir=await mkdtemp(join(tmpdir(),'pb3-release-auth-checkpoint-'))
  try {
    const s=fixture(),checkpoint=sha(s.manifestBytes)
    const manifest=join(dir,'manifest.json'),signature=join(dir,'signature.json'),key=join(dir,'key.pem')
    await Promise.all([writeFile(manifest,s.manifestBytes),writeFile(signature,s.envelopeBytes),writeFile(key,s.trustedPublicKeyPem)])
    const script=fileURLToPath(new URL('./verify.mjs',import.meta.url))
    const args=['verify','--manifest',manifest,'--signature',signature,'--trusted-key',key,
      '--trusted-key-sha256',s.trustedKeySha256,'--minimum-sequence','12',
      '--trusted-checkpoint-sequence','12','--trusted-checkpoint-sha256',checkpoint]
    const ok=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:10000})
    assert.equal(ok.status,0,ok.stderr)
    const m=JSON.parse(s.manifestBytes);m.release_id='same-sequence-attack'
    s.manifestBytes=encode(m);s.resign()
    await Promise.all([writeFile(manifest,s.manifestBytes),writeFile(signature,s.envelopeBytes)])
    const bad=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:10000})
    assert.equal(bad.status,1)
    assert.match(bad.stderr,/RELEASE_EQUIVOCATION/)
  } finally {await rm(dir,{recursive:true,force:true})}
})
