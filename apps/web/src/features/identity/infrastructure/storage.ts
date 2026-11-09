import { newDeviceEncryptionKey, newSigning, random, sign, b64 } from './crypto'
import type { DeviceEnvelope, RecoveryEnvelope } from './crypto'

export type LocalDevice = {
  accountId: string
  deviceId: string
  deviceKey: CryptoKey
  deviceSpki: string
  encryptionKey: CryptoKey
  envelope: DeviceEnvelope
}
export type Pending = {
  operationId: string
  reservationProof: string
  kitLocator: string
  accountId?: string
  deviceId: string
  deviceKey: CryptoKey
  deviceSpki: string
  encryptionKey: CryptoKey
  envelope?: DeviceEnvelope
}
export type RecoveryPending = { locator: string; device: LocalDevice }
export type PairingPending = {
  id: string
  accountId: string
  device: LocalDevice
  key: CryptoKeyPair
  token: string
  fingerprint: string
  ecdhSpki: string
}
export type RotationPending = {
  accountId: string
  deviceId: string
  operationId: string
  envelopeHash: string
  expectedRevision: number
  locator: string
  recoveryEnvelope: RecoveryEnvelope
  deviceEnvelope: DeviceEnvelope
}
const NAME = 'pb3-identity-v2'
type Store = 'devices'|'pending'|'probe'|'recoveries'|'pairings'|'rotations'|'sessions'
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('identity.storage_error'))
  })
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve,reject) => {
    tx.oncomplete=()=>resolve()
    tx.onerror=()=>reject(tx.error ?? new Error('identity.storage_error'))
    tx.onabort=()=>reject(tx.error ?? new Error('identity.storage_aborted'))
  })
}
export async function openIdentityDB():Promise<IDBDatabase>{
  if (typeof indexedDB === 'undefined' || !crypto.subtle) throw new Error('identity.storage_unsupported')
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(NAME,3)
    req.onupgradeneeded=()=>{
      const h=req.result
      if (!h.objectStoreNames.contains('devices')) h.createObjectStore('devices',{keyPath:'deviceId'})
      if (!h.objectStoreNames.contains('pending')) h.createObjectStore('pending',{keyPath:'operationId'})
      if (!h.objectStoreNames.contains('probe')) h.createObjectStore('probe')
      if (!h.objectStoreNames.contains('recoveries')) h.createObjectStore('recoveries',{keyPath:'locator'})
      if (!h.objectStoreNames.contains('pairings')) h.createObjectStore('pairings',{keyPath:'id'})
      if (!h.objectStoreNames.contains('rotations')) h.createObjectStore('rotations',{keyPath:'accountId'})
      if (!h.objectStoreNames.contains('sessions')) h.createObjectStore('sessions',{keyPath:'deviceId'})
    }
    req.onsuccess=()=>resolve(req.result)
    req.onerror=()=>reject(req.error ?? new Error('identity.storage_denied'))
    req.onblocked=()=>reject(new Error('identity.storage_blocked'))
  })
}
async function transact<T>(store:Store,mode:IDBTransactionMode,fn:(os:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const handle=await openIdentityDB()
  try {
    const tx=handle.transaction(store,mode)
    const done=completed(tx)
    const result=request(fn(tx.objectStore(store)))
    const value=await result
    await done
    return value
  } finally { handle.close() }
}
export async function probeCapabilities():Promise<void>{
  // Must be checked before any network POST /prepare. No marker in localStorage.
  const pair=await newSigning(false)
  const wrapping=await newDeviceEncryptionKey()
  const id=b64(random(12))
  try {
    await transact('probe','readwrite',os=>os.put({id,signer:pair.privateKey,wrapping},id))
    const saved=await transact<{id:string;signer:CryptoKey;wrapping:CryptoKey}>('probe','readonly',os=>os.get(id))
    if (!saved || saved.signer.extractable || saved.wrapping.extractable) throw new Error('identity.nonextractable_probe_failed')
    const proof=await sign(saved.signer,'photobunker.identity.storage.v2')
    if (proof.length!==86) throw new Error('identity.key_probe_failed')
    const iv=random(12),plaintext=random(32)
    const sealed=await crypto.subtle.encrypt({name:'AES-GCM',iv},saved.wrapping,plaintext)
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv},saved.wrapping,sealed)
    if (b64(clear)!==b64(plaintext)) throw new Error('identity.storage_crypto_probe_failed')
  } finally { await transact('probe','readwrite',os=>os.delete(id)).catch(()=>{}) }
}
export async function putPending(value:Pending):Promise<void>{
  await transact('pending','readwrite',os=>os.put(value))
}
export async function reservePending(value:Pending):Promise<void>{
  const handle=await openIdentityDB()
  return new Promise<void>((resolve,reject)=>{
    const tx=handle.transaction('pending','readwrite')
    const store=tx.objectStore('pending')
    const rows=store.getAllKeys()
    let conflict=false
    rows.onsuccess=()=>{
      if(rows.result.length){conflict=true;tx.abort();return}
      store.put(value)
    }
    rows.onerror=()=>tx.abort()
    tx.oncomplete=()=>{handle.close();resolve()}
    tx.onabort=()=>{
      handle.close()
      reject(conflict?new Error('identity.pending_account_requires_recovery_key'):
        tx.error??new Error('identity.storage_aborted'))
    }
    tx.onerror=()=>{ /* onabort reports the durable failure once */ }
  })
}
export async function getPending():Promise<Pending|undefined>{
  const handle=await openIdentityDB()
  try{
    const tx=handle.transaction('pending','readonly')
    const done=completed(tx)
    const rows=await request(tx.objectStore('pending').getAll()) as Pending[]
    await done
    if(rows.length>1)throw new Error('identity.pending_state_conflict')
    return rows[0]
  } finally {handle.close()}
}
export async function dropPending(operationId:string):Promise<void>{
  await transact('pending','readwrite',os=>os.delete(operationId))
}
export async function saveDevice(value:LocalDevice):Promise<void>{
  await transact('devices','readwrite',os=>os.put(value))
}
export async function getDevice(accountId:string,deviceId:string):Promise<LocalDevice|undefined>{
  const value=await transact<LocalDevice|undefined>('devices','readonly',os=>os.get(deviceId))
  if(value?.accountId!==accountId)return undefined
  return value
}
export async function listDevices():Promise<LocalDevice[]>{
  const handle=await openIdentityDB()
  try {
    const tx=handle.transaction('devices','readonly')
    const done=completed(tx)
    const rows=await request(tx.objectStore('devices').getAll()) as LocalDevice[]
    await done
    return rows
  } finally {handle.close()}
}
export async function saveRecoveryPending(value:RecoveryPending):Promise<void>{
  await transact('recoveries','readwrite',os=>os.put(value))
}
export async function getRecoveryPending(locator:string):Promise<RecoveryPending|undefined>{
  return transact('recoveries','readonly',os=>os.get(locator))
}
export async function dropRecoveryPending(locator:string):Promise<void>{
  await transact('recoveries','readwrite',os=>os.delete(locator))
}
export async function savePairingPending(value:PairingPending):Promise<void>{
  await transact('pairings','readwrite',os=>os.put(value))
}
export async function getPairingPending():Promise<PairingPending|undefined>{
  const handle=await openIdentityDB()
  try {
    const tx=handle.transaction('pairings','readonly'),done=completed(tx)
    const rows=await request(tx.objectStore('pairings').getAll()) as PairingPending[]
    await done
    if(rows.length>1)throw new Error('identity.pairing_state_conflict')
    return rows[0]
  } finally {handle.close()}
}
export async function dropPairingPending(id:string):Promise<void>{
  await transact('pairings','readwrite',os=>os.delete(id))
}
export async function saveRotationPending(value:RotationPending):Promise<void>{
  await transact('rotations','readwrite',os=>os.put(value))
}
export async function getRotationPending(accountId:string):Promise<RotationPending|undefined>{
  return transact('rotations','readonly',os=>os.get(accountId))
}
export async function dropRotationPending(accountId:string):Promise<void>{
  await transact('rotations','readwrite',os=>os.delete(accountId))
}
export async function markSignedOut(accountId:string,deviceId:string,signedOut:boolean):Promise<void>{
  if(signedOut)await transact('sessions','readwrite',os=>os.put({accountId,deviceId,signedOut:true}))
  else await transact('sessions','readwrite',os=>os.delete(deviceId))
}
export async function isSignedOut(accountId:string,deviceId:string):Promise<boolean>{
  const value=await transact<{accountId:string;deviceId:string;signedOut:true}|undefined>(
    'sessions','readonly',os=>os.get(deviceId))
  return value?.accountId===accountId&&value.signedOut===true
}
export async function newLocalDevice(accountId:string):Promise<LocalDevice>{
  const pair=await newSigning(false)
  const deviceId=crypto.randomUUID()
  const deviceSpki=b64(await crypto.subtle.exportKey('spki',pair.publicKey))
  return {accountId,deviceId,deviceKey:pair.privateKey,deviceSpki,
    encryptionKey:await newDeviceEncryptionKey(),envelope:undefined as unknown as DeviceEnvelope}
}
