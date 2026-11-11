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
const domainV2='pb3.matrix-ssss-escrow.v2'
const signDomain=domain+'\n'
const pendingDomain='pb3.matrix-ssss-escrow-pending.v1'
const uuidRe=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const hexRe=/^[a-f0-9]{64}$/

type EscrowBase={
  version:1|2
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
type EscrowContract=EscrowBase & (
  {version:1;previousContractHash?:never}
  |{version:2;previousContractHash:string}
)
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
async function aes(s:Session,purpose:string,info:string,usage:KeyUsage,
  version:1|2=1):Promise<CryptoKey>{
  const ake=unb64(s.pkg.akek,32)
  let source:CryptoKey
  try{source=await crypto.subtle.importKey('raw',ake,'HKDF',false,['deriveKey'])}
  finally{ake.fill(0)}
  return crypto.subtle.deriveKey({
    name:'HKDF',hash:'SHA-256',
    salt:enc.encode((version===2?domainV2:domain)+'\n'+purpose),
    info:enc.encode(info),
  },source,{name:'AES-GCM',length:256},false,[usage])
}
function context(c:Pick<EscrowContract,
'version'|'accountId'|'accountRevision'|'homeserverUrl'|'matrixUserId'|'keyId'
>):string{
  return [c.version===2?domainV2:domain,c.accountId,c.accountRevision,
    c.homeserverUrl,c.matrixUserId,c.keyId].join('\n')
}
function validate(c:unknown,s:Session,older=false):EscrowContract{
  if(!c||typeof c!=='object'||Array.isArray(c))
    throw Error('matrix.recovery_invalid_contract')
  const v=c as Record<string,unknown>
  const fields=['accountId','accountRevision','ciphertext','homeserverUrl',
    'iv','keyId','matrixUserId','operationId','purpose','version']
  if(v.version===2)fields.push('previousContractHash')
  if((v.version!==1&&v.version!==2)
    ||Object.keys(v).sort().join('|')!==fields.sort().join('|')
    ||v.purpose!=='matrix-ssss-key'
    ||v.accountId!==s.accountId
    ||!Number.isSafeInteger(v.accountRevision)
    ||(v.accountRevision as number)<1
    ||(older
      ?(v.accountRevision as number)>=s.pkg.revision
      :v.accountRevision!==s.pkg.revision)
    ||typeof v.operationId!=='string'||!uuidRe.test(v.operationId)
    ||typeof v.homeserverUrl!=='string'||v.homeserverUrl.length>255
    ||typeof v.matrixUserId!=='string'||v.matrixUserId.length>255
    ||typeof v.keyId!=='string'||typeof v.iv!=='string'
    ||typeof v.ciphertext!=='string'
    ||(v.version===2
      &&(typeof v.previousContractHash!=='string'
        ||!hexRe.test(v.previousContractHash)
        ||(v.accountRevision as number)<2)))
    throw Error('matrix.recovery_invalid_contract')
  unb64(v.keyId,16)
  unb64(v.iv,12)
  unb64(v.ciphertext,48)
  return v as EscrowContract
}
async function checkSigned(value:SignedEscrow,s:Session,
  older=false):Promise<EscrowContract>{
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).sort().join('|')!=='contract|signature'
    ||typeof value.contract!=='string'||typeof value.signature!=='string')
    throw Error('matrix.recovery_invalid_receipt')
  let candidate:unknown
  try{candidate=JSON.parse(value.contract)}
  catch{throw Error('matrix.recovery_invalid_receipt')}
  const c=validate(candidate,s,older)
  const signFor=c.version===2?domainV2+'\n':signDomain
  if(JSON.stringify(c)!==value.contract
    ||!await verify(await importSpki(s.pkg.accountSpki),
      signFor+value.contract,value.signature))
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

/** The account-level Matrix binding is available to a freshly recovered
 * PB3 device WITHOUT requiring that new device to have a Matrix token.
 * This endpoint requires a genuine authenticated PB3 root session.
 */
async function accountBinding(s:Session):Promise<{
  homeserverUrl:string;matrixUserId:string
}>{
  const mine=await jsonApi<{
    configured:boolean;homeserverUrl:string;matrixUserId:string|null
  }>('/matrix/v1/me')
  same(s)
  if(!mine.configured||!mine.homeserverUrl||!mine.matrixUserId)
    throw Error('matrix.recovery_account_binding_missing')
  return {homeserverUrl:mine.homeserverUrl,matrixUserId:mine.matrixUserId}
}

async function unwrapSignedSeed(s:Session,c:EscrowContract
):Promise<Uint8Array<ArrayBuffer>>{
  let key:ArrayBuffer
  try{
    key=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(c.iv,12),tagLength:128,
      additionalData:aad(context(c)),
    },await aes(s,'ssss',context(c),'decrypt',c.version),
      unb64(c.ciphertext))
  }catch{throw Error('matrix.recovery_unwrap_failed')}
  same(s)
  const bytes=new Uint8Array(key)
  if(bytes.length!==32)throw Error('matrix.recovery_invalid_key_bytes')
  return bytes
}

/** A new epoch MUST be a fresh authenticated encryption of the SAME seed.
 * Its parent is an independently root-signed, decrypted older envelope.
 * The v1 table is untouched and no second Matrix login is needed.
 */
async function rewrapPrevious(s:Session):Promise<void>{
  const account=await accountBinding(s)
  const pending=await readPending(s)
  if(pending){
    const queued=await checkSigned(pending,s)
    if(queued.version!==2||queued.homeserverUrl!==account.homeserverUrl
      ||queued.matrixUserId!==account.matrixUserId)
      throw Error('matrix.recovery_pending_revision_conflict')
    await upload(s,pending)
    return
  }
  const previous=await jsonApi<{
    present:boolean;contract?:string;signature?:string
  }>('/matrix/v1/recovery/ssss/previous')
  same(s)
  if(!previous.present)
    throw Error('matrix.recovery_previous_unavailable')
  const original={
    contract:previous.contract??'',signature:previous.signature??'',
  }
  const old=await checkSigned(original,s,true)
  if(old.homeserverUrl!==account.homeserverUrl
    ||old.matrixUserId!==account.matrixUserId)
    throw Error('matrix.recovery_binding_mismatch')
  // If the AKEK or account root was rotated, do NOT re-encrypt garbage.
  // Retain the historical ciphertext for an explicit separately reviewed
  // migration; never delete or downgrade the recovery floor.
  const secret=await unwrapSignedSeed(s,old)
  try{
    const previousContractHash=hex(await digest(enc.encode(original.contract)))
    const keyId=b64(random(16)),iv=random(12)
    const fields={
      version:2 as const,
      accountId:s.accountId,accountRevision:s.pkg.revision,
      homeserverUrl:account.homeserverUrl,
      matrixUserId:account.matrixUserId,keyId,
    }
    const cipher=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,tagLength:128,
      additionalData:aad(context(fields)),
    },await aes(s,'ssss',context(fields),'encrypt',2),secret)
    same(s)
    const contract:EscrowContract={
      version:2,operationId:uuid(),
      accountId:s.accountId,accountRevision:s.pkg.revision,
      homeserverUrl:account.homeserverUrl,
      matrixUserId:account.matrixUserId,purpose:'matrix-ssss-key',
      keyId,iv:b64(iv),ciphertext:b64(cipher),
      previousContractHash,
    }
    validate(contract,s)
    const serialized=JSON.stringify(contract)
    const signed:SignedEscrow={
      contract:serialized,
      signature:await sign(await importSigner(s.pkg.accountPkcs8),
        domainV2+'\\n'+serialized),
    }
    same(s)
    await putPending(s,signed)
    await upload(s,signed)
  }finally{secret.fill(0)}
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
      version:1 as const,
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
    const contract=await checkSigned(previous,s)
    const account=contract.version===2
      ?await accountBinding(s):await binding(s)
    if(contract.homeserverUrl!==account.homeserverUrl
      ||contract.matrixUserId!==account.matrixUserId)
      throw Error('matrix.recovery_binding_mismatch')
    await upload(s,previous)
  })
}
/** PB3 Recovery Key yields the same AKEK on an enrolled NEW PB3 device. */
export async function recoverMatrixSecretStorageKey():Promise<Uint8Array<ArrayBuffer>|null>{
  const s=online()
  const own=await accountBinding(s)
  let row:{present:boolean;contract?:string;signature?:string}
  try{
    row=await jsonApi('/matrix/v1/recovery/ssss')
  }catch(e){
    // 409 = authenticated account has an obsolete signed escrow epoch.
    // Never expose an old revision as a current receipt. First rewrap
    // its verified plaintext into fresh current-epoch AEAD and signature,
    // then independently read the exact server-confirmed new contract.
    if(!(e instanceof Error&&e.message==='api.http_409')
      ||s.pkg.revision<=1)throw e
    await rewrapPrevious(s)
    row=await jsonApi('/matrix/v1/recovery/ssss')
  }
  same(s)
  if(!row.present)return null
  const c=await checkSigned({
    contract:row.contract??'',signature:row.signature??'',
  },s)
  if(c.homeserverUrl!==own.homeserverUrl
    ||c.matrixUserId!==own.matrixUserId)
    throw Error('matrix.recovery_binding_mismatch')
  return unwrapSignedSeed(s,c)
}
/** Not a network delete; only displays the encrypted pending status. */
export async function matrixRecoveryPending():Promise<boolean>{
  const s=requireSession()
  return(await readPending(s))!==null
}
