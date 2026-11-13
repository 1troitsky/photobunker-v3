import {describe, expect, it} from 'vitest'
import {
  freshPackage, newDeviceEncryptionKey,
} from '../../identity/infrastructure/crypto'
import type {PackageV2} from '../../identity/infrastructure/crypto'
import {
  openPinProtectedPackage, sealPinProtectedPackage,
} from './pin-sealed-package'

async function fixture() {
  const accountId = crypto.randomUUID()
  const deviceId = crypto.randomUUID()
  const pkg = (await freshPackage(accountId)).pkg
  const scope = {accountId,deviceId}
  const deviceKey = await newDeviceEncryptionKey()
  return {pkg,scope,deviceKey}
}

describe('P3 #220 independent pre-unlock PIN-sealed PackageV2, NOT integrated',()=>{
  it('round-trips a real signed identity package after JSON reload without plaintext fields',async()=>{
    const {pkg,scope,deviceKey}=await fixture()
    const sealed=await sealPinProtectedPackage(pkg,scope,'372819',deviceKey)
    expect(sealed).toEqual({
      v:1,alg:'PBKDF2-SHA256+A256GCM+A256GCM',
      purpose:'preunlock-package',accountId:scope.accountId,
      deviceId:scope.deviceId,packageRevision:pkg.revision,
      salt:expect.any(String),pinIv:expect.any(String),
      deviceIv:expect.any(String),ciphertext:expect.any(String),
    })
    const serialized=JSON.stringify(sealed)
    expect(serialized).not.toContain(pkg.akek)
    expect(serialized).not.toContain(pkg.accountPkcs8)
    expect(serialized).not.toContain(pkg.wrappingKeyId)
    expect(serialized).not.toContain('372819')
    const restored=JSON.parse(serialized)
    expect(await openPinProtectedPackage(
      restored,scope,'372819',deviceKey,pkg.revision,
    )).toEqual(pkg)
  },30_000)

  it('rejects an emergency PIN as a package unlock rather than returning keys',async()=>{
    const {pkg,scope,deviceKey}=await fixture()
    const sealed=await sealPinProtectedPackage(pkg,scope,'1234',deviceKey)
    await expect(openPinProtectedPackage(sealed,scope,'4321',deviceKey,pkg.revision))
      .rejects.toThrow('pin.package_unavailable')
    expect(await openPinProtectedPackage(sealed,scope,'1234',deviceKey,pkg.revision))
      .toEqual(pkg)
  },30_000)

  it('fails closed on wrong device key even with correct app PIN',async()=>{
    const {pkg,scope,deviceKey}=await fixture()
    const sealed=await sealPinProtectedPackage(pkg,scope,'1234',deviceKey)
    await expect(openPinProtectedPackage(sealed,scope,'1234',
      await newDeviceEncryptionKey(),pkg.revision))
      .rejects.toThrow('pin.package_unavailable')
  },30_000)

  it('fails closed on wrong account and device before running PIN KDF',async()=>{
    const {pkg,scope,deviceKey}=await fixture()
    const sealed=await sealPinProtectedPackage(pkg,scope,'1234',deviceKey)
    await expect(openPinProtectedPackage(sealed,{
      accountId:crypto.randomUUID(),deviceId:scope.deviceId,
    },'1234',deviceKey,pkg.revision))
      .rejects.toThrow('pin.invalid_package_envelope')
    await expect(openPinProtectedPackage(sealed,{
      accountId:scope.accountId,deviceId:crypto.randomUUID(),
    },'1234',deviceKey,pkg.revision))
      .rejects.toThrow('pin.invalid_package_envelope')
    await expect(sealPinProtectedPackage(pkg,{
      accountId:crypto.randomUUID(),deviceId:scope.deviceId,
    },'1234',deviceKey)).rejects.toThrow('identity.invalid_package')
  },30_000)

  it('refuses untrusted package revision or malformed PIN format',async()=>{
    const {pkg,scope,deviceKey}=await fixture()
    const sealed=await sealPinProtectedPackage(pkg,scope,'1234',deviceKey)
    await expect(openPinProtectedPackage(sealed,scope,'1234',deviceKey,pkg.revision+1))
      .rejects.toThrow('pin.invalid_package_envelope')
    await expect(openPinProtectedPackage(sealed,scope,'1234',deviceKey,0))
      .rejects.toThrow('pin.invalid_revision')
    await expect(openPinProtectedPackage(sealed,scope,'abcd',deviceKey,pkg.revision))
      .rejects.toThrow('pin.invalid_format')
    await expect(sealPinProtectedPackage(pkg,scope,'123',deviceKey))
      .rejects.toThrow('pin.invalid_format')
  },30_000)

  it('rejects device-only payload changes and any modified envelope fields',async()=>{
    const {pkg,scope,deviceKey}=await fixture()
    const sealed=await sealPinProtectedPackage(pkg,scope,'1234',deviceKey)
    for (const field of ['salt','pinIv','deviceIv','ciphertext'] as const){
      const original=sealed[field]
      const replacement=original[0]==='A'?'B':'A'
      const corrupted={...sealed,[field]:replacement+original.slice(1)}
      await expect(openPinProtectedPackage(
        corrupted,scope,'1234',deviceKey,pkg.revision,
      )).rejects.toThrow(/pin\.(?:package_unavailable|invalid_package_envelope)/)
    }
    await expect(openPinProtectedPackage({...sealed,purpose:'not-a-package'},
      scope,'1234',deviceKey,pkg.revision)).rejects.toThrow('pin.invalid_package_envelope')
    await expect(openPinProtectedPackage({...sealed,extra:'hidden'},
      scope,'1234',deviceKey,pkg.revision)).rejects.toThrow('pin.invalid_package_envelope')
    await expect(openPinProtectedPackage({...sealed,ciphertext:'A'.repeat(10000)},
      scope,'1234',deviceKey,pkg.revision)).rejects.toThrow('pin.invalid_package_envelope')
  },45_000)

  it('refuses extractable device keys, wrong key algorithm and impossible scope',async()=>{
    const {pkg,scope,deviceKey}=await fixture()
    const extractable=await crypto.subtle.generateKey(
      {name:'AES-GCM',length:256},true,['encrypt','decrypt'],
    )
    await expect(sealPinProtectedPackage(pkg,scope,'1234',extractable))
      .rejects.toThrow('pin.invalid_device_key')
    const wrong=await crypto.subtle.generateKey(
      {name:'HMAC',hash:'SHA-256'},false,['sign'],
    )
    await expect(sealPinProtectedPackage(pkg,scope,'1234',wrong))
      .rejects.toThrow('pin.invalid_device_key')
    await expect(sealPinProtectedPackage(pkg,{
      accountId:'bad',deviceId:scope.deviceId,
    },'1234',deviceKey)).rejects.toThrow('pin.invalid_scope')
  },30_000)

  it('rejects a package with mismatched P-256 signing keys instead of encrypting it',async()=>{
    const {pkg,scope,deviceKey}=await fixture()
    const foreign=(await freshPackage(crypto.randomUUID())).pkg
    const forged:PackageV2={...pkg,accountPkcs8:foreign.accountPkcs8}
    await expect(sealPinProtectedPackage(forged,scope,'1234',deviceKey))
      .rejects.toThrow('pin.invalid_package_keypair')
  },30_000)

  it('produces independent randomized sealed ciphertext for equivalent package and PIN',async()=>{
    const {pkg,scope,deviceKey}=await fixture()
    const first=await sealPinProtectedPackage(pkg,scope,'1234',deviceKey)
    const second=await sealPinProtectedPackage(pkg,scope,'1234',deviceKey)
    expect(first.salt).not.toBe(second.salt)
    expect(first.pinIv).not.toBe(second.pinIv)
    expect(first.deviceIv).not.toBe(second.deviceIv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
    expect(await openPinProtectedPackage(second,scope,'1234',deviceKey,pkg.revision))
      .toEqual(pkg)
  },45_000)
})
