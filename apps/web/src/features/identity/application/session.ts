import { shallowRef } from 'vue'
import type { PinAttempt } from '../../security/application/pin-verifier'
import type { SealedPinDevice } from '../../security/application/pin-device-migration'
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
  await markSignedOut(device.accountId,device.deviceId,false)
  // Successful Recovery Key + server 'recover' proof permits switching from
  // a PIN-locked local device. Sign it out, never restore device-only access.
  const previous=pendingPinUnlock.value
  if(previous && previous.deviceId!==device.deviceId)
    await markSignedOut(previous.accountId,previous.deviceId,true)
  pendingPinUnlock.value=null
  identityBootstrapError.value=null
  identityBootstrapReady.value=true
  return activate(pkg,device,true)
}

let pendingSessionResume:Promise<Session|null>|null=null
export function resumeExistingDevice():Promise<Session|null> {
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
  const mode=(row as Partial<SealedPinDevice>).pinMode
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
  const pkg=await openDevice(saved.envelope,saved.encryptionKey,saved.accountId,saved.deviceId)
  if(activeSession.value)return activeSession.value
  // Unprotected legacy devices preserve their prior behavior.
  pendingPinUnlock.value=null
  const local=activate(pkg,saved,false)
  try {
    await prove('login',{accountId:saved.accountId,deviceId:saved.deviceId,purpose:'login'},saved.deviceKey)
    if (activeSession.value===local) activate(pkg,saved,true)
  } catch {
    // Offline or revoked: only locally available encrypted media remains.
  }
  return activeSession.value
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
  const state=requireSession()
  if(state.online) return state
  await prove('login',{accountId:state.accountId,deviceId:state.deviceId,purpose:'login'},state.device.deviceKey)
  return activate(state.pkg,state.device,true)
}

export async function signPhotoContract(json:string):Promise<string> {
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
