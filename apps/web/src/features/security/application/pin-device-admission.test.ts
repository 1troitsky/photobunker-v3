import 'fake-indexeddb/auto'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import {
  freshPackage,openDevice,sealDevice,
} from '../../identity/infrastructure/crypto'
import {
  getDevice,newLocalDevice,saveDevice,
} from '../../identity/infrastructure/storage'
import {migrateLegacyLocalDeviceToPin} from './pin-device-migration'
import {admitCoLocatedPinDevice} from './pin-device-admission'

afterEach(()=>{
  activeSession.value=null
  vi.useRealTimers()
})

async function fixture(){
  const accountId=crypto.randomUUID()
  const pkg=(await freshPackage(accountId)).pkg
  const device=await newLocalDevice(accountId)
  device.envelope=await sealDevice(pkg,device.deviceId,device.encryptionKey)
  await saveDevice(device)
  const scope={accountId,deviceId:device.deviceId}
  await migrateLegacyLocalDeviceToPin({
    scope,verifiedPackage:pkg,appPin:'3841',emergencyPin:'1483',
  })
  const context={
    ...scope,packageRevision:pkg.revision,sessionNonce:crypto.randomUUID(),
  }
  return {scope,pkg,context}
}

describe('P3 #220 co-located IDB PIN-verifier and identity admission, preintegration',()=>{
  it('unlocks actual protected account only with app PIN, keeping activeSession null',async()=>{
    const f=await fixture()
    const args={scope:f.scope,readTrustedContext:()=>f.context}
    expect(await admitCoLocatedPinDevice({...args,candidate:'3841'}))
      .toEqual({status:'unlocked',pkg:f.pkg})
    expect(activeSession.value).toBeNull()
    const row=await getDevice(f.scope.accountId,f.scope.deviceId)
    await expect(openDevice(row!.envelope,row!.encryptionKey,
      f.scope.accountId,f.scope.deviceId)).rejects.toThrow()
  },70_000)

  it('rejects wrong and emergency PIN as means of package access',async()=>{
    const f=await fixture()
    const args={scope:f.scope,readTrustedContext:()=>f.context}
    expect(await admitCoLocatedPinDevice({...args,candidate:'9999'}))
      .toEqual({status:'invalid',attemptsRemaining:4})
    expect(await admitCoLocatedPinDevice({...args,candidate:'1483'}))
      .toEqual({status:'emergency-intent'})
    expect(activeSession.value).toBeNull()
  },70_000)

  it('fails closed if scoped account/device differs from trusted context',async()=>{
    const f=await fixture()
    await expect(admitCoLocatedPinDevice({
      scope:{...f.scope,deviceId:crypto.randomUUID()},
      candidate:'3841',readTrustedContext:()=>f.context,
    })).rejects.toThrow('pin.session_changed')
    expect(activeSession.value).toBeNull()
  },50_000)

  it('detects same reference session nonce mutation before package decrypt',async()=>{
    const f=await fixture()
    let reads=0
    const original={...f.context}
    await expect(admitCoLocatedPinDevice({
      scope:f.scope,candidate:'3841',
      readTrustedContext:()=>{
        if(++reads===2)original.sessionNonce=crypto.randomUUID()
        return original
      },
    })).rejects.toThrow('pin.session_changed')
    expect(reads).toBe(2)
    expect(activeSession.value).toBeNull()
  },70_000)

  it('detects a session switch after PBKDF2 package decrypt',async()=>{
    const f=await fixture()
    let reads=0
    await expect(admitCoLocatedPinDevice({
      scope:f.scope,candidate:'3841',
      readTrustedContext:()=>{
        if(++reads>=4)return {...f.context,sessionNonce:crypto.randomUUID()}
        return f.context
      },
    })).rejects.toThrow('pin.session_changed')
    expect(reads).toBe(4)
    expect(activeSession.value).toBeNull()
  },70_000)

  it('refuses an untrusted/unavailable session or wrong revision',async()=>{
    const f=await fixture()
    await expect(admitCoLocatedPinDevice({
      scope:f.scope,candidate:'3841',readTrustedContext:()=>null,
    })).rejects.toThrow('pin.session_unavailable')
    await expect(admitCoLocatedPinDevice({
      scope:f.scope,candidate:'3841',
      readTrustedContext:()=>({...f.context,packageRevision:99999}),
    })).rejects.toThrow('pin.invalid_package_envelope')
    expect(activeSession.value).toBeNull()
  },70_000)
})
