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
  const manifestBytes=encode({assets:[],manifest_version:1,release_id:'r12',release_sequence:sequence})
  const envelopeBytes=encode({key_id:trustedKeySha256,manifest_sha256:sha(manifestBytes),
    signature:sign(null,manifestBytes,privateKey).toString('base64url'),signature_version:1})
  return {manifestBytes,envelopeBytes,trustedPublicKeyPem,trustedKeySha256,minimumSequence:12}
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
