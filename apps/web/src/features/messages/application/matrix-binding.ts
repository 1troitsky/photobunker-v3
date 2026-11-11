import Dexie, {type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {
  b64,unb64,random,digest,hex,importSigner,sign,uuid,
} from '../../identity/infrastructure/crypto'

/**
 * Matrix bridge bootstrap only. No Matrix login is auto-created, no Matrix SDK
 * client starts, no outgoing message is treated as sent by these functions.
 * Durable, sealed pending proof survives lost HTTP acknowledgement.
 */
const domain='pb3.matrix-binding.local.v1'
const signingDomain='pb3.matrix-binding.v1\n'
const text=new TextEncoder()
const decoder=new TextDecoder('utf-8',{fatal:true})
const mxid=/^@[a-zA-Z0-9._=+\/-]{1,120}:[a-zA-Z0-9.-]{1,100}$/
const mxDevice=/^[\x21-\x7e]{1,128}$/
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const hsPattern=/^https:\/\/[a-z0-9][a-z0-9.-]*(?::443)?$/

export type MatrixBindingContract={
  version:1;operationId:string;accountId:string;pb3DeviceId:string
  homeserverUrl:string;matrixUserId:string;matrixDeviceId:string
}
export type MatrixCredential={
  version:1;status:'pending'|'bound';contract:string
  accountSignature:string;deviceSignature:string;accessToken:string
}
type Sealed={scope:string;iv:string;ciphertext:string}
class MatrixDB extends Dexie{
  credentials!:Table<Sealed,string>
  constructor(){
    super('pb3-sealed-matrix-credentials-v1')
    this.version(1).stores({credentials:'&scope'})
  }
}
const db=new MatrixDB()
let chain:Promise<void>=Promise.resolve()

function active(s:Session):void{
  const c=activeSession.value
  if(!c||c.accountId!==s.accountId||c.deviceId!==s.deviceId
    ||c.pkg.akek!==s.pkg.akek||c.pkg.accountSpki!==s.pkg.accountSpki
    ||c.pkg.revision!==s.pkg.revision)
    throw Error('identity.changed')
}
function requireOnline():Session{
  const s=requireSession()
  if(!s.online)throw Error('matrix.pb3_session_offline')
  return s
}
function validateContract(c:unknown,s:Session):MatrixBindingContract{
  if(!c||typeof c!=='object'||Array.isArray(c))throw Error('matrix.invalid_contract')
  const v=c as Record<string,unknown>
  if(Object.keys(v).sort().join('|')!==
     'accountId|homeserverUrl|matrixDeviceId|matrixUserId|operationId|pb3DeviceId|version'
    ||v.version!==1||v.accountId!==s.accountId
    ||v.pb3DeviceId!==s.deviceId
    ||typeof v.operationId!=='string'||!uuidPattern.test(v.operationId)
    ||typeof v.homeserverUrl!=='string'||!hsPattern.test(v.homeserverUrl)
    ||typeof v.matrixUserId!=='string'||!mxid.test(v.matrixUserId)
    ||typeof v.matrixDeviceId!=='string'||!mxDevice.test(v.matrixDeviceId))
    throw Error('matrix.invalid_contract')
  return c as MatrixBindingContract
}
function validateRecord(v:unknown,s:Session):MatrixCredential{
  if(!v||typeof v!=='object'||Array.isArray(v))
    throw Error('matrix.invalid_record')
  const data=v as Record<string,unknown>
  if(Object.keys(data).sort().join('|')!==
      'accessToken|accountSignature|contract|deviceSignature|status|version'
    ||data.version!==1||!['pending','bound'].includes(String(data.status))
    ||typeof data.contract!=='string'
    ||typeof data.accessToken!=='string'
    ||data.accessToken.length<16||data.accessToken.length>4096
    ||!(/^[\x21-\x7e]+$/).test(data.accessToken)
    ||typeof data.accountSignature!=='string'
    ||typeof data.deviceSignature!=='string')
    throw Error('matrix.invalid_record')
  const c=validateContract(JSON.parse(data.contract),s)
  if(JSON.stringify(c)!==data.contract)throw Error('matrix.noncanonical_contract')
  unb64(data.accountSignature,64)
  unb64(data.deviceSignature,64)
  return v as MatrixCredential
}
async function scope(s:Session):Promise<string>{
  return hex(await digest(text.encode(domain+'\n'+s.accountId+'\n'+s.deviceId)))
}
async function encryptionKey(s:Session,usage:KeyUsage):Promise<CryptoKey>{
  const bytes=unb64(s.pkg.akek,32)
  let root:CryptoKey
  try{root=await crypto.subtle.importKey('raw',bytes,'HKDF',false,['deriveKey'])}
  finally{bytes.fill(0)}
  return crypto.subtle.deriveKey({
    name:'HKDF',hash:'SHA-256',
    salt:text.encode(domain),
    info:text.encode(s.accountId+'\n'+s.deviceId),
  },root,{name:'AES-GCM',length:256},false,[usage])
}
function aad(id:string):Uint8Array<ArrayBuffer>{
  return text.encode(domain+'\n'+id)
}
async function open(s:Session):Promise<MatrixCredential|null>{
  const id=await scope(s)
  active(s)
  const row=await db.credentials.get(id)
  active(s)
  if(!row)return null
  if(row.scope!==id)throw Error('matrix.invalid_scope')
  try{
    const plaintext=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(row.iv,12),additionalData:aad(id),
      tagLength:128,
    },await encryptionKey(s,'decrypt'),unb64(row.ciphertext))
    active(s)
    return validateRecord(JSON.parse(decoder.decode(plaintext)),s)
  }catch(e){
    if(e instanceof Error&&e.message==='identity.changed')throw e
    throw Error('matrix.local_credential_corrupted')
  }
}
async function seal(s:Session,record:MatrixCredential):Promise<void>{
  validateRecord(record,s)
  const id=await scope(s)
  const iv=random(12)
  const encrypted=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,additionalData:aad(id),tagLength:128,
  },await encryptionKey(s,'encrypt'),text.encode(JSON.stringify(record)))
  active(s)
  await db.credentials.put({scope:id,iv:b64(iv),ciphertext:b64(encrypted)})
  active(s)
}
// Per tab FIFO: pending proof is never replaced by a newer request before ACK.
function serialize<T>(operation:()=>Promise<T>):Promise<T>{
  const task=chain.catch(()=>{}).then(operation)
  chain=task.then(()=>{},()=>{})
  return task
}
export async function stagedMatrixBinding():Promise<'none'|'pending'|'bound'>{
  const s=requireSession()
  const row=await open(s)
  return row?.status??'none'
}
export async function beginMatrixBinding(input:{
  matrixUserId:string;matrixDeviceId:string;accessToken:string
}):Promise<void>{
  return serialize(async()=>{
    const s=requireOnline()
    active(s)
    if(await open(s))throw Error('matrix.binding_already_staged')
    // Config is retrieved only from the authenticated PB3 backend;
    // no arbitrary homeserver URLs or browser-supplied redirects.
    const me=await jsonApi<{
      configured:boolean;bound:boolean;homeserverUrl:string
    }>('/matrix/v1/me')
    active(s)
    if(!me.configured||me.bound||!hsPattern.test(me.homeserverUrl))
      throw Error('matrix.homeserver_unavailable')
    const contract:MatrixBindingContract={
      version:1,operationId:uuid(),accountId:s.accountId,
      pb3DeviceId:s.deviceId,homeserverUrl:me.homeserverUrl,
      matrixUserId:input.matrixUserId,matrixDeviceId:input.matrixDeviceId,
    }
    validateContract(contract,s)
    const canonical=JSON.stringify(contract)
    const message=signingDomain+canonical
    const [accountSignature,deviceSignature]=await Promise.all([
      sign(await importSigner(s.pkg.accountPkcs8),message),
      sign(s.device.deviceKey,message),
    ])
    const record:MatrixCredential={version:1,status:'pending',
      contract:canonical,accountSignature,deviceSignature,
      accessToken:input.accessToken}
    active(s)
    await seal(s,record) // Durable before the first POST, even if ACK is lost.
    await submit(s,record)
  })
}
async function submit(s:Session,record:MatrixCredential):Promise<void>{
  active(s)
  if(!s.online)throw Error('matrix.pb3_session_offline')
  const response=await jsonApi<{bound:boolean;unchanged:boolean}>(
    '/matrix/v1/bindings','POST',{
      contract:record.contract,accountSignature:record.accountSignature,
      deviceSignature:record.deviceSignature,accessToken:record.accessToken,
    })
  active(s)
  if(response.bound!==true)throw Error('matrix.binding_not_confirmed')
  const me=await jsonApi<{
    bound:boolean;deviceBinding?:{
      contract:string;accountSignature:string;deviceSignature:string
    }|null
  }>('/matrix/v1/me')
  active(s)
  if(!me.bound||me.deviceBinding?.contract!==record.contract
    ||me.deviceBinding.accountSignature!==record.accountSignature
    ||me.deviceBinding.deviceSignature!==record.deviceSignature)
    throw Error('matrix.binding_ack_mismatch')
  await seal(s,{...record,status:'bound'})
}
/** Replays the SAME signed operation after lost-ACK, never signs a new one. */
export async function retryMatrixBinding():Promise<void>{
  return serialize(async()=>{
    const s=requireOnline()
    const row=await open(s)
    if(!row||row.status!=='pending')throw Error('matrix.no_pending_binding')
    await submit(s,row)
  })
}
/** Only a confirmed local binding can supply credentials to a future SDK. */
export async function getBoundMatrixCredentials():Promise<{
  contract:MatrixBindingContract;accessToken:string
}|null>{
  const s=requireOnline()
  const record=await open(s)
  if(!record||record.status!=='bound')return null
  return {contract:validateContract(JSON.parse(record.contract),s),
    accessToken:record.accessToken}
}
/** Offline queue drafting may read only the existing PB3-account/device-signed
 * binding. It MUST NOT expose the token or claim a current Matrix session.
 * An actual send always rechecks online whoami + RustCrypto separately.
 */
export async function getLocalMatrixBindingForPending():Promise<MatrixBindingContract|null>{
  const s=requireSession()
  const record=await open(s)
  active(s)
  if(!record||record.status!=='bound')return null
  return validateContract(JSON.parse(record.contract),s)
}
/** Local deletion only: NOT remote Matrix logout or PB3 server revoke. */
export async function clearLocalMatrixCredentials():Promise<void>{
  return serialize(async()=>{
    const s=requireSession()
    const id=await scope(s)
    active(s)
    await db.credentials.delete(id)
    active(s)
  })
}
