import 'fake-indexeddb/auto'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import {freshPackage, newDeviceEncryptionKey} from '../../identity/infrastructure/crypto'
import {enrollPinVerifier} from './pin-verifier'
import {sealPinProtectedPackage} from './pin-sealed-package'
import {
  admitPinProtectedPackage, type TrustedPinContext,
} from './pin-package-admission'

afterEach(()=>{
  vi.useRealTimers()
  activeSession.value=null
})

async function fixture() {
  const accountId=crypto.randomUUID()
  const deviceId=crypto.randomUUID()
  const scope={accountId,deviceId}
  const hmac=await crypto.subtle.generateKey(
    {name:'HMAC',hash:'SHA-256',length:256},false,['sign'],
  )
  const aes=await newDeviceEncryptionKey()
  const pkg=(await freshPackage(accountId)).pkg
  await enrollPinVerifier(scope,hmac,'1234','4321')
  const envelope=await sealPinProtectedPackage(pkg,scope,'1234',aes)
  const trusted:TrustedPinContext={
    ...scope,packageRevision:pkg.revision,sessionNonce:crypto.randomUUID(),
  }
  return {scope,hmac,aes,pkg,envelope,trusted}
}

describe('P3 #220 isolated dual-PIN admission; not hooked to Identity or emergency',()=>{
  it('requires normal PIN before returning a real AES-GCM-unwrapped PackageV2',async()=>{
    const f=await fixture()
    const readTrustedContext=()=>f.trusted
    const actual=await admitPinProtectedPackage({
      encryptedPackage:JSON.parse(JSON.stringify(f.envelope)),
      candidate:'1234',verifierDeviceHmac:f.hmac,
      envelopeDeviceAes:f.aes,readTrustedContext,
    })
    expect(actual).toEqual({status:'unlocked',pkg:f.pkg})
    expect(activeSession.value).toBeNull()
  },45_000)

  it('cannot open malformed ciphertext with a wrong or emergency PIN',async()=>{
    const f=await fixture()
    const bad={...f.envelope,ciphertext:'not-real-ciphertext'}
    const args={
      encryptedPackage:bad,
      verifierDeviceHmac:f.hmac,
      envelopeDeviceAes:f.aes,
      readTrustedContext:()=>f.trusted,
    }
    expect(await admitPinProtectedPackage({...args,candidate:'0000'}))
      .toEqual({status:'invalid',attemptsRemaining:4})
    expect(await admitPinProtectedPackage({...args,candidate:'4321'}))
      .toEqual({status:'emergency-intent'})
    expect(activeSession.value).toBeNull()
    // A genuine app PIN must still reject the malformed encrypted package.
    await expect(admitPinProtectedPackage({...args,candidate:'1234'}))
      .rejects.toThrow('pin.invalid_package_envelope')
  },45_000)

  it('does not bypass a persisted five-attempt/30-minute lock with the valid app PIN',async()=>{
    vi.useFakeTimers({toFake:['Date']})
    vi.setSystemTime(new Date('2026-11-14T08:00:00Z'))
    const f=await fixture()
    const args={
      encryptedPackage:f.envelope,verifierDeviceHmac:f.hmac,
      envelopeDeviceAes:f.aes,readTrustedContext:()=>f.trusted,
    }
    for(let n=1;n<5;n++){
      expect(await admitPinProtectedPackage({...args,candidate:'9999'}))
        .toEqual({status:'invalid',attemptsRemaining:5-n})
    }
    expect(await admitPinProtectedPackage({...args,candidate:'9999'}))
      .toEqual({status:'locked',retryAfterMs:1_800_000})
    expect(await admitPinProtectedPackage({...args,candidate:'1234'}).then(x=>x.status))
      .toBe('locked')
    expect(await admitPinProtectedPackage({...args,candidate:'4321'}).then(x=>x.status))
      .toBe('locked')
    vi.setSystemTime(new Date('2026-11-14T08:30:00Z'))
    expect(await admitPinProtectedPackage({...args,candidate:'1234'}))
      .toEqual({status:'unlocked',pkg:f.pkg})
  },100_000)

  it('rejects a lost/switching trusted session after asynchronous verifier work',async()=>{
    const f=await fixture()
    let reads=0
    await expect(admitPinProtectedPackage({
      encryptedPackage:f.envelope,candidate:'1234',
      verifierDeviceHmac:f.hmac,envelopeDeviceAes:f.aes,
      readTrustedContext:()=>++reads===1?f.trusted:{
        ...f.trusted,sessionNonce:crypto.randomUUID(),
      },
    })).rejects.toThrow('pin.session_changed')
    expect(activeSession.value).toBeNull()
  },45_000)

  it('rejects same-account session incarnation change during ciphertext decrypt',async()=>{
    const f=await fixture()
    let reads=0
    await expect(admitPinProtectedPackage({
      encryptedPackage:f.envelope,candidate:'1234',
      verifierDeviceHmac:f.hmac,envelopeDeviceAes:f.aes,
      readTrustedContext:()=>{
        reads++
        return reads<3?f.trusted:{
          ...f.trusted,sessionNonce:crypto.randomUUID(),
        }
      },
    })).rejects.toThrow('pin.session_changed')
    expect(reads).toBe(3)
    expect(activeSession.value).toBeNull()
  },45_000)

  it('rejects device switch, account switch and revision switch before keys are returned',async()=>{
    const f=await fixture()
    for(const changed of [
      {...f.trusted,deviceId:crypto.randomUUID()},
      {...f.trusted,accountId:crypto.randomUUID()},
      {...f.trusted,packageRevision:f.trusted.packageRevision+1},
    ]){
      let reads=0
      await expect(admitPinProtectedPackage({
        encryptedPackage:f.envelope,candidate:'1234',
        verifierDeviceHmac:f.hmac,envelopeDeviceAes:f.aes,
        readTrustedContext:()=>++reads===1?f.trusted:changed,
      })).rejects.toThrow('pin.session_changed')
    }
    expect(activeSession.value).toBeNull()
  },70_000)

  it('requires a valid trusted session before reading PIN/verifier state',async()=>{
    const f=await fixture()
    const base={
      encryptedPackage:f.envelope,candidate:'1234',
      verifierDeviceHmac:f.hmac,envelopeDeviceAes:f.aes,
    }
    await expect(admitPinProtectedPackage({
      ...base,readTrustedContext:()=>null,
    })).rejects.toThrow('pin.session_unavailable')
    await expect(admitPinProtectedPackage({
      ...base,readTrustedContext:()=>({...f.trusted,sessionNonce:'bad'}),
    })).rejects.toThrow('pin.session_unavailable')
    await expect(admitPinProtectedPackage({
      ...base,readTrustedContext:()=>{throw new Error('transient session failure')},
    })).rejects.toThrow('pin.session_unavailable')
  },45_000)

  it('rejects a wrong HMAC device credential or wrong AES envelope credential',async()=>{
    const f=await fixture()
    const otherHmac=await crypto.subtle.generateKey(
      {name:'HMAC',hash:'SHA-256',length:256},false,['sign'],
    )
    const args={
      encryptedPackage:f.envelope,candidate:'1234',
      verifierDeviceHmac:f.hmac,envelopeDeviceAes:f.aes,
      readTrustedContext:()=>f.trusted,
    }
    await expect(admitPinProtectedPackage({
      ...args,verifierDeviceHmac:otherHmac,
    })).rejects.toThrow('pin.integrity_failed')
    await expect(admitPinProtectedPackage({
      ...args,envelopeDeviceAes:await newDeviceEncryptionKey(),
    })).rejects.toThrow('pin.package_unavailable')
    expect(activeSession.value).toBeNull()
  },60_000)
})
