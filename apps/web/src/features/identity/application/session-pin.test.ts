import 'fake-indexeddb/auto'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {
  activeSession,beginRegistration,identityBootstrapError,
  identityBootstrapReady,pendingPinUnlock,restoreAccount,
  resumeExistingDevice,unlockPinnedDevice,refreshPinSessionFence,
  signPhotoContract,lockActivePinSession,
} from './session'
import {
  b64,canonical,createPB2,digest,freshPackage,hex,random,
  sealDevice,sealRecovery,
} from '../infrastructure/crypto'
import {
  getDevice,isSignedOut,markSignedOut,newLocalDevice,
  openIdentityDB,saveDevice,
} from '../infrastructure/storage'
import {migrateLegacyLocalDeviceToPin} from '../../security/application/pin-device-migration'
import {sealPinProtectedPackage} from '../../security/application/pin-sealed-package'
import {buildPinVerifierSnapshot,prepareVerifiedPinRelockPolicy} from '../../security/application/pin-verifier'
import {TestPinLockManager} from '../../security/application/pin-test-locks'

const mocks=vi.hoisted(()=>({jsonApi:vi.fn(),resetCsrf:vi.fn()}))
vi.mock('../infrastructure/api',()=>mocks)

async function resetStorage(){
  const db=await openIdentityDB()
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction([
        'devices','pending','recoveries','pairings','rotations','sessions','probe',
      ],'readwrite')
      for(const store of [
        'devices','pending','recoveries','pairings','rotations','sessions','probe',
      ])tx.objectStore(store).clear()
      tx.oncomplete=()=>resolve()
      tx.onabort=()=>reject(tx.error??Error('test.reset_aborted'))
    })
  }finally{db.close()}
}
beforeEach(async()=>{
  vi.useRealTimers()
  activeSession.value=null
  vi.stubGlobal('navigator',{locks:new TestPinLockManager()})
  pendingPinUnlock.value=null
  identityBootstrapReady.value=false
  identityBootstrapError.value=null
  vi.resetAllMocks()
  mocks.jsonApi.mockRejectedValue(new Error('offline'))
  await resetStorage()
})

afterEach(()=>vi.unstubAllGlobals())

async function account(){
  const accountId=crypto.randomUUID()
  const pkg=(await freshPackage(accountId)).pkg
  const device=await newLocalDevice(accountId)
  device.envelope=await sealDevice(pkg,device.deviceId,device.encryptionKey)
  await saveDevice(device)
  return {pkg,device,scope:{accountId,deviceId:device.deviceId}}
}
async function protectedAccount(){
  const f=await account()
  await migrateLegacyLocalDeviceToPin({
    scope:f.scope,verifiedPackage:f.pkg,appPin:'4826',emergencyPin:'6284',
  })
  return f
}
async function corruptDevice(deviceId:string,edit:(row:Record<string,unknown>)=>void){
  const db=await openIdentityDB()
  try{
    const row=await new Promise<Record<string,unknown>>((resolve,reject)=>{
      const tx=db.transaction('devices','readonly')
      const get=tx.objectStore('devices').get(deviceId)
      get.onsuccess=()=>resolve(get.result as Record<string,unknown>)
      get.onerror=()=>reject(get.error)
    })
    edit(row)
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('devices','readwrite')
      tx.objectStore('devices').put(row)
      tx.oncomplete=()=>resolve()
      tx.onabort=()=>reject(tx.error??Error('test.write_aborted'))
    })
  }finally{db.close()}
}


async function simulateForeignPinSeal(f:Awaited<ReturnType<typeof account>>){
  // A second browser tab has its OWN activeSession instance. Write the same
  // authenticated device-row shape without using migration() here, because
  // this test tab is deliberately still logged in.
  const hmac=await crypto.subtle.generateKey(
    {name:'HMAC',hash:'SHA-256',length:256},false,['sign'],
  )
  const envelope=await sealPinProtectedPackage(
    f.pkg,f.scope,'4826',f.device.encryptionKey,
  )
  const verifier=await buildPinVerifierSnapshot(
    f.scope,hmac,'4826','6284',
  )
  await saveDevice({
    ...f.device,envelope,pinMode:'pin-v1',
    pinHmacKey:hmac,pinVerifier:verifier,pinLength:4,
  } as unknown as typeof f.device)
}

describe('P3 #220 real Identity PIN preunlock bootstrap (no live enrollment)',()=>{
  it('discovers a saved PIN device without any plaintext PackageV2 or offline session',async()=>{
    const f=await protectedAccount()
    const result=await resumeExistingDevice()
    expect(result).toBeNull()
    expect(identityBootstrapReady.value).toBe(true)
    expect(activeSession.value).toBeNull()
    expect(pendingPinUnlock.value).toEqual({
      ...f.scope,pinLength:4,packageRevision:f.pkg.revision,
      sessionNonce:expect.any(String),
    })
    expect(JSON.stringify(pendingPinUnlock.value)).not.toContain(f.pkg.akek)
    await expect(beginRegistration()).rejects.toThrow('identity.pin_locked')
  },90_000)

  it('unlocks the *same persisted* package offline only after normal PIN',async()=>{
    const f=await protectedAccount()
    await resumeExistingDevice()
    expect(await unlockPinnedDevice('0000'))
      .toEqual({status:'invalid',attemptsRemaining:4})
    expect(activeSession.value).toBeNull()
    expect(await unlockPinnedDevice('6284'))
      .toEqual({status:'emergency-intent'})
    expect(activeSession.value).toBeNull()
    expect(await unlockPinnedDevice('4826'))
      .toEqual({status:'app-unlocked'})
    expect(activeSession.value?.pkg).toEqual(f.pkg)
    expect(activeSession.value?.online).toBe(false)
    expect(pendingPinUnlock.value).toBeNull()
    const row=await getDevice(f.scope.accountId,f.scope.deviceId)
    expect((row!.envelope as unknown as {purpose:string}).purpose)
      .toBe('preunlock-package')
    expect(mocks.jsonApi).toHaveBeenCalled()
  },120_000)

  it('keeps legacy no-PIN devices compatible and does not display a PIN screen',async()=>{
    const f=await account()
    const resumed=await resumeExistingDevice()
    expect(resumed?.accountId).toBe(f.scope.accountId)
    expect(resumed?.pkg).toEqual(f.pkg)
    expect(resumed?.online).toBe(false)
    expect(pendingPinUnlock.value).toBeNull()
    expect(identityBootstrapReady.value).toBe(true)
  },60_000)

  it('preserves Local-First legacy session while server proof is stalled',async()=>{
    const f=await account()
    let rejectProof:((error:Error)=>void)|undefined
    mocks.jsonApi.mockImplementation(()=>new Promise((_resolve,reject)=>{
      rejectProof=(error:Error)=>reject(error)
    }))
    const pending=resumeExistingDevice()
    await vi.waitFor(()=>expect(rejectProof).toBeTypeOf('function'),{
      timeout:5000,
    })
    expect(activeSession.value?.pkg).toEqual(f.pkg)
    expect(activeSession.value?.online).toBe(false)
    expect(identityBootstrapReady.value).toBe(true)
    expect(pendingPinUnlock.value).toBeNull()
    rejectProof!(new Error('offline'))
    await pending
  },60_000)

  it('keeps a native shared lease while legacy keys are active; migration requires full closure',async()=>{
    const f=await account()
    const resumed=await resumeExistingDevice()
    expect(resumed?.pkg).toEqual(f.pkg)
    const locks=navigator.locks as unknown as TestPinLockManager
    expect(locks.heldNames()).toHaveLength(1)
    await expect(migrateLegacyLocalDeviceToPin({
      scope:f.scope,verifiedPackage:f.pkg,
      appPin:'4826',emergencyPin:'6284',
    })).rejects.toThrow('pin.other_tab_active')
    const unchanged=await getDevice(f.scope.accountId,f.scope.deviceId)
    expect((unchanged?.envelope as {purpose:string}|undefined)?.purpose)
      .toBe('device')
    // Disposable-test cooperative shutdown, NOT production logout or
    // a guarantee that an old tab has erased all copies of PackageV2.
    activeSession.value=null
    await vi.waitFor(()=>expect(locks.heldNames()).toHaveLength(0))
    await migrateLegacyLocalDeviceToPin({
      scope:f.scope,verifiedPackage:f.pkg,
      appPin:'4826',emergencyPin:'6284',
    })
    const sealed=await getDevice(f.scope.accountId,f.scope.deviceId)
    expect((sealed?.envelope as {purpose:string}|undefined)?.purpose)
      .toBe('preunlock-package')
  },105_000)

  it('refuses to migrate where Web Locks is unavailable while legacy offline remains usable',async()=>{
    const f=await account()
    vi.stubGlobal('navigator',{})
    await expect(migrateLegacyLocalDeviceToPin({
      scope:f.scope,verifiedPackage:f.pkg,
      appPin:'4826',emergencyPin:'6284',
    })).rejects.toThrow('pin.web_locks_required')
    expect((await getDevice(f.scope.accountId,f.scope.deviceId))?.envelope)
      .toEqual(f.device.envelope)
    expect((await resumeExistingDevice())?.pkg).toEqual(f.pkg)
  },90_000)

  it('refuses malformed sealed metadata and never falls back to app shell data',async()=>{
    const f=await protectedAccount()
    await corruptDevice(f.device.deviceId,row=>{row.pinLength=3})
    await expect(resumeExistingDevice()).rejects.toThrow('identity.invalid_sealed_device')
    expect(activeSession.value).toBeNull()
    expect(identityBootstrapReady.value).toBe(true)
    expect(identityBootstrapError.value).toBe('identity.invalid_sealed_device')
  },60_000)

  it('rejects mixed sealed and legacy copies of one account before unwrapping either',async()=>{
    const f=await protectedAccount()
    const another=await newLocalDevice(f.scope.accountId)
    another.envelope=await sealDevice(
      f.pkg,another.deviceId,another.encryptionKey,
    )
    await saveDevice(another)
    await expect(resumeExistingDevice()).rejects.toThrow('identity.mixed_sealed_devices')
    expect(activeSession.value).toBeNull()
    expect(identityBootstrapError.value).toBe('identity.mixed_sealed_devices')
  },60_000)

  it('signed-out PIN device never silently resumes or opens the stored package',async()=>{
    const f=await protectedAccount()
    await markSignedOut(f.scope.accountId,f.scope.deviceId,true)
    expect(await resumeExistingDevice()).toBeNull()
    expect(pendingPinUnlock.value).toBeNull()
    expect(activeSession.value).toBeNull()
    expect(identityBootstrapReady.value).toBe(true)
  },60_000)

  it('fails closed if a PIN session incarnation changes during async crypto',async()=>{
    await protectedAccount()
    await resumeExistingDevice()
    const pending=unlockPinnedDevice('4826')
    pendingPinUnlock.value={
      ...pendingPinUnlock.value!,sessionNonce:crypto.randomUUID(),
    }
    await expect(pending).rejects.toThrow('identity.pin_session_changed')
    expect(activeSession.value).toBeNull()
  },70_000)

  it('enforces persistent 5-failure/30min lock during the real login flow',async()=>{
    vi.useFakeTimers({toFake:['Date']})
    vi.setSystemTime(new Date('2026-11-14T09:00:00Z'))
    await protectedAccount()
    await resumeExistingDevice()
    for(let i=1;i<=4;i++){
      expect(await unlockPinnedDevice('9999'))
        .toEqual({status:'invalid',attemptsRemaining:5-i})
    }
    expect((await unlockPinnedDevice('9999')).status).toBe('locked')
    expect((await unlockPinnedDevice('4826')).status).toBe('locked')
    expect(activeSession.value).toBeNull()
    vi.setSystemTime(new Date('2026-11-14T09:30:00Z'))
    expect(await unlockPinnedDevice('4826')).toEqual({status:'app-unlocked'})
    expect(activeSession.value).not.toBeNull()
    vi.useRealTimers()
  },120_000)

  it('locks an already active legacy tab when a second tab seals the same device',async()=>{
    const f=await account()
    await resumeExistingDevice()
    expect(activeSession.value?.pkg).toEqual(f.pkg)
    await simulateForeignPinSeal(f)
    expect(await refreshPinSessionFence()).toBe(true)
    expect(activeSession.value).toBeNull()
    expect(pendingPinUnlock.value).toEqual({
      ...f.scope,pinLength:4,packageRevision:f.pkg.revision,
      sessionNonce:expect.any(String),
    })
    await expect(signPhotoContract('signed media'))
      .rejects.toThrow('identity.account_locked')
    expect(identityBootstrapError.value).toBeNull()
  },95_000)

  it('refuses a legacy resume whose AES decrypt races a foreign tab PIN seal',async()=>{
    const f=await account()
    const decryptActual=crypto.subtle.decrypt.bind(crypto.subtle)
    let signalStarted!:()=>void
    let releaseDecrypt!:()=>void
    const started=new Promise<void>(resolve=>{signalStarted=resolve})
    const blocked=new Promise<void>(resolve=>{releaseDecrypt=resolve})
    let once=false
    const spy=vi.spyOn(crypto.subtle,'decrypt').mockImplementation(async(
      algorithm,key,data,
    )=>{
      // DeviceEnvelope carries authenticated AAD; capability probe does not.
      if(!once && typeof algorithm==='object' &&
         'additionalData' in algorithm){
        once=true
        signalStarted()
        await blocked
      }
      return decryptActual(algorithm,key,data)
    })
    try{
      const pending=resumeExistingDevice()
      await started
      await simulateForeignPinSeal(f)
      releaseDecrypt()
      await expect(pending).rejects.toThrow('identity.device_changed')
      expect(activeSession.value).toBeNull()
      expect(identityBootstrapError.value).toBe('identity.device_changed')
    }finally{
      releaseDecrypt()
      spy.mockRestore()
    }
  },100_000)

  it('locks an online-promoted Session of the same device during in-flight IDB recheck',async()=>{
    const f=await account()
    await resumeExistingDevice()
    await simulateForeignPinSeal(f)
    const original=activeSession.value
    expect(original?.online).toBe(false)
    const checking=refreshPinSessionFence()
    // Simulate a valid online proof completing while the recheck awaits IDB.
    activeSession.value={...original!,online:true}
    expect(await checking).toBe(true)
    expect(activeSession.value).toBeNull()
    expect(pendingPinUnlock.value?.deviceId).toBe(f.scope.deviceId)
  },95_000)

  it('rechecks the saved device before signing, even if the BroadcastChannel hint was missed',async()=>{
    const f=await account()
    await resumeExistingDevice()
    await simulateForeignPinSeal(f)
    await expect(signPhotoContract('signed media'))
      .rejects.toThrow('identity.changed')
    expect(activeSession.value).toBeNull()
    expect(pendingPinUnlock.value?.deviceId).toBe(f.scope.deviceId)
  },95_000)

  it('does not lock a different active account just because some other device is sealed',async()=>{
    const f=await account()
    await resumeExistingDevice()
    const other=await account()
    await simulateForeignPinSeal(other)
    expect(await refreshPinSessionFence()).toBe(false)
    expect(activeSession.value?.pkg).toEqual(f.pkg)
    expect(pendingPinUnlock.value).toBeNull()
  },95_000)

  it('locks a PIN-unlocked tab if another tab changes its PIN ledger revision',async()=>{
    const f=await protectedAccount()
    await resumeExistingDevice()
    await unlockPinnedDevice('4826')
    expect(activeSession.value?.pkg).toEqual(f.pkg)
    await corruptDevice(f.scope.deviceId,row=>{
      const pinVerifier=row.pinVerifier as Record<string,unknown>
      row.pinVerifier={...pinVerifier,revision:crypto.randomUUID()}
    })
    expect(await refreshPinSessionFence()).toBe(true)
    expect(activeSession.value).toBeNull()
    expect(pendingPinUnlock.value?.deviceId).toBe(f.scope.deviceId)
    // The tampered verifier MAC is still rejected by actual PIN admission.
    await expect(unlockPinnedDevice('4826'))
      .rejects.toThrow('pin.integrity_failed')
  },110_000)

  it('locks on a durable signout marker while the tab was active',async()=>{
    const f=await account()
    await resumeExistingDevice()
    await markSignedOut(f.scope.accountId,f.scope.deviceId,true)
    expect(await refreshPinSessionFence()).toBe(true)
    expect(activeSession.value).toBeNull()
    expect(identityBootstrapError.value).toBe('identity.device_changed')
    expect(pendingPinUnlock.value).toBeNull()
  },65_000)

  it('Recovery Key + online proof can replace a locked PIN device, without legacy fallback',async()=>{
    const f=await protectedAccount()
    await resumeExistingDevice()
    // A stale, locally saved legacy sibling must not be auto-resumed after
    // valid Recovery Key server proof; not merely the PIN-pending device.
    const sibling=await newLocalDevice(f.scope.accountId)
    sibling.envelope=await sealDevice(f.pkg,sibling.deviceId,sibling.encryptionKey)
    await saveDevice(sibling)
    const kit=await createPB2()
    const recovery=await sealRecovery(f.pkg,kit)
    mocks.jsonApi.mockImplementation(async(url:string,_method?:string,body?:{
      payload?:Record<string,string>
    })=>{
      if(url==='/identity/v2/recovery/'+kit.locator)
        return {accountId:f.scope.accountId,accountSpki:f.pkg.accountSpki,
          revision:f.pkg.revision,envelope:recovery}
      if(url==='/identity/v2/challenges'){
        const payload=body?.payload
        if(!payload)throw Error('test.missing_payload')
        const expiresAt=new Date(Date.now()+60_000).toISOString()
        const nonce=b64(random(32))
        const digestHex=hex(await digest(new TextEncoder().encode(canonical(payload)))
        )
        const id=crypto.randomUUID()
        return {
          id,nonce,expiresAt,digest:digestHex,
          message:[
            'photobunker.identity.v2',payload.purpose,id,nonce,
            expiresAt,digestHex,
          ].join('\n'),
        }
      }
      if(url==='/identity/v2/proof'){
        const last=[...mocks.jsonApi.mock.calls].reverse().find(
          (call:unknown[])=>call[0]==='/identity/v2/challenges'
        )
        const payload=last?.[2]?.payload as Record<string,string>|undefined
        if(!payload)throw Error('test.missing_proof_payload')
        return {
          accountId:payload.accountId,deviceId:payload.deviceId,
          purpose:'recover',expiresAt:new Date(Date.now()+60_000).toISOString(),
        }
      }
      throw Error('test.unexpected_url_'+url)
    })
    const restored=await restoreAccount(kit.encoded)
    expect(restored.accountId).toBe(f.scope.accountId)
    expect(restored.deviceId).not.toBe(f.scope.deviceId)
    expect(restored.online).toBe(true)
    expect(pendingPinUnlock.value).toBeNull()
    expect(await isSignedOut(f.scope.accountId,f.scope.deviceId)).toBe(true)
    expect(await isSignedOut(f.scope.accountId,sibling.deviceId)).toBe(true)
    expect((await getDevice(f.scope.accountId,f.scope.deviceId))!.envelope)
      .toEqual(expect.objectContaining({purpose:'preunlock-package'}))
  },120_000)

  it('relocks only PIN-sealed local account synchronously without durable signout',async()=>{
    const f=await protectedAccount()
    await resumeExistingDevice()
    expect(await unlockPinnedDevice('4826')).toEqual({status:'app-unlocked'})
    const locks=navigator.locks as unknown as TestPinLockManager
    expect(locks.heldNames()).toHaveLength(1)
    expect(lockActivePinSession()).toBe(true)
    expect(activeSession.value).toBeNull()
    expect(identityBootstrapReady.value).toBe(true)
    expect(identityBootstrapError.value).toBeNull()
    expect(pendingPinUnlock.value).toEqual({
      ...f.scope,packageRevision:f.pkg.revision,
      pinLength:4,sessionNonce:expect.any(String),
    })
    expect(await isSignedOut(f.scope.accountId,f.scope.deviceId)).toBe(false)
    await vi.waitFor(()=>expect(locks.heldNames()).toHaveLength(0))
    await expect(signPhotoContract('must never sign without PIN'))
      .rejects.toThrow('identity.account_locked')
    expect(lockActivePinSession()).toBe(false)
    expect(await unlockPinnedDevice('4826')).toEqual({status:'app-unlocked'})
    expect(activeSession.value?.pkg).toEqual(f.pkg)
  },105_000)

  it('never blocks old Local-First account that has no configured PIN',async()=>{
    const f=await account()
    await resumeExistingDevice()
    expect(activeSession.value?.pkg).toEqual(f.pkg)
    expect(lockActivePinSession()).toBe(false)
    expect(activeSession.value?.pkg).toEqual(f.pkg)
    expect(pendingPinUnlock.value).toBeNull()
  },65_000)

  it('does not resurrect a PIN-locked Session after a delayed server proof',async()=>{
    await protectedAccount()
    await resumeExistingDevice()
    let rejectProof!: (reason:Error)=>void
    const proofStarted=new Promise<void>(resolve=>{
      mocks.jsonApi.mockImplementationOnce(()=>new Promise((_done,reject)=>{
        rejectProof=(reason:Error)=>reject(reason)
        resolve()
      }))
    })
    const unlocking=unlockPinnedDevice('4826')
    await proofStarted
    expect(activeSession.value?.online).toBe(false)
    expect(lockActivePinSession()).toBe(true)
    rejectProof(new Error('test.server_unreachable'))
    expect(await unlocking).toEqual({status:'app-unlocked'})
    expect(activeSession.value).toBeNull()
    expect(pendingPinUnlock.value).not.toBeNull()
  },105_000)

  it('reacts immediately to a real blur event without mounting unlocked content',async()=>{
    const fakeWindow=new EventTarget()
    const fakeDocument=Object.assign(new EventTarget(),{
      visibilityState:'visible',
    })
    vi.stubGlobal('window',fakeWindow)
    vi.stubGlobal('document',fakeDocument)
    vi.stubGlobal('BroadcastChannel',undefined)
    const f=await protectedAccount()
    await resumeExistingDevice() // installs actual lifecycle listeners
    expect(await unlockPinnedDevice('4826')).toEqual({status:'app-unlocked'})
    expect(activeSession.value?.accountId).toBe(f.scope.accountId)
    fakeWindow.dispatchEvent(new Event('blur'))
    expect(activeSession.value).toBeNull()
    expect(pendingPinUnlock.value?.deviceId).toBe(f.scope.deviceId)
    expect(await isSignedOut(f.scope.accountId,f.scope.deviceId)).toBe(false)
    fakeWindow.dispatchEvent(new Event('focus'))
    expect(activeSession.value).toBeNull()
    expect(pendingPinUnlock.value).not.toBeNull()

    // An asynchronous PIN/PBKDF2 admission started BEFORE background must
    // not activate an account when it finishes AFTER the blur event.
    const oldNonce=pendingPinUnlock.value!.sessionNonce
    const inFlight=unlockPinnedDevice('4826')
    fakeWindow.dispatchEvent(new Event('blur'))
    expect(pendingPinUnlock.value!.sessionNonce).not.toBe(oldNonce)
    await expect(inFlight).rejects.toThrow('identity.pin_session_changed')
    expect(activeSession.value).toBeNull()

    expect(await unlockPinnedDevice('4826')).toEqual({status:'app-unlocked'})
    fakeDocument.visibilityState='hidden'
    fakeDocument.dispatchEvent(new Event('visibilitychange'))
    expect(activeSession.value).toBeNull()
    expect(pendingPinUnlock.value).not.toBeNull()
    fakeDocument.visibilityState='visible'
    fakeDocument.dispatchEvent(new Event('visibilitychange'))
    expect(activeSession.value).toBeNull()

    expect(await unlockPinnedDevice('4826')).toEqual({status:'app-unlocked'})
    fakeWindow.dispatchEvent(new Event('pagehide'))
    expect(activeSession.value).toBeNull()
    expect(pendingPinUnlock.value).not.toBeNull()

    // Simulate an HMAC-authenticated future PIN preference: this is NOT
    // a user settings write path. Only the authenticated verified row can
    // supply the duration to an app-PIN-unlocked session.
    const stored=await getDevice(f.scope.accountId,f.scope.deviceId) as
      typeof f.device & {
        pinHmacKey:CryptoKey,
        pinVerifier:import('../../security/application/pin-verifier').StoredPinState,
      }
    const configured=await prepareVerifiedPinRelockPolicy(
      f.scope,stored.pinHmacKey,stored.pinVerifier,120_000,
    )
    await saveDevice({...stored,pinVerifier:configured})
    expect(await unlockPinnedDevice('4826')).toEqual({status:'app-unlocked'})
    expect(activeSession.value?.pkg).toEqual(f.pkg)

    vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']})
    const freshStart=Date.now()
    vi.setSystemTime(freshStart)
    fakeWindow.dispatchEvent(new Event('blur'))
    expect(activeSession.value?.pkg).toEqual(f.pkg)
    vi.advanceTimersByTime(119_000)
    fakeWindow.dispatchEvent(new Event('focus'))
    // A short background stay must cancel the queued lock; foreground
    // timing is verified again even if the browser throttled all timers.
    expect(activeSession.value?.pkg).toEqual(f.pkg)
    vi.advanceTimersByTime(3_000)
    expect(activeSession.value?.pkg).toEqual(f.pkg)
    fakeWindow.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(120_000)
    expect(activeSession.value).toBeNull()
    expect(pendingPinUnlock.value?.deviceId).toBe(f.scope.deviceId)
    vi.useRealTimers()
  },145_000)

})
