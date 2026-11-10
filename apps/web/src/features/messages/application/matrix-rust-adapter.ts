import {shallowRef,watch} from 'vue'
import type {MatrixClient} from 'matrix-js-sdk'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {digest,hex,unb64} from '../../identity/infrastructure/crypto'
import {getBoundMatrixCredentials} from './matrix-binding'
import type {MatrixBindingContract} from './matrix-binding'
import {acquireMatrixCryptoLease} from './matrix-crypto-lease'
import type {MatrixCryptoLease} from './matrix-crypto-lease'

/**
 * P2-02B bootstrap only. No startClient(), room, send, membership, or keys
 * sharing APIs are exposed until verified Matrix ACL, cross-signing, and the
 * PB3 Recovery Key / Matrix key-backup bridge are independently tested.
 */
export const matrixCryptoStatus=shallowRef<
  'inactive'|'opening'|'crypto_initialized_only'
>('inactive')
const encoder=new TextEncoder()
const storeDomain='pb3.matrix.rustcrypto-store.v1'
const urlPattern=/^https:\/\/[a-z0-9][a-z0-9.-]*(?::443)?$/

type Runtime={client:MatrixClient;lease:MatrixCryptoLease;unwatch:()=>void}
let runtime:Runtime|null=null
let starting:Promise<void>|null=null
let generation=0
let stopping:Promise<void>|null=null

function unchanged(s:Session,epoch:number):void {
  const now=activeSession.value
  if(epoch!==generation||!now||!now.online||now.accountId!==s.accountId
    ||now.deviceId!==s.deviceId||now.pkg.revision!==s.pkg.revision
    ||now.pkg.akek!==s.pkg.akek||now.pkg.accountSpki!==s.pkg.accountSpki)
    throw Error('matrix.pb3_identity_changed')
}
function safeHomeserver(url:string):void {
  if(!urlPattern.test(url))throw Error('matrix.homeserver_invalid')
  const host=new URL(url).hostname
  if(!host.includes('.')||/^\d+\.\d+\.\d+\.\d+$/.test(host))
    throw Error('matrix.homeserver_invalid')
}
async function scopeOf(s:Session,contract:MatrixBindingContract):Promise<string>{
  const input=[storeDomain,s.accountId,s.deviceId,
    contract.homeserverUrl,contract.matrixUserId,contract.matrixDeviceId].join('\n')
  return hex(await digest(encoder.encode(input)))
}
async function storeKey(s:Session,scope:string):Promise<Uint8Array<ArrayBuffer>>{
  const bytes=unb64(s.pkg.akek,32)
  let root:CryptoKey
  try{root=await crypto.subtle.importKey('raw',bytes,'HKDF',false,['deriveBits'])}
  finally{bytes.fill(0)}
  const derived=await crypto.subtle.deriveBits({
    name:'HKDF',hash:'SHA-256',
    salt:encoder.encode(storeDomain),
    info:encoder.encode(scope),
  },root,256)
  return new Uint8Array(derived)
}
function sameIdentity(s:Session):boolean{
  const cur=activeSession.value
  return Boolean(cur?.online&&cur.accountId===s.accountId
    &&cur.deviceId===s.deviceId&&cur.pkg.akek===s.pkg.akek
    &&cur.pkg.accountSpki===s.pkg.accountSpki&&cur.pkg.revision===s.pkg.revision)
}
async function closeActive():Promise<void>{
  const active=runtime
  if(!active)return
  runtime=null
  active.unwatch()
  // stopClient() is the SDK's normal shutdown path for RustCrypto and
  // its IndexedDB connections. On failure, keep the Web Lock: unsafe
  // to permit a second writer while the first may still own the store.
  try{active.client.stopClient()}
  catch{throw Error('matrix.crypto_shutdown_incomplete')}
  await active.lease.release()
  matrixCryptoStatus.value='inactive'
}
export async function stopMatrixCrypto():Promise<void>{
  generation++
  if(stopping)return stopping
  stopping=(async()=>{
    if(starting){try{await starting}catch{/* start already reports failure */}}
    await closeActive()
    matrixCryptoStatus.value='inactive'
  })()
  try{await stopping}finally{stopping=null}
}
async function initialize(epoch:number):Promise<void>{
  const s=activeSession.value
  if(!s?.online)throw Error('matrix.pb3_session_offline')
  unchanged(s,epoch)
  const credential=await getBoundMatrixCredentials()
  unchanged(s,epoch)
  if(!credential)throw Error('matrix.binding_required')
  const {contract,accessToken}=credential
  safeHomeserver(contract.homeserverUrl)

  // Independently read PB3's immutable signed binding before talking to the
  // Matrix origin. Local ciphertext by itself is not authoritative.
  const me=await jsonApi<{
    bound:boolean;homeserverUrl:string
    deviceBinding?:{contract:string}|null
  }>('/matrix/v1/me')
  unchanged(s,epoch)
  if(!me.bound||me.homeserverUrl!==contract.homeserverUrl
    ||me.deviceBinding?.contract!==JSON.stringify(contract))
    throw Error('matrix.server_binding_mismatch')

  const digestScope=await scopeOf(s,contract)
  unchanged(s,epoch)
  const lease=await acquireMatrixCryptoLease('pb3-matrix-'+digestScope)
  let client:MatrixClient|null=null
  try{
    unchanged(s,epoch)
    // Lazy import prevents Matrix startup from blocking Camera, Identity,
    // Browser or Assignments; no credentials are inserted in localStorage.
    const {createClient}=await import('matrix-js-sdk')
    unchanged(s,epoch)
    client=createClient({
      baseUrl:contract.homeserverUrl,
      userId:contract.matrixUserId,
      deviceId:contract.matrixDeviceId,
      accessToken,
    })
    const who=await client.whoami()
    unchanged(s,epoch)
    if(who.user_id!==contract.matrixUserId
      ||who.device_id!==contract.matrixDeviceId
      ||who.is_guest===true)
      throw Error('matrix.remote_identity_mismatch')

    // The SDK accepts an explicit 32-byte key. Never initialize the
    // default UNENCRYPTED IndexedDB store.
    const key=await storeKey(s,digestScope)
    try{
      unchanged(s,epoch)
      await client.initRustCrypto({
        useIndexedDB:true,
        cryptoDatabasePrefix:'pb3-matrix-crypto-'+digestScope,
        storageKey:key,
      })
    }finally{key.fill(0)}
    unchanged(s,epoch)
    if(!client.getCrypto())throw Error('matrix.rust_crypto_missing')
    const created:Runtime={
      client,lease,unwatch:()=>{},
    }
    created.unwatch=watch(activeSession,()=>{
      if(!sameIdentity(s))void stopMatrixCrypto()
    },{flush:'sync'})
    runtime=created
    matrixCryptoStatus.value='crypto_initialized_only'
  }catch(e){
    // If shutdown fails, do not release the lock and risk a second writer.
    try{client?.stopClient()}
    catch{throw Error('matrix.crypto_shutdown_incomplete')}
    await lease.release()
    if(e instanceof Error&&e.message.startsWith('matrix.'))throw e
    throw Error('matrix.crypto_initialization_failed')
  }
}
/** Explicit opt-in; deliberately not called from App, Shell or message draft UI. */
export async function startMatrixCrypto():Promise<void>{
  if(starting||runtime||stopping)throw Error('matrix.client_already_active')
  const epoch=++generation
  matrixCryptoStatus.value='opening'
  const task=initialize(epoch)
  starting=task
  try{await task}
  catch(e){
    matrixCryptoStatus.value='inactive'
    throw e
  }finally{
    if(starting===task)starting=null
  }
}
