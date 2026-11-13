import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import {
  freshPackage, newDeviceEncryptionKey, openDevice, sealDevice,
} from '../../identity/infrastructure/crypto'
import type {PackageV2} from '../../identity/infrastructure/crypto'
import {
  getDevice, markSignedOut, newLocalDevice, openIdentityDB, saveDevice,
} from '../../identity/infrastructure/storage'
import type {LocalDevice} from '../../identity/infrastructure/storage'
import {admitPinProtectedPackage} from './pin-package-admission'
import {
  inspectPinDeviceMigration, migrateLegacyLocalDeviceToPin,
  readSealedPinDevice,
} from './pin-device-migration'

afterEach(()=>{
  activeSession.value=null
  vi.useRealTimers()
})

async function createDevice(accountId=crypto.randomUUID(),pkg?:PackageV2) {
  const actual=pkg ?? (await freshPackage(accountId)).pkg
  const provisional=await newLocalDevice(accountId)
  const envelope=await sealDevice(actual,provisional.deviceId,provisional.encryptionKey)
  const device:LocalDevice={...provisional,envelope}
  await saveDevice(device)
  return {scope:{accountId,deviceId:device.deviceId},pkg:actual,device}
}

async function putIdentityRow(store:string,value:unknown,key?:IDBValidKey):Promise<void>{
  const db=await openIdentityDB()
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(store,'readwrite')
      tx.objectStore(store).put(value,key)
      tx.oncomplete=()=>resolve()
      tx.onabort=()=>reject(tx.error ?? Error('pin.test_store_aborted'))
    })
  }finally{db.close()}
}
async function dropIdentityRow(store:string,key:IDBValidKey):Promise<void>{
  const db=await openIdentityDB()
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(store,'readwrite')
      tx.objectStore(store).delete(key)
      tx.oncomplete=()=>resolve()
      tx.onabort=()=>reject(tx.error ?? Error('pin.test_store_aborted'))
    })
  }finally{db.close()}
}

describe('P3 #220 actual Identity v2 local PIN envelope migration acceptance (UNWIRED)',()=>{
  it('atomically replaces only original device envelope; reload can unlock only via PIN admission',async()=>{
    const f=await createDevice()
    await inspectPinDeviceMigration(f.scope)
    await migrateLegacyLocalDeviceToPin({
      ...f,verifiedPackage:f.pkg,appPin:'1836',emergencyPin:'6381',
    })
    const stored=await getDevice(f.scope.accountId,f.scope.deviceId)
    expect(stored).toBeDefined()
    expect((stored as unknown as {pinMode:string}).pinMode).toBe('pin-v1')
    expect((stored!.envelope as unknown as {purpose:string}).purpose).toBe('preunlock-package')
    expect(stored!.encryptionKey.extractable).toBe(false)
    expect(stored!.deviceKey.extractable).toBe(false)
    expect(JSON.stringify(stored)).not.toContain(f.pkg.akek)
    expect(JSON.stringify(stored)).not.toContain(f.pkg.accountPkcs8)
    // There can be no fallback via the existing pre-PIN legacy resume path.
    await expect(openDevice(
      stored!.envelope,stored!.encryptionKey,
      f.scope.accountId,f.scope.deviceId,
    )).rejects.toThrow()
    const pinDevice=await readSealedPinDevice(f.scope)
    expect(pinDevice).not.toBeNull()
    expect(pinDevice?.verifierDeviceHmac.extractable).toBe(false)
    expect(pinDevice?.envelopeDeviceAes.extractable).toBe(false)
    const ctx={
      ...f.scope,packageRevision:f.pkg.revision,sessionNonce:crypto.randomUUID(),
    }
    const args={
      encryptedPackage:pinDevice!.encrypted,
      verifierDeviceHmac:pinDevice!.verifierDeviceHmac,
      envelopeDeviceAes:pinDevice!.envelopeDeviceAes,
      readTrustedContext:()=>ctx,
    }
    expect(await admitPinProtectedPackage({...args,candidate:'1836'}))
      .toEqual({status:'unlocked',pkg:f.pkg})
    expect(await admitPinProtectedPackage({...args,candidate:'6381'}))
      .toEqual({status:'emergency-intent'})
    expect(activeSession.value).toBeNull()
  },95_000)

  it('refuses wrong PackageV2 before writing any PIN verifier or replacing device',async()=>{
    const f=await createDevice()
    const other=(await freshPackage(f.scope.accountId)).pkg
    await expect(migrateLegacyLocalDeviceToPin({
      scope:f.scope,verifiedPackage:other,appPin:'1234',emergencyPin:null,
    })).rejects.toThrow('pin.package_mismatch')
    const row=await getDevice(f.scope.accountId,f.scope.deviceId)
    expect(row?.envelope).toEqual(f.device.envelope)
    expect(await readSealedPinDevice(f.scope)).toBeNull()
    expect(await openDevice(
      row!.envelope,row!.encryptionKey,
      f.scope.accountId,f.scope.deviceId,
    )).toEqual(f.pkg)
  },45_000)

  it('rejects another locally saved device for the same account (legacy PIN bypass)',async()=>{
    const f=await createDevice()
    await createDevice(f.scope.accountId,f.pkg)
    await expect(inspectPinDeviceMigration(f.scope))
      .rejects.toThrow('pin.other_local_device')
    await expect(migrateLegacyLocalDeviceToPin({
      scope:f.scope,verifiedPackage:f.pkg,appPin:'1234',emergencyPin:null,
    })).rejects.toThrow('pin.other_local_device')
    expect((await getDevice(f.scope.accountId,f.scope.deviceId))!.envelope)
      .toEqual(f.device.envelope)
  },45_000)

  it('rejects unfinished registration, even without account ID, and preserves identity bytes',async()=>{
    const f=await createDevice()
    const operationId=crypto.randomUUID()
    await putIdentityRow('pending',{operationId,deviceId:crypto.randomUUID()})
    try{
      await expect(inspectPinDeviceMigration(f.scope))
        .rejects.toThrow('pin.legacy_pending_state')
      await expect(migrateLegacyLocalDeviceToPin({
        scope:f.scope,verifiedPackage:f.pkg,appPin:'1234',emergencyPin:null,
      })).rejects.toThrow('pin.legacy_pending_state')
      expect((await getDevice(f.scope.accountId,f.scope.deviceId))?.envelope)
        .toEqual(f.device.envelope)
    }finally{
      await dropIdentityRow('pending',operationId)
    }
  },45_000)

  it('rejects account-local pairing, recovery and rotation pending envelopes',async()=>{
    const states=[
      ['recoveries',(f:{scope:{accountId:string;deviceId:string},device:LocalDevice})=>
        ({locator:crypto.randomUUID(),device:f.device})],
      ['pairings',(f:{scope:{accountId:string;deviceId:string},device:LocalDevice})=>
        ({id:crypto.randomUUID(),accountId:f.scope.accountId,device:f.device})],
      ['rotations',(f:{scope:{accountId:string;deviceId:string},device:LocalDevice})=>
        ({accountId:f.scope.accountId,deviceId:f.scope.deviceId})],
    ] as const
    for(const [name,make] of states){
      const f=await createDevice()
      const row=make(f)
      const key=name==='rotations'?f.scope.accountId:
        name==='recoveries'?(row as {locator:string}).locator:
        (row as {id:string}).id
      await putIdentityRow(name,row)
      try{
        await expect(inspectPinDeviceMigration(f.scope))
          .rejects.toThrow('pin.legacy_pending_state')
        expect((await getDevice(f.scope.accountId,f.scope.deviceId))?.envelope)
          .toEqual(f.device.envelope)
      }finally{
        await dropIdentityRow(name,key)
      }
    }
  },95_000)

  it('rejects signed-out or active in-memory devices rather than silently enabling PIN',async()=>{
    const f=await createDevice()
    await markSignedOut(f.scope.accountId,f.scope.deviceId,true)
    await expect(inspectPinDeviceMigration(f.scope))
      .rejects.toThrow('pin.legacy_pending_state')
    await markSignedOut(f.scope.accountId,f.scope.deviceId,false)
    activeSession.value={
      accountId:f.scope.accountId,deviceId:f.scope.deviceId,
      device:f.device,pkg:f.pkg,online:false,
    }
    await expect(inspectPinDeviceMigration(f.scope))
      .rejects.toThrow('pin.live_session_must_be_closed')
    await expect(migrateLegacyLocalDeviceToPin({
      scope:f.scope,verifiedPackage:f.pkg,appPin:'1234',emergencyPin:null,
    })).rejects.toThrow('pin.live_session_must_be_closed')
    activeSession.value=null
    expect((await getDevice(f.scope.accountId,f.scope.deviceId))?.envelope)
      .toEqual(f.device.envelope)
  },45_000)

  it('fails closed if asked to enroll an already sealed device; no fallback to a legacy envelope',async()=>{
    const f=await createDevice()
    await migrateLegacyLocalDeviceToPin({
      scope:f.scope,verifiedPackage:f.pkg,appPin:'1234',emergencyPin:null,
    })
    await expect(inspectPinDeviceMigration(f.scope))
      .rejects.toThrow('pin.no_legacy_device')
    await expect(migrateLegacyLocalDeviceToPin({
      scope:f.scope,verifiedPackage:f.pkg,appPin:'1234',emergencyPin:null,
    })).rejects.toThrow('pin.no_legacy_device')
    expect((await readSealedPinDevice(f.scope))?.encrypted)
      .toBeDefined()
  },75_000)

  it('without a verifier record, encrypted device still cannot produce an unlocked package',async()=>{
    const f=await createDevice()
    await migrateLegacyLocalDeviceToPin({
      scope:f.scope,verifiedPackage:f.pkg,appPin:'1234',emergencyPin:null,
    })
    const sealed=await readSealedPinDevice(f.scope)
    expect(sealed).not.toBeNull()
    const db=new Dexie('pb3_pin_verifier_v1')
    db.version(1).stores({records:'id'})
    try{
      // Simulate storage eviction / incomplete cross-DB migration on a
      // disposable test identity. Must not downgrade to legacy or grant.
      await db.table('records').delete(f.scope.accountId+':'+f.scope.deviceId)
      await expect(admitPinProtectedPackage({
        encryptedPackage:sealed!.encrypted,candidate:'1234',
        verifierDeviceHmac:sealed!.verifierDeviceHmac,
        envelopeDeviceAes:sealed!.envelopeDeviceAes,
        readTrustedContext:()=>({
          ...f.scope,packageRevision:f.pkg.revision,
          sessionNonce:crypto.randomUUID(),
        }),
      })).rejects.toThrow('pin.not_configured')
    }finally{db.close()}
    const persisted=await getDevice(f.scope.accountId,f.scope.deviceId)
    expect((persisted!.envelope as unknown as {purpose:string}).purpose)
      .toBe('preunlock-package')
  },75_000)

  it('does not accept a missing or changed account/device identifier',async()=>{
    const f=await createDevice()
    await expect(inspectPinDeviceMigration({
      accountId:crypto.randomUUID(),deviceId:f.scope.deviceId,
    })).rejects.toThrow('pin.no_legacy_device')
    await expect(readSealedPinDevice({
      accountId:crypto.randomUUID(),deviceId:f.scope.deviceId,
    })).rejects.toThrow('pin.identity_mismatch')
    await expect(inspectPinDeviceMigration({
      accountId:'invalid',deviceId:f.scope.deviceId,
    })).rejects.toThrow('pin.invalid_scope')
  },45_000)
})
