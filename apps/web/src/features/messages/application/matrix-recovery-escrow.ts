import Dexie,{type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {
  b64,unb64,random,digest,hex,uuid,sign,verify,importSigner,importSpki,
} from '../../identity/infrastructure/crypto'
import {getBoundMatrixCredentials} from './matrix-binding'
import type {MatrixBindingContract} from './matrix-binding'

/**
 * PB3 key-only wrapping for a pre-existing 32-byte Matrix 4S secret-storage
 * private key. The SDK's cross-signing and remote key backup are NOT set up
 * here. No keys are ever supplied to Laravel in plaintext.
 */
const enc=new TextEncoder()
const dec=new TextDecoder('utf-8',{fatal:true})
const domain='pb3.matrix-ssss-escrow.v1'
const signDomain=domain+'\n'
const pendingDomain='pb3.matrix-ssss-escrow-pending.v1'
const uuidRe=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const hexRe=/^[a-f0-9]{64}$/

type EscrowContract={
  version:1
  operationId:string
  accountId:string
  accountRevision:number
  homeserverUrl:string
  matrixUserId:string
  purpose:'matrix-ssss-key'
  keyId:string
  iv:string
  ciphertext:string
}
type SignedEscrow={contract:string;signature:string}
type PendingRow={scope:string;iv:string;ciphertext:string}
class PendingDB extends Dexie{
  pending!:Table<PendingRow,string>
  constructor(){
    super('pb3-matrix-ssss-recovery-pending-v1')
    this.version(1).stores({pending:'&scope'})
  }
}
const db=new PendingDB()
let chain:Promise<void>=Promise.resolve()
function serialize<T>(f:()=>Promise<T>):Promise<T>{
  const next=chain.catch(()=>{}).then(f)
  chain=next.then(()=>{},()=>{})
  return next
}
function same(s:Session):void{
  const a=activeSession.value
  if(!a||a.accountId!==s.accountId||a.deviceId!==s.deviceId
    ||a.pkg.akek!==s.pkg.akek||a.pkg.accountSpki!==s.pkg.accountSpki
    ||a.pkg.revision!==s.pkg.revision)
    throw Error('matrix.recovery_identity_changed')
}
function online():Session{
  const s=requireSession()
  if(!s.online)throw Error('matrix.recovery_requires_online')
  return s
}
async function localScope(s:Session):Promise<string>{
  return hex(await digest(enc.encode(pendingDomain+'\n'+s.accountId)))
}
function aad(value:string):Uint8Array<ArrayBuffer>{
  return enc.encode(value)
}
async function aes(s:Session,purpose:string,info:string,usage:KeyUsage):Promise<CryptoKey>{
  const ake=unb64(s.pkg.akek,32)
  let source:CryptoKey
  try{source=await crypto.subtle.importKey('raw',ake,'HKDF',false,['deriveKey'])}
  finally{ake.fill(0)}
  return crypto.subtle.deriveKey({
    name:'HKDF',hash:'SHA-256',salt:enc.encode(domain+'\n'+purpose),
    info:enc.encode(info),
  },source,{name:'AES-GCM',length:256},false,[usage])
}
function context(c:Pick<EscrowContract,
'accountId'|'accountRevision'|'homeserverUrl'|'matrixUserId'|'keyId'
>):string{
  return [domain,c.accountId,c.accountRevision,c.homeserverUrl,c.matrixUserId,c.keyId].join('\n')
}
function validate(c:unknown,s:Session):EscrowContract{
  if(!c||typeof c!=='object'||Array.isArray(c))throw Error('matrix.recovery_invalid_contract')
  const v=c as Record<string,unknown>
  if(Object.keys(v).sort().join('|')!==[
      'accountId','accountRevision','ciphertext','homeserverUrl','iv','keyId',
      'matrixUserId','operationId','purpose','version',
    ].join('|')
    ||v.version!==1||v.purpose!=='matrix-ssss-key'
    ||v.accountId!==s.accountId||v.accountRevision!==s.pkg.revision
    ||!Number.isSafeInteger(v.accountRevision)
    ||typeof v.operationId!=='string'||!uuidRe.test(v.operationId)
    ||typeof v.homeserverUrl!=='string'||v.homeserverUrl.length>255
    ||typeof v.matrixUserId!=='string'||v.matrixUserId.length>255
    ||typeof v.keyId!=='string'||typeof v.iv!=='string'
    ||typeof v.ciphertext!=='string')
    throw Error('matrix.recovery_invalid_contract')
  unb64(v.keyId,16)
  unb64(v.iv,12)
  unb64(v.ciphertext,48)
  return v as EscrowContract
}
async function checkSigned(value:SignedEscrow,s:Session):Promise<EscrowContract>{
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).sort().join('|')!=='contract|signature'
    ||typeof value.contract!=='string'||typeof value.signature!=='string')
    throw Error('matrix.recovery_invalid_receipt')
  let candidate:unknown
  try{candidate=JSON.parse(value.contract)}
  catch{throw Error('matrix.recovery_invalid_receipt')}
  const c=validate(candidate,s)
  if(JSON.stringify(c)!==value.contract
    ||!await verify(await importSpki(s.pkg.accountSpki),
      signDomain+value.contract,value.signature))
    throw Error('matrix.recovery_untrusted_receipt')
  same(s)
  return c
}
async function putPending(s:Session,signed:SignedEscrow):Promise<void>{
  const scope=await localScope(s)
  const iv=random(12)
  const ciphertext=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,tagLength:128,
    additionalData:aad(pendingDomain+'\n'+scope),
  },await aes(s,'pending',scope,'encrypt'),enc.encode(JSON.stringify(signed)))
  same(s)
  // Database transaction ensures two tabs do not silently replace each
  // other's pending secret-storage recovery key envelopes.
  await db.transaction('rw',db.pending,async()=>{
    if(await db.pending.get(scope))throw Error('matrix.recovery_pending_exists')
    await db.pending.put({scope,iv:b64(iv),ciphertext:b64(ciphertext)})
  })
  same(s)
}
async function readPending(s:Session):Promise<SignedEscrow|null>{
  const scope=await localScope(s)
  const row=await db.pending.get(scope)
  same(s)
  if(!row)return null
  if(row.scope!==scope||!hexRe.test(row.scope))
    throw Error('matrix.recovery_pending_corrupt')
  let value:SignedEscrow
  try{
    const raw=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(row.iv,12),tagLength:128,
      additionalData:aad(pendingDomain+'\n'+scope),
    },await aes(s,'pending',scope,'decrypt'),unb64(row.ciphertext))
    value=JSON.parse(dec.decode(raw)) as SignedEscrow
  }catch{throw Error('matrix.recovery_pending_corrupt')}
  await checkSigned(value,s)
  return value
}
async function binding(s:Session):Promise<MatrixBindingContract>{
  const b=await getBoundMatrixCredentials()
  same(s)
  if(!b)throw Error('matrix.recovery_binding_required')
  if(b.contract.accountId!==s.accountId)throw Error('matrix.recovery_binding_mismatch')
  return b.contract
}
async function verifyRemote(s:Session,signed:SignedEscrow):Promise<void>{
  const row=await jsonApi<{
    present:boolean;contract?:string;signature?:string
  }>('/matrix/v1/recovery/ssss')
  same(s)
  if(!row.present||row.contract!==signed.contract
    ||row.signature!==signed.signature)
    throw Error('matrix.recovery_ack_unverified')
  await checkSigned(signed,s)
}
async function upload(s:Session,signed:SignedEscrow):Promise<void>{
  same(s)
  const response=await jsonApi<{stored:boolean;unchanged:boolean}>(
    '/matrix/v1/recovery/ssss','POST',signed)
  same(s)
  if(response.stored!==true)throw Error('matrix.recovery_write_unconfirmed')
  await verifyRemote(s,signed)
  const scope=await localScope(s)
  same(s)
  await db.pending.delete(scope)
  same(s)
}

/**
 * The SDK must first create/provide its Matrix 4S private key; the owner
 * explicitly opts to escrow that key. NOT a Matrix login or key backup.
 */
export async function escrowMatrixSecretStorageKey(key:Uint8Array):Promise<void>{
  if(!(key instanceof Uint8Array)||key.byteLength!==32)
    throw Error('matrix.recovery_key_invalid')
  return serialize(async()=>{
    const s=online()
    same(s)
    if(await readPending(s))throw Error('matrix.recovery_retry_required')
    const me=await jsonApi<{present:boolean}>('/matrix/v1/recovery/ssss')
    same(s)
    if(me.present)throw Error('matrix.recovery_already_saved')
    const b=await binding(s)
    const keyId=b64(random(16)),iv=random(12)
    const fields={
      accountId:s.accountId,accountRevision:s.pkg.revision,
      homeserverUrl:b.homeserverUrl,matrixUserId:b.matrixUserId,keyId,
    }
    const copy=new Uint8Array(key)
    let ciphertext:ArrayBuffer
    try{
      ciphertext=await crypto.subtle.encrypt({
        name:'AES-GCM',iv,tagLength:128,
        additionalData:aad(context(fields)),
      },await aes(s,'ssss',context(fields),'encrypt'),copy)
    }finally{copy.fill(0)}
    const contract:EscrowContract={
      version:1,operationId:uuid(),accountId:s.accountId,
      accountRevision:s.pkg.revision,homeserverUrl:b.homeserverUrl,
      matrixUserId:b.matrixUserId,purpose:'matrix-ssss-key',
      keyId,iv:b64(iv),ciphertext:b64(ciphertext),
    }
    validate(contract,s)
    const serialized=JSON.stringify(contract)
    const signed:SignedEscrow={
      contract:serialized,
      signature:await sign(await importSigner(s.pkg.accountPkcs8),
        signDomain+serialized),
    }
    same(s)
    await putPending(s,signed) // durable before first network POST
    await upload(s,signed)
  })
}
/** Retry the exact same immutable signed contract after a lost ACK. */
export async function retryMatrixRecoveryEscrow():Promise<void>{
  return serialize(async()=>{
    const s=online()
    const previous=await readPending(s)
    if(!previous)throw Error('matrix.recovery_no_pending')
    const b=await binding(s),contract=await checkSigned(previous,s)
    if(contract.homeserverUrl!==b.homeserverUrl
      ||contract.matrixUserId!==b.matrixUserId)
      throw Error('matrix.recovery_binding_mismatch')
    await upload(s,previous)
  })
}
/** PB3 Recovery Key yields the same AKEK on an enrolled NEW PB3 device. */
export async function recoverMatrixSecretStorageKey():Promise<Uint8Array<ArrayBuffer>|null>{
  const s=online()
  const b=await binding(s)
  const row=await jsonApi<{
    present:boolean;contract?:string;signature?:string
  }>('/matrix/v1/recovery/ssss')
  same(s)
  if(!row.present)return null
  const c=await checkSigned({
    contract:row.contract??'',signature:row.signature??'',
  },s)
  if(c.homeserverUrl!==b.homeserverUrl
    ||c.matrixUserId!==b.matrixUserId)
    throw Error('matrix.recovery_binding_mismatch')
  let key:ArrayBuffer
  try{
    key=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(c.iv,12),tagLength:128,
      additionalData:aad(context(c)),
    },await aes(s,'ssss',context(c),'decrypt'),unb64(c.ciphertext))
  }catch{throw Error('matrix.recovery_unwrap_failed')}
  same(s)
  const bytes=new Uint8Array(key)
  if(bytes.length!==32)throw Error('matrix.recovery_invalid_key_bytes')
  return bytes // Caller must zero this view after passing it to Matrix SDK.
}
/** Not a network delete; only displays the encrypted pending status. */
export async function matrixRecoveryPending():Promise<boolean>{
  const s=requireSession()
  return(await readPending(s))!==null
}
