import { activeSession } from '../../identity/application/session'
import {
  canonical, importSpki, openDevice, sign, verify,
} from '../../identity/infrastructure/crypto'
import type { PackageV2, DeviceEnvelope } from '../../identity/infrastructure/crypto'
import { openIdentityDB } from '../../identity/infrastructure/storage'
import type { LocalDevice } from '../../identity/infrastructure/storage'
import { attemptPinVerifier, enrollPinVerifier } from './pin-verifier'
import type { PinScope } from './pin-verifier'
import { openPinProtectedPackage, sealPinProtectedPackage } from './pin-sealed-package'
import type { PinSealedPackage } from './pin-sealed-package'

/**
 * PREINTEGRATION / NOT CALLED BY PRODUCT.
 *
 * This performs a CAS replacement of one legacy device envelope in the real
 * identity-v2 IndexedDB store. The PIN verifier lives in a DIFFERENT DB, so
 * enrollment and device swap CANNOT be a single atomic browser transaction.
 * A crash after verifier enrollment but before swap leaves legacy access
 * available and a stranded verifier. Do NOT expose this operation as "PIN on"
 * in UI or use on a live device before the full lifecycle / Recovery Key
 * acceptance has been audited.
 */
export type SealedPinDevice = Omit<LocalDevice,'envelope'> & {
  envelope:PinSealedPackage
  pinMode:'pin-v1'
  pinHmacKey:CryptoKey
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
            ...still,envelope:encrypted,pinMode:'pin-v1',pinHmacKey:hmac,
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
 * PIN verifier in a separate DB is enrolled BEFORE the transactional swap,
 * so a crash can strand a verifier; it cannot produce a partially overwritten
 * device row. On stale/corrupt state, fail closed; Recovery Key is the only
 * guaranteed recovery, no silent downgrade/fallback.
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
  // No completion marker is written until both enrollment and final swap
  // succeed. The orphan-verifier window remains documented and fail-closed.
  await enrollPinVerifier(scope,secret,appPin,emergencyPin)
  const accepted=await attemptPinVerifier(scope,secret,appPin)
  if(accepted.status!=='app-unlocked')
    throw new Error('pin.verifier_unavailable')
  denyIfLive()
  await transactionalReplace(scope,initial,encrypted,secret)
}

/**
 * Read protected mode metadata for a future PIN Shell, with no package
 * decryption and no direct session activation.
 */
export async function readSealedPinDevice(scope:PinScope):Promise<{
  encrypted:PinSealedPackage
  verifierDeviceHmac:CryptoKey
  envelopeDeviceAes:CryptoKey
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
     row.encryptionKey?.extractable!==false)
    throw new Error('pin.corrupt_sealed_device')
  return {
    encrypted:row.envelope,verifierDeviceHmac:row.pinHmacKey,
    envelopeDeviceAes:row.encryptionKey,
  }
}
