import { shallowRef, watch } from 'vue'
import type { PinAttempt } from '../../security/application/pin-verifier'
import type { SealedPinDevice } from '../../security/application/pin-device-migration'
import {watchPinDeviceSealed} from '../../security/application/pin-tab-fence'
import {acquirePinSessionLease} from '../../security/application/pin-session-lease'
import type {PinSessionLease} from '../../security/application/pin-session-lease'
import { jsonApi, resetCsrf } from '../infrastructure/api'
import {
  b64, canonical, createPB2, digest, freshPackage, hex,
  importSigner, openDevice, openRecovery, parsePB2, random, sealDevice, sealRecovery,
  sign, uuid, verifyChallenge,
} from '../infrastructure/crypto'
import type { PackageV2, Challenge, RecoveryEnvelope } from '../infrastructure/crypto'
import {
  dropPending, dropRecoveryPending, getPending, getRecoveryPending,
  getDevice, listDevices, newLocalDevice, probeCapabilities, putPending, reservePending,
  saveDevice, saveRecoveryPending, isSignedOut, markSignedOut,
} from '../infrastructure/storage'
import type { LocalDevice } from '../infrastructure/storage'

export interface Session {
  readonly accountId: string
  readonly deviceId: string
  readonly device: LocalDevice
  readonly pkg: PackageV2
  readonly online: boolean
}

export const activeSession = shallowRef<Session | null>(null)

/**
 * A cooperating same-origin tab holds a browser SHARED lock for as long as
 * it can expose PackageV2. PIN migration needs EXCLUSIVE Web Lock and MUST
 * refuse while any such tab has a live lease.
 *
 * Older tabs/workers/copied keys are NOT covered. This is not a revocation
 * or proof of all-device quiescence.
 */
let activeDeviceLease:PinSessionLease|null=null
function sameDeviceLease(
  lease:PinSessionLease,
  device:Readonly<{accountId:string;deviceId:string}>,
):boolean{
  return lease.scope.accountId===device.accountId &&
    lease.scope.deviceId===device.deviceId
}
function releaseDeviceLease():void{
  activeDeviceLease?.release()
  activeDeviceLease=null
}
watch(activeSession,next=>{
  if(activeDeviceLease && (!next||!sameDeviceLease(activeDeviceLease,next)))
    releaseDeviceLease()
},{flush:'sync'})
let acquiringDeviceLease:{
  device:Readonly<{accountId:string;deviceId:string}>
  task:Promise<void>
}|null=null
async function ensureDeviceLease(
  device:Readonly<{accountId:string;deviceId:string}>,
):Promise<void>{
  if(activeDeviceLease&&sameDeviceLease(activeDeviceLease,device))return
  // Two overlapping local starts for the same device MUST share one SHARED
  // lock rather than leak an untracked second lock after one is replaced.
  if(acquiringDeviceLease){
    const pending=acquiringDeviceLease
    if(pending.device.accountId!==device.accountId||
       pending.device.deviceId!==device.deviceId)
      throw new Error('identity.concurrent_device_activation')
    return pending.task
  }
  let task!:Promise<void>
  task=(async()=>{
    const acquired=await acquirePinSessionLease(device)
    if(activeDeviceLease&&!sameDeviceLease(activeDeviceLease,device))
      releaseDeviceLease()
    activeDeviceLease=acquired
  })().finally(()=>{
    if(acquiringDeviceLease?.task===task)acquiringDeviceLease=null
  })
  acquiringDeviceLease={device:{...device},task}
  return task
}


/** In-memory discovery only: NEVER contains a decrypted package or PIN. */
export type PendingPinUnlock = Readonly<{
  accountId:string
  deviceId:string
  packageRevision:number
  sessionNonce:string
  pinLength:number
}>
export const pendingPinUnlock = shallowRef<PendingPinUnlock|null>(null)
export const identityBootstrapReady = shallowRef(false)
/** Fail closed if a saved Identity row is corrupt or mixed with a legacy copy. */
export const identityBootstrapError = shallowRef<string|null>(null)

export function requireSession(): Session {
  const state = activeSession.value
  if (!state) throw new Error('identity.account_locked')
  return state
}

interface Registered { accountId:string; deviceId:string; expiresAt:string; purpose:string }

async function prove(
  purpose: string,
  payload: Record<string,string>,
  signer: CryptoKey,
  deviceSigner?: CryptoKey,
  envelope: RecoveryEnvelope | null = null,
): Promise<Registered> {
  const challenge = await jsonApi<Challenge>('/identity/v2/challenges','POST',{payload})
  await verifyChallenge(challenge,purpose,payload)
  const [signature,deviceSignature] = await Promise.all([
    sign(signer,challenge.message),
    deviceSigner ? sign(deviceSigner,challenge.message) : Promise.resolve(''),
  ])
  const authenticated=await jsonApi<Registered>('/identity/v2/proof','POST',{
    challengeId:challenge.id,signature,deviceSignature,envelope,
  })
  if (authenticated.accountId !== payload.accountId || authenticated.deviceId !== payload.deviceId)
    throw new Error('identity.session_mismatch')
  resetCsrf() // Session regeneration rotates the CSRF token.
  return authenticated
}

function activate(pkg:PackageV2, device:LocalDevice, online:boolean):Session {
  const s:Session={accountId:pkg.accountId,deviceId:device.deviceId,device,pkg,online}
  activeSession.value=s
  return s
}

export async function beginRegistration():Promise<string> {
  if(pendingPinUnlock.value)throw new Error('identity.pin_locked')
  await probeCapabilities()
  if (await getPending()) throw new Error('identity.pending_requires_original_key')
  const kit=await createPB2(), device=await newLocalDevice('')
  await reservePending({
    operationId:uuid(),reservationProof:b64(random(32)),kitLocator:kit.locator,
    deviceId:device.deviceId,deviceKey:device.deviceKey,deviceSpki:device.deviceSpki,
    encryptionKey:device.encryptionKey,
  })
  // Only the caller holds this string in volatile UI state. Never persist it.
  return kit.encoded
}

export async function finishRegistration(recoveryKey:string):Promise<Session> {
  if(pendingPinUnlock.value)throw new Error('identity.pin_locked')
  await probeCapabilities()
  const kit=await parsePB2(recoveryKey), pending=await getPending()
  if (!pending || kit.locator!==pending.kitLocator) throw new Error('identity.pending_key_mismatch')
  const reservation=await jsonApi<{accountId:string;status:string}>('/identity/v2/prepare','POST',{
    operationId:pending.operationId,reservationProof:pending.reservationProof,
  })
  let pkg:PackageV2
  let envelope=pending.envelope
  if (envelope) {
    if(pending.accountId!==reservation.accountId) throw new Error('identity.registration_conflict')
    pkg=await openDevice(envelope,pending.encryptionKey,reservation.accountId,pending.deviceId)
  } else {
    pkg=(await freshPackage(reservation.accountId)).pkg
    envelope=await sealDevice(pkg,pending.deviceId,pending.encryptionKey)
    await putPending({...pending,accountId:reservation.accountId,envelope})
  }
  const device:LocalDevice={
    accountId:reservation.accountId,deviceId:pending.deviceId,
    deviceKey:pending.deviceKey,deviceSpki:pending.deviceSpki,
    encryptionKey:pending.encryptionKey,envelope,
  }
  if (reservation.status==='ready') {
    await prove('login',{accountId:device.accountId,deviceId:device.deviceId,purpose:'login'},device.deviceKey)
  } else {
    const recovery=await sealRecovery(pkg,kit)
    const payload={
      accountId:reservation.accountId,accountSpki:pkg.accountSpki,
      deviceId:device.deviceId,deviceSpki:device.deviceSpki,
      envelopeHash:hex(await digest(new TextEncoder().encode(
        canonical(recovery as unknown as Record<string,unknown>)))),
      locator:kit.locator,operationId:pending.operationId,purpose:'register',
    }
    await prove('register',payload,await importSigner(pkg.accountPkcs8),device.deviceKey,recovery)
  }
  await saveDevice(device)
  await dropPending(pending.operationId)
  await markSignedOut(device.accountId,device.deviceId,false)
  identityBootstrapError.value=null
  identityBootstrapReady.value=true
  await ensureDeviceLease(device)
  return activate(pkg,device,true)
}

export async function restoreAccount(recoveryKey:string):Promise<Session> {
  await probeCapabilities()
  const kit=await parsePB2(recoveryKey)
  const row=await jsonApi<{accountId:string;accountSpki:string;revision:number;envelope:unknown}>(
    '/identity/v2/recovery/'+kit.locator)
  const pkg=await openRecovery(row.envelope,kit,row.accountId)
  if(pkg.accountSpki!==row.accountSpki||pkg.revision!==row.revision)
    throw new Error('identity.recovery_mismatch')

  const pending=await getRecoveryPending(kit.locator)
  if (pending && pending.device.accountId!==row.accountId) throw new Error('identity.recovery_conflict')
  const device=pending?.device ?? await newLocalDevice(row.accountId)
  if (!pending) {
    device.envelope=await sealDevice(pkg,device.deviceId,device.encryptionKey)
    await saveRecoveryPending({locator:kit.locator,device})
  }
  await openDevice(device.envelope,device.encryptionKey,row.accountId,device.deviceId)
  const payload={
    accountId:row.accountId,deviceId:device.deviceId,deviceSpki:device.deviceSpki,
    purpose:'recover',revision:String(row.revision),
  }
  await prove('recover',payload,await importSigner(pkg.accountPkcs8),device.deviceKey)
  await saveDevice(device)
  await dropRecoveryPending(kit.locator)
  // The Recovery Key plus successful server proof is the *only* accepted
  // alternate to a corrupt/lost PIN device. Sign out all old saved devices
  // for this recovered account, including malformed sealed rows that could
  // not publish pendingPinUnlock, BEFORE allowing the new device to auto-resume.
  // These are local signed-out markers, not server revocation or key erasure.
  const previous=pendingPinUnlock.value
  const localDevices=await listDevices()
  for(const former of localDevices){
    if(former.deviceId!==device.deviceId &&
       (former.accountId===device.accountId ||
        former.deviceId===previous?.deviceId))
      await markSignedOut(former.accountId,former.deviceId,true)
  }
  await markSignedOut(device.accountId,device.deviceId,false)
  pendingPinUnlock.value=null
  identityBootstrapError.value=null
  identityBootstrapReady.value=true
  await ensureDeviceLease(device)
  return activate(pkg,device,true)
}

let pendingSessionResume:Promise<Session|null>|null=null
export function resumeExistingDevice():Promise<Session|null> {
  installPinTabReconciliation()
  if (pendingSessionResume) return pendingSessionResume
  pendingSessionResume=resumeLocalDevice().catch(error=>{
    identityBootstrapError.value=error instanceof Error?error.message:
      'identity.storage_unavailable'
    throw error
  }).finally(()=>{
    pendingSessionResume=null
    identityBootstrapReady.value=true
  })
  return pendingSessionResume
}
function isSealedCandidate(row:LocalDevice):boolean {
  const mode=(row as unknown as Partial<SealedPinDevice>).pinMode
  const purpose=(row.envelope as {purpose?:unknown}|undefined)?.purpose
  return mode!==undefined || purpose==='preunlock-package'
}

/**
 * Recognize a sealed row BEFORE legacy openDevice can unwrap any account key.
 * Invalid or mixed legacy/sealed copies of the same account fail closed.
 */
function pendingPinContext(row:LocalDevice):PendingPinUnlock {
  const sealed=row as unknown as SealedPinDevice
  if(sealed.pinMode!=='pin-v1' ||
     sealed.envelope?.purpose!=='preunlock-package' ||
     sealed.envelope.accountId!==row.accountId ||
     sealed.envelope.deviceId!==row.deviceId ||
     !Number.isSafeInteger(sealed.envelope.packageRevision)||
     sealed.envelope.packageRevision<1 ||
     !Number.isInteger(sealed.pinLength) ||
     sealed.pinLength<4 || sealed.pinLength>8 ||
     sealed.pinVerifier?.accountId!==row.accountId ||
     sealed.pinVerifier?.deviceId!==row.deviceId)
    throw new Error('identity.invalid_sealed_device')
  return Object.freeze({
    accountId:row.accountId,
    deviceId:row.deviceId,
    packageRevision:sealed.envelope.packageRevision,
    pinLength:sealed.pinLength,
    sessionNonce:crypto.randomUUID(),
  })
}


/**
 * Reconcile ONLY already-active sessions with a persisted IDB identity row.
 * An incoming BroadcastChannel message is an UNTRUSTED hint, not a grant
 * or revocation proof. On a mismatch, lock the UI before another operation
 * can use requireSession(). This cannot zero copied keys in other contexts.
 */
export async function refreshPinSessionFence():Promise<boolean>{
  const before=activeSession.value
  if(!before)return false
  let stored:LocalDevice|undefined
  let signedOut:boolean
  try{
    [stored,signedOut]=await Promise.all([
      getDevice(before.accountId,before.deviceId),
      isSignedOut(before.accountId,before.deviceId),
    ])
  }catch{
    const now=activeSession.value
    if(!now||now.accountId!==before.accountId||
       now.deviceId!==before.deviceId)return false
    activeSession.value=null
    pendingPinUnlock.value=null
    identityBootstrapError.value='identity.storage_unavailable'
    resetCsrf()
    return true
  }
  // Online proof may have promoted this SAME device to a new Session
  // object while the IndexedDB read was pending. Do not skip revocation
  // merely because Session object identity changed (offline -> online).
  const current=activeSession.value
  if(!current||current.accountId!==before.accountId||
     current.deviceId!==before.deviceId)return false
  const hadPin=isSealedCandidate(current.device)
  const hasPin=stored!==undefined && isSealedCandidate(stored)
  const oldRev=hadPin
    ?(current.device as unknown as SealedPinDevice).pinVerifier?.revision:null
  const newRev=hasPin
    ?(stored as unknown as SealedPinDevice).pinVerifier?.revision:null
  if(!signedOut && stored &&
     (hadPin===hasPin && (!hadPin||oldRev===newRev)))
    return false

  activeSession.value=null
  resetCsrf()
  pendingPinUnlock.value=null
  if(hasPin && stored && !signedOut){
    try{
      pendingPinUnlock.value=pendingPinContext(stored)
      identityBootstrapError.value=null
    }catch{
      identityBootstrapError.value='identity.invalid_sealed_device'
    }
  }else{
    identityBootstrapError.value='identity.device_changed'
  }
  identityBootstrapReady.value=true
  return true
}

let pinTabWatchInstalled=false
function installPinTabReconciliation():void {
  if(pinTabWatchInstalled || typeof window==='undefined')return
  pinTabWatchInstalled=true
  // BroadcastChannel has no trusted sender. It *only* triggers a persisted
  // row check, and an unrelated account never sees its content or keys.
  watchPinDeviceSealed(notice=>{
    const active=activeSession.value
    if(active?.accountId===notice.accountId &&
       active.deviceId===notice.deviceId)
      void refreshPinSessionFence()
  })
  // A suspended tab may MISS messages entirely. At least ensure it
  // validates the IDB row as it returns to foreground.
  const onFocus=()=>{void refreshPinSessionFence()}
  window.addEventListener('focus',onFocus)
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')onFocus()
  })
}

async function resumeLocalDevice():Promise<Session|null> {
  if(activeSession.value)return activeSession.value
  await probeCapabilities()
  const devices=await listDevices()
  let saved:LocalDevice|undefined
  for(const candidate of devices){
    if(!(await isSignedOut(candidate.accountId,candidate.deviceId))){
      saved=candidate
      break
    }
  }
  if(!saved){pendingPinUnlock.value=null;identityBootstrapError.value=null;return null}
  if(isSealedCandidate(saved)){
    if(devices.some(other=>other.deviceId!==saved.deviceId &&
      other.accountId===saved.accountId))
      throw new Error('identity.mixed_sealed_devices')
    pendingPinUnlock.value=pendingPinContext(saved)
    identityBootstrapError.value=null
    return null
  }
  if(devices.some(other=>other.accountId===saved.accountId &&
      other.deviceId!==saved.deviceId && isSealedCandidate(other)))
    throw new Error('identity.mixed_sealed_devices')
  // Do not even open the legacy DeviceEnvelope until this tab holds
  // a SHARED Web Lock. An exclusive migration in a different tab must
  // finish before we can publish/capture the old PackageV2.
  await ensureDeviceLease(saved)
  let activated=false
  try {
  const pkg=await openDevice(saved.envelope,saved.encryptionKey,saved.accountId,saved.deviceId)
  // A second tab may have sealed/replaced this device WHILE our legacy
  // AES-GCM decrypt was in progress. Never activate a stale DB snapshot.
  // The verified IDB row must still be the same unsealed revision, and this
  // device must still be locally authorized. No async gap after this fence
  // before activate() publishes a Session.
  const latest=await getDevice(saved.accountId,saved.deviceId)
  if(!latest || isSealedCandidate(latest) ||
     latest.deviceSpki!==saved.deviceSpki ||
     canonical(latest.envelope as unknown as Record<string,unknown>) !==
       canonical(saved.envelope as unknown as Record<string,unknown>) ||
     await isSignedOut(saved.accountId,saved.deviceId))
    throw new Error('identity.device_changed')
  if(activeSession.value)return activeSession.value
  // Unprotected legacy devices preserve their prior behavior.
  pendingPinUnlock.value=null
  const local=activate(pkg,saved,false)
  activated=true
  // Local-First: cached content is available as soon as the local envelope
  // has been opened, not after a potentially stalled offline server proof.
  // PIN-protected rows NEVER reach this legacy path.
  identityBootstrapReady.value=true
  try {
    await prove('login',{accountId:saved.accountId,deviceId:saved.deviceId,purpose:'login'},saved.deviceKey)
    if (activeSession.value===local) activate(pkg,saved,true)
  } catch {
    // Offline or revoked: only locally available encrypted media remains.
  }
  return activeSession.value
  }finally{
    if(!activated && activeSession.value===null)releaseDeviceLease()
  }
}

let pendingPinAttempt:Promise<PinAttempt>|null=null

/**
 * PIN-verified LOCAL unlock on a stored sealed device. A successful result
 * must commit the HMAC ledger CAS and validate the exact receipt before the
 * AES-GCM package is decrypted. Emergency PIN never activates a session.
 * This is not a remote revocation or secure-clock guarantee.
 */
export function unlockPinnedDevice(candidate:string):Promise<PinAttempt> {
  if(pendingPinAttempt)return pendingPinAttempt
  pendingPinAttempt=unlockPinnedDeviceInternal(candidate).finally(()=>{
    pendingPinAttempt=null
  })
  return pendingPinAttempt
}
async function unlockPinnedDeviceInternal(candidate:string):Promise<PinAttempt> {
  const context=pendingPinUnlock.value
  if(!context||activeSession.value)
    throw new Error('identity.pin_not_required')
  const scope={accountId:context.accountId,deviceId:context.deviceId}
  const {admitCoLocatedPinDevice}=await import(
    '../../security/application/pin-device-admission'
  )
  if(pendingPinUnlock.value!==context)
    throw new Error('identity.pin_session_changed')
  const attempt=await admitCoLocatedPinDevice({
    scope,candidate,
    readTrustedContext:()=>{
      return pendingPinUnlock.value===context?{
        accountId:context.accountId,deviceId:context.deviceId,
        packageRevision:context.packageRevision,
        sessionNonce:context.sessionNonce,
      }:null
    },
  })
  if(attempt.status!=='unlocked')return attempt
  if(pendingPinUnlock.value!==context||activeSession.value)
    throw new Error('identity.pin_session_changed')
  const device=await getDevice(scope.accountId,scope.deviceId)
  if(!device||!isSealedCandidate(device)||
     (device as unknown as SealedPinDevice).pinMode!=='pin-v1' ||
     await isSignedOut(scope.accountId,scope.deviceId)||
     pendingPinUnlock.value!==context||activeSession.value)
    throw new Error('identity.pin_device_changed')
  // Do not publish the decrypted PackageV2 until our tab holds its
  // SHARED device lifetime lease. A stale row change is still checked by
  // the existing preunlock HMAC receipt and IDB scope/revision guards.
  await ensureDeviceLease(device)
  if(pendingPinUnlock.value!==context || activeSession.value){
    releaseDeviceLease()
    throw new Error('identity.pin_session_changed')
  }
  // Keep sealed envelope: never generate/write a legacy device-only fallback.
  pendingPinUnlock.value=null
  identityBootstrapError.value=null
  const local=activate(attempt.pkg,device,false)
  try{
    await prove('login',{
      accountId:scope.accountId,deviceId:scope.deviceId,purpose:'login',
    },device.deviceKey)
    if(activeSession.value===local)activate(attempt.pkg,device,true)
  }catch{
    // Local-First offline access after correct PIN, NOT a remote auth claim.
  }
  return {status:'app-unlocked'}
}

export async function reauthenticate():Promise<Session> {
  // Do not race a second login/proof against the automatic session bootstrap:
  // either proof can rotate the cookie/CSRF state while an S3 PUT is in flight.
  if(pendingSessionResume) await pendingSessionResume
  const before=requireSession()
  await refreshPinSessionFence()
  if(activeSession.value!==before)throw new Error('identity.changed')
  const state=requireSession()
  if(state.online) return state
  await prove('login',{accountId:state.accountId,deviceId:state.deviceId,purpose:'login'},state.device.deviceKey)
  if(activeSession.value!==state)throw new Error('identity.changed')
  return activate(state.pkg,state.device,true)
}

export async function signPhotoContract(json:string):Promise<string> {
  const before=requireSession()
  await refreshPinSessionFence()
  if(activeSession.value!==before)throw new Error('identity.changed')
  const current=requireSession()
  if(!current.online) throw new Error('identity.offline')
  const signature=await sign(current.device.deviceKey,'photobunker.photo-sync.v1\n'+json)
  if(activeSession.value!==current) throw new Error('identity.changed')
  return signature
}

export async function logout():Promise<void> {
  const state=activeSession.value
  activeSession.value=null
  if(state){
    await markSignedOut(state.accountId,state.deviceId,true)
    if(state.online) {
      try { await jsonApi('/identity/v2/logout','POST',{}) } catch { /* local sign-out still succeeds */ }
    }
  }
  resetCsrf()
}
