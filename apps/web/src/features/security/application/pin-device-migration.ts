import { activeSession } from '../../identity/application/session'
import {
  canonical, importSpki, openDevice, sign, verify,
} from '../../identity/infrastructure/crypto'
import type { PackageV2, DeviceEnvelope } from '../../identity/infrastructure/crypto'
import { openIdentityDB } from '../../identity/infrastructure/storage'
import type { LocalDevice } from '../../identity/infrastructure/storage'
import { buildPinVerifierSnapshot, evaluatePinVerifierSnapshot } from './pin-verifier'
import type { PinAttempt, PinScope, StoredPinState } from './pin-verifier'
import { openPinProtectedPackage, sealPinProtectedPackage } from './pin-sealed-package'
import type { PinSealedPackage } from './pin-sealed-package'
import { publishPinDeviceSealed } from './pin-tab-fence'

/**
 * PREINTEGRATION / NOT CALLED BY PRODUCT.
 *
 * This replaces a legacy envelope and inserts its HMAC PIN verifier in ONE
 * identity-v2 devices row / transaction. No cross-database two-phase commit
 * and no verifier-only orphan are possible in this new PIN device mode.
 * Do NOT expose this operation as "PIN on" in the live app before trusted
 * cross-tab bootstrap, key custody and Recovery Key acceptance are audited.
 */
export type SealedPinDevice = Omit<LocalDevice,'envelope'> & {
  envelope:PinSealedPackage
  pinMode:'pin-v1'
  pinLength:number
  pinHmacKey:CryptoKey
  pinVerifier:StoredPinState
}

type DeviceRow = LocalDevice | SealedPinDevice
type MigrationRows = {
  devices:DeviceRow[]
  pending:Record<string,unknown>[]
  recoveries:Array<{device?:{accountId?:string;deviceId?:string}}>
  pairings:Array<{accountId?:string;device?:{accountId?:string;deviceId?:string}}>
  rotations:Array<{accountId?:string;deviceId?:string}>
  sessions:Array<{accountId?:string;deviceId?:string;signedOut?:boolean}>
}
const STORES=['devices','pending','recoveries','pairings','rotations','sessions'] as const

function validScope(scope:PinScope):void {
  if(!scope || !/^[A-Za-z0-9-]{8,64}$/.test(scope.accountId) ||
     !/^[A-Za-z0-9-]{8,64}$/.test(scope.deviceId)) throw new Error('pin.invalid_scope')
}
function isLegacy(row:DeviceRow|undefined):row is LocalDevice {
  if(!row || (row as Partial<SealedPinDevice>).pinMode !== undefined) return false
  const envelope=row.envelope as DeviceEnvelope
  return envelope?.v===2 && envelope.alg==='A256GCM' &&
    envelope.purpose==='device' && envelope.accountId===row.accountId &&
    envelope.deviceId===row.deviceId
}
function isSealed(row:DeviceRow|undefined):row is SealedPinDevice {
  return Boolean(row && (row as SealedPinDevice).pinMode==='pin-v1')
}
function validateNoFallback(rows:MigrationRows,scope:PinScope):LocalDevice {
  const row=rows.devices.find(x=>x.deviceId===scope.deviceId)
  if(!isLegacy(row)||row.accountId!==scope.accountId)
    throw new Error('pin.no_legacy_device')
  if(rows.devices.some(x=>x !== row && x.accountId===scope.accountId))
    throw new Error('pin.other_local_device')
  // Pending rows may retain device envelopes or a pre-registration package.
  // Their owner is not always populated. Deny ANY unfinished registration.
  if(rows.pending.length ||
     rows.recoveries.some(x=>x.device?.accountId===scope.accountId ||
       x.device?.deviceId===scope.deviceId) ||
     rows.pairings.some(x=>x.accountId===scope.accountId ||
       x.device?.accountId===scope.accountId ||
       x.device?.deviceId===scope.deviceId) ||
     rows.rotations.some(x=>x.accountId===scope.accountId ||
       x.deviceId===scope.deviceId) ||
     rows.sessions.some(x=>x.deviceId===scope.deviceId &&
       x.accountId===scope.accountId && x.signedOut===true))
    throw new Error('pin.legacy_pending_state')
  return row
}
function sameSource(a:LocalDevice,b:LocalDevice):boolean {
  return a.accountId===b.accountId &&
    a.deviceId===b.deviceId &&
    a.deviceSpki===b.deviceSpki &&
    canonical(a.envelope as unknown as Record<string,unknown>)===
    canonical(b.envelope as unknown as Record<string,unknown>)
}

function txDone(tx:IDBTransaction):Promise<void>{
  return new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve()
    tx.onabort=()=>reject(tx.error??new Error('pin.device_storage_aborted'))
    tx.onerror=()=>{ /* onabort delivers the transactional error once */ }
  })
}
function req<T>(request:IDBRequest<T>):Promise<T>{
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error??new Error('pin.device_storage_error'))
  })
}
async function readRows():Promise<MigrationRows>{
  const db=await openIdentityDB()
  try{
    const tx=db.transaction([...STORES],'readonly')
    const done=txDone(tx)
    const entries=await Promise.all(STORES.map(
      store=>req(tx.objectStore(store).getAll()),
    ))
    await done
    return Object.fromEntries(STORES.map((key,i)=>[key,entries[i]])) as MigrationRows
  }finally{db.close()}
}
function denyIfLive():void{
  if(activeSession.value!==null)throw new Error('pin.live_session_must_be_closed')
}
async function validateLegacyDevice(
  row:LocalDevice,expected:PackageV2,scope:PinScope,
):Promise<void>{
  if(row.accountId!==scope.accountId||row.deviceId!==scope.deviceId)
    throw new Error('pin.identity_mismatch')
  if(row.deviceKey.extractable || row.encryptionKey.extractable)
    throw new Error('pin.invalid_device_keys')
  const probe='PB3/PIN/migrate-device/v1/'+scope.accountId+'/'+scope.deviceId
  const publicKey=await importSpki(row.deviceSpki)
  if(!await verify(publicKey,probe,await sign(row.deviceKey,probe)))
    throw new Error('pin.invalid_device_keys')
  const opened=await openDevice(
    row.envelope,row.encryptionKey,scope.accountId,scope.deviceId,
  )
  if(canonical(opened as unknown as Record<string,unknown>)!==
     canonical(expected as unknown as Record<string,unknown>))
    throw new Error('pin.package_mismatch')
}

function transactionalReplace(
  scope:PinScope,source:LocalDevice,encrypted:PinSealedPackage,hmac:CryptoKey,
  verifier:StoredPinState,pinLength:number,
):Promise<void>{
  return openIdentityDB().then(db=>new Promise<void>((resolve,reject)=>{
    let tx:IDBTransaction
    try{
      tx=db.transaction([...STORES],'readwrite')
    }catch(err){db.close();reject(err);return}
    let cause:Error|null=null
    const requests=STORES.map(store=>tx.objectStore(store).getAll())
    let pending=requests.length
    const results:unknown[][]=[]
    requests.forEach((request,i)=>{
      request.onsuccess=()=>{
        results[i]=request.result as unknown[]
        if(--pending!==0)return
        try{
          const rows=Object.fromEntries(STORES.map(
            (key,j)=>[key,results[j]],
          )) as MigrationRows
          const still=validateNoFallback(rows,scope)
          if(!sameSource(still,source) || isSealed(still as DeviceRow))
            throw new Error('pin.device_concurrent_change')
          if(activeSession.value!==null)
            throw new Error('pin.live_session_must_be_closed')
          // The only write in this transaction. No residual old v2 envelope.
          const sealed:SealedPinDevice={
            ...still,envelope:encrypted,pinMode:'pin-v1',pinLength:pinLength,
            pinHmacKey:hmac,pinVerifier:verifier,
          }
          tx.objectStore('devices').put(sealed)
        }catch(err){
          cause=err instanceof Error?err:new Error('pin.device_storage_error')
          tx.abort()
        }
      }
      request.onerror=()=>{cause=new Error('pin.device_storage_error')}
    })
    tx.oncomplete=()=>{db.close();resolve()}
    tx.onabort=()=>{db.close();reject(cause??tx.error??new Error('pin.device_storage_aborted'))}
    tx.onerror=()=>{ /* abort handles the complete error */ }
  }))
}

/**
 * Security preflight of actual local identity-v2 persisted state. Read-only;
 * returns NO account package and never activates a session.
 *
 * This does NOT prove Recovery Key possession, server challenge completion or
 * user consent: the future caller must establish these outside the migration.
 */
export async function inspectPinDeviceMigration(scope:PinScope):Promise<void>{
  validScope(scope)
  denyIfLive()
  validateNoFallback(await readRows(),scope)
}

/**
 * UNUSED preintegration transaction, for disposable-device acceptance tests.
 * Requires a separately reauthenticated caller holding exact expected account
 * package and a Recovery Key recovery path; it must NEVER be called merely
 * because a user typed a PIN in the UI.
 *
 * Verifier and PIN ciphertext commit in ONE devices row; a crash before
 * transaction commit leaves the complete original legacy envelope intact.
 * This does NOT prove it is safe to activate for a real user: old tabs may
 * retain a decrypted session and origin JS can access nonextractable keys.
 */
export async function migrateLegacyLocalDeviceToPin(input:{
  scope:PinScope
  verifiedPackage:PackageV2
  appPin:string
  emergencyPin:string|null
}):Promise<void>{
  const {scope,verifiedPackage:pkg,appPin,emergencyPin}=input
  validScope(scope)
  denyIfLive()
  const initial=validateNoFallback(await readRows(),scope)
  await validateLegacyDevice(initial,pkg,scope)
  denyIfLive()

  // Crypto material is generated without holding an IDB transaction open.
  const secret=await crypto.subtle.generateKey(
    {name:'HMAC',hash:'SHA-256',length:256},false,['sign'],
  )
  const encrypted=await sealPinProtectedPackage(
    pkg,scope,appPin,initial.encryptionKey,
  )
  const reopened=await openPinProtectedPackage(
    encrypted,scope,appPin,initial.encryptionKey,pkg.revision,
  )
  if(canonical(reopened as unknown as Record<string,unknown>)!==
    canonical(pkg as unknown as Record<string,unknown>))
    throw new Error('pin.package_mismatch')
  denyIfLive()
  // In-memory HMAC state and ciphertext are prepared before touching IDB.
  // A single transaction commits both or neither; no separate PIN DB write.
  const verifier=await buildPinVerifierSnapshot(
    scope,secret,appPin,emergencyPin,
  )
  const evaluated=await evaluatePinVerifierSnapshot(
    scope,secret,appPin,verifier,
  )
  if(evaluated.result.status!=='app-unlocked' || !evaluated.next)
    throw new Error('pin.verifier_unavailable')
  denyIfLive()
  await transactionalReplace(scope,initial,encrypted,secret,verifier,appPin.length)
  // This is a best-effort wakeup for active other tabs, not acknowledgement
  // or proof of revocation. The atomic persisted row is authoritative.
  publishPinDeviceSealed(scope)
}

/**
 * Read protected mode metadata for a future PIN Shell, with no package
 * decryption and no direct session activation.
 */
export async function readSealedPinDevice(scope:PinScope):Promise<{
  encrypted:PinSealedPackage
  verifierDeviceHmac:CryptoKey
  envelopeDeviceAes:CryptoKey
  pinLength:number
}|null>{
  validScope(scope)
  const rows=await readRows()
  const row=rows.devices.find(x=>x.deviceId===scope.deviceId)
  if(!row)return null
  if(row.accountId!==scope.accountId)
    throw new Error('pin.identity_mismatch')
  if(!isSealed(row))return null
  if(row.envelope.accountId!==scope.accountId ||
     row.envelope.deviceId!==scope.deviceId ||
     row.pinHmacKey?.extractable!==false ||
     row.encryptionKey?.extractable!==false ||
     !row.pinVerifier || row.pinVerifier.accountId!==scope.accountId ||
     row.pinVerifier.deviceId!==scope.deviceId ||
     !Number.isInteger(row.pinLength) || row.pinLength<4 || row.pinLength>8)
    throw new Error('pin.corrupt_sealed_device')
  return {
    encrypted:row.envelope,verifierDeviceHmac:row.pinHmacKey,
    envelopeDeviceAes:row.encryptionKey,pinLength:row.pinLength,
  }
}


/**
 * Authenticated local PIN attempt on a PIN-sealed device. Verifier + lockout
 * are read and CAS-updated in the SAME identity-v2 devices row, including the
 * encrypted package. No second PIN database is used. All PBKDF2/HMAC happens
 * OUTSIDE the short IndexedDB transaction.
 *
 * Returns a receipt revision only when a successful app PIN was recorded.
 * The caller must validate that exact revision before AND after decrypting
 * and require an independently trusted session fence.
 */
export async function attemptSealedPinDevice(
  scope:PinScope,candidate:string,
):Promise<{result:PinAttempt; receiptRevision:string|null}>{
  validScope(scope)
  const MAX_RETRIES=12
  for(let retry=0;retry<MAX_RETRIES;retry++){
    const rows=await readRows()
    const snapshot=rows.devices.find(x=>x.deviceId===scope.deviceId)
    if(!isSealed(snapshot)||snapshot.accountId!==scope.accountId)
      throw new Error('pin.sealed_device_unavailable')
    if(!snapshot.pinVerifier || !snapshot.pinHmacKey)
      throw new Error('pin.corrupt_sealed_device')
    const decision=await evaluatePinVerifierSnapshot(
      scope,snapshot.pinHmacKey,candidate,snapshot.pinVerifier,
    )
    if(!decision.next){
      return {result:decision.result,receiptRevision:null}
    }
    if(activeSession.value!==null)
      throw new Error('pin.live_session_must_be_closed')
    const db=await openIdentityDB()
    let committed=false
    try{
      // Revision fencing uses the entire authenticated snapshot and envelope.
      // No asynchronous cryptography is performed inside this transaction.
      committed=await new Promise<boolean>((resolve,reject)=>{
        const tx=db.transaction('devices','readwrite')
        const store=tx.objectStore('devices')
        let matched=false
        let cause:Error|null=null
        const request=store.get(scope.deviceId)
        request.onsuccess=()=>{
          const current=request.result as DeviceRow|undefined
          if(isSealed(current)&&current.accountId===scope.accountId &&
             current.pinVerifier &&
             JSON.stringify(current.pinVerifier)===
               JSON.stringify(snapshot.pinVerifier) &&
             canonical(current.envelope as unknown as Record<string,unknown>)===
               canonical(snapshot.envelope as unknown as Record<string,unknown>) &&
             activeSession.value===null){
            matched=true
            store.put({...current,pinVerifier:decision.next})
          }
        }
        request.onerror=()=>{cause=new Error('pin.device_storage_error')}
        tx.oncomplete=()=>resolve(matched)
        tx.onabort=()=>reject(cause??tx.error??new Error('pin.device_storage_aborted'))
        tx.onerror=()=>{ /* onabort reports durable error */ }
      })
    }finally{db.close()}
    if(committed){
      return {
        result:decision.result,
        receiptRevision:decision.result.status==='app-unlocked'?
          decision.next.revision:null,
      }
    }
  }
  throw new Error('pin.concurrent_state_changed')
}

/**
 * Read the sealed device for an exact successful verifier receipt.
 * Reject concurrent PIN failures/identity replacement while decrypting.
 * This is not an authoritative user-session proof or full app startup.
 */
export async function readSealedDeviceWithReceipt(
  scope:PinScope,revision:string,
):Promise<{
  encrypted:PinSealedPackage
  envelopeDeviceAes:CryptoKey
}>{
  validScope(scope)
  if(typeof revision!=='string'||revision.length<16)
    throw new Error('pin.invalid_receipt')
  const rows=await readRows()
  const row=rows.devices.find(x=>x.deviceId===scope.deviceId)
  if(!isSealed(row)||row.accountId!==scope.accountId||
      row.pinVerifier?.revision!==revision||
      row.pinVerifier?.accountId!==scope.accountId||
      row.pinVerifier?.deviceId!==scope.deviceId||
      row.envelope?.accountId!==scope.accountId||
      row.envelope?.deviceId!==scope.deviceId)
    throw new Error('pin.receipt_expired')
  return {encrypted:row.envelope,envelopeDeviceAes:row.encryptionKey}
}
