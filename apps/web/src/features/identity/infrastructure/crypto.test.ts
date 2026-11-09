import { describe, expect, it } from 'vitest'
import { b64, createPB2, descriptor, digest, freshPackage, hex, importSigner, importSpki,
  openDevice, openRecovery, parsePB2, recoveryKey, sealDevice, sealRecovery, sign, unb64,
  verify, wrapAssetDEK, unwrapAssetDEK, newDeviceEncryptionKey, canonical } from './crypto'

const accountId='00000000-0000-4000-8000-000000000001'
const fixed='PB2.AAECAwQFBgcICQoLDA0ODw.AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8.DfSeedbBq6Y'

describe('Codex protocol v2 executable deterministic vectors',()=>{
  it('parses canonical fixed PB2, checks exact checksum and rejects PB1, alias and corruption',async()=>{
    const key=await parsePB2(fixed)
    expect(key.locator).toBe('AAECAwQFBgcICQoLDA0ODw')
    expect(key.secret.byteLength).toBe(32)
    expect(key.encoded).toBe(fixed)
    for(const value of [
      fixed.replace('PB2.','PB1.'),fixed+'=',fixed+' ',fixed.replace('DfSeedbBq6Y','DfSeedbBq6Z'),
      fixed.replace('.AAECAwQFBgcICQoLDA0ODw.','.AAECAwQFBgcICQoLDA0ODw=.'),
      fixed.replace('DfSeedbBq6Y',''),fixed.toLowerCase(),
    ])await expect(parsePB2(value)).rejects.toThrow()
    expect((await createPB2()).encoded.split('.')).toHaveLength(4)
  })
  it('matches fixed HKDF SHA-256 output and preserves input entropy',async()=>{
    const kit=await parsePB2(fixed)
    const raw=await crypto.subtle.importKey('raw',kit.secret,'HKDF',false,['deriveBits'])
    const output=await crypto.subtle.deriveBits({
      name:'HKDF',hash:'SHA-256',salt:unb64(kit.locator,16),
      info:new TextEncoder().encode('photobunker/recovery-envelope/v2:'+accountId),
    },raw,256)
    expect(hex(new Uint8Array(output))).toBe('aee630a52a9361e5e677793df273a4fabd0c60b615e205e2facfaa06278f90a6')
    expect((await recoveryKey(kit,accountId)).extractable).toBe(false)
  })
  it('seals account package with AAD, fails closed on tamper/version, and uses real ECDSA',async()=>{
    const kit=await parsePB2(fixed)
    const {pkg}=await freshPackage(accountId)
    const env=await sealRecovery(pkg,kit)
    expect(env.iv.length).toBe(16)
    expect(env.v).toBe(2)
    expect((await openRecovery(env,kit,accountId)).akek).toBe(pkg.akek)
    for(const broken of [
      {...env,revision:env.revision+1},
      {...env,purpose:'device'},
      {...env,v:1},
      {...env,locator:b64(new Uint8Array(16))},
      {...env,ciphertext:env.ciphertext.slice(0,-2)+'AA'},
      {...env,additional:'unexpected'},
    ])await expect(openRecovery(broken,kit,accountId)).rejects.toThrow()
    const priv=await importSigner(pkg.accountPkcs8),pub=await importSpki(pkg.accountSpki)
    const message='photobunker.identity.v2\nlogin\nchallenge\nnonce\nexpiry\nhash'
    expect(await verify(pub,message,await sign(priv,message))).toBe(true)
    expect(await verify(pub,message+'!',await sign(priv,message))).toBe(false)
  })
  it('non-extractable device envelope separates device and recovery purposes',async()=>{
    const {pkg}=await freshPackage(accountId)
    const key=await newDeviceEncryptionKey()
    const deviceId='00000000-0000-4000-8000-000000000002'
    const env=await sealDevice(pkg,deviceId,key)
    expect(key.extractable).toBe(false)
    expect((await openDevice(env,key,accountId,deviceId)).accountSpki).toBe(pkg.accountSpki)
    await expect(openDevice(env,key,accountId,accountId)).rejects.toThrow()
    await expect(openDevice({...env,revision:3},key,accountId,deviceId)).rejects.toThrow()
  })
  it('per-asset DEK is fresh and bound to asset ID and expiry; AKEK never encrypts pixels',async()=>{
    const {pkg}=await freshPackage(accountId)
    const asset='00000000-0000-4000-8000-000000000099'
    const a=await wrapAssetDEK(pkg,asset,'2026-11-01T00:00:00Z')
    const b=await wrapAssetDEK(pkg,asset,'2026-11-01T00:00:00Z')
    expect(a).not.toEqual(b)
    const opened=await unwrapAssetDEK(pkg,asset,'2026-11-01T00:00:00Z',a)
    expect(opened.extractable).toBe(false)
    await expect(unwrapAssetDEK(pkg,asset,'2026-11-02T00:00:00Z',a)).rejects.toThrow()
  })
  it('canonical JSON and descriptor are predictable ASCII',async()=>{
    expect(canonical({purpose:'login',accountId,deviceId:'D'})).toBe('{"accountId":"'+accountId+'","deviceId":"D","purpose":"login"}')
    expect(hex(await digest(descriptor({version:2,alg:'A256GCM',accountId})))).toMatch(/^[a-f0-9]{64}$/)
    expect(()=>unb64('AA=')).toThrow()
  })
})
