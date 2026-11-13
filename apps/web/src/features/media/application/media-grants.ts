import Dexie,{type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import {jsonApi,readCiphertext} from '../../identity/infrastructure/api'
import {
  b64,unb64,random,exchangeKey,exportECDHPublic,
  importSigner,importSpki,sign,verify,withTransientOwnerDEK,
} from '../../identity/infrastructure/crypto'
import {sha} from '../../local-storage/infrastructure/cipher'
import {
  ensureOwnExchangeKey,pinnedPeer,
} from '../../sharing/key-directory'
import {listLocalMedia,verifyReceipt} from './media-outbox'
import type {MediaReceipt} from './media-outbox'
import {
  decryptMediaChunksWithDEK,validateMediaContract,
} from '../domain/media-crypto'
import type {MediaContract,MediaMetadata,MediaType} from '../domain/media-crypto'

const enc=new TextEncoder()
const GRANT_DOMAIN='pb3.media-grant.v1\n'
const SCOPED_GRANT_DOMAIN='pb3.media-grant.v2\n'
const REVOKE_DOMAIN='pb3.media-revoke.v1\n'
const URI='/media-shares/v1'
/**
 * The backend enforces `expiresAt <= server_now + 24h`. Signing the
 * client-side exact +24h boundary is rejected if the device clock leads
 * the server by even a millisecond. Reserve five minutes for ordinary
 * clock drift, request latency and encryption/signing; never widen the
 * server's TTL or alter an already-signed grant during retry.
 *
 * This is a bounded mitigation, not authoritative time sync: devices
 * whose clocks are more than five minutes fast may still receive 422.
 */
export const MEDIA_GRANT_MAX_TTL_MS=86400000
export const MEDIA_GRANT_CLOCK_MARGIN_MS=5*60000
export function mediaGrantExpiry(
  mediaExpiresAt:number,createdAtMs:number,assignmentAccessUntil?:number|null,
):number{
  if(!Number.isSafeInteger(createdAtMs)||createdAtMs<=0
    ||!Number.isSafeInteger(mediaExpiresAt)||mediaExpiresAt<=0
    ||assignmentAccessUntil!=null
      &&(!Number.isSafeInteger(assignmentAccessUntil)
        ||assignmentAccessUntil<=0))
    throw Error('media_grant.invalid_expiry_bounds')
  const expiresAt=Math.min(
    mediaExpiresAt,
    createdAtMs+MEDIA_GRANT_MAX_TTL_MS-MEDIA_GRANT_CLOCK_MARGIN_MS,
    assignmentAccessUntil??Number.POSITIVE_INFINITY,
  )
  if(expiresAt<=createdAtMs)
    throw Error('media_grant.assignment_access_expired')
  return expiresAt
}
export type MediaEnvelope={
  ephemeralSpki:string;salt:string;iv:string;ciphertext:string
}
export type MediaGrantContract={
  version:1|2;grantId:string;mediaId:string
  ownerAccountId:string;recipientAccountId:string
  assignmentId?:string
  recipientKeyDigest:string;mediaContractHash:string
  scope:'read';expiresAt:number;envelope:MediaEnvelope
}
export type OutgoingMediaGrant={
  id:string;ownerAccountId:string;recipientAccountId:string
  mediaId:string;contract:string;signature:string
  state:'queued'|'retry'|'sent'|'conflict';lastError?:string
}
export type ReceivedMediaGrant={
  grantId:string;mediaId:string;ownerAccountId:string
  mediaType:MediaType;expiresAt:number
}
type RecipientDetail={
  grantId:string;mediaId:string;ownerAccountId:string
  ownerAccountSpki:string;expiresAt:number
  contract:string;signature:string
  mediaContract:string;receipt:MediaReceipt
}
class MediaGrantDb extends Dexie{
  grants!:Table<OutgoingMediaGrant,string>
  constructor(){
    super('pb3-encrypted-media-grant-outbox-v1')
    this.version(1).stores({
      grants:'&id,ownerAccountId,recipientAccountId,state',
    })
  }
}
const db=new MediaGrantDb()
function same(session:ReturnType<typeof requireSession>):void{
  if(activeSession.value!==session)throw Error('identity.changed')
}
function wrappingInfo(scope:{
  ownerAccountId:string;recipientAccountId:string
  mediaId:string;grantId:string;expiresAt:number;mediaContractHash:string
  assignmentId?:string
}):string{
  const {assignmentId,...base}=scope
  return assignmentId
    ?'pb3.media-recipient-dek.v2\n'+JSON.stringify({
      version:2,scope:'read',...base,assignmentId,
    })
    :'pb3.media-recipient-dek.v1\n'+JSON.stringify({
      version:1,scope:'read',...base,
    })
}
export function parseMediaGrantContract(input:unknown):MediaGrantContract{
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw Error('media_grant.invalid_scope')
  const c=input as MediaGrantContract
  if(Object.keys(c).sort().join('|')!==[
    'version','grantId','mediaId','ownerAccountId','recipientAccountId',
    ...(c.version===2?['assignmentId']:[]),
    'recipientKeyDigest','mediaContractHash','scope','expiresAt','envelope',
  ].sort().join('|')
    ||(c.version!==1&&c.version!==2)||c.scope!=='read'
    ||(c.version===2
      ?typeof c.assignmentId!=='string'
        ||!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(c.assignmentId)
      :c.assignmentId!==undefined)
    ||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=0
    ||!/^([0-9a-f]{8}-[0-9a-f-]{27,})$/.test(c.grantId)
    ||!/^([0-9a-f]{8}-[0-9a-f-]{27,})$/.test(c.mediaId)
    ||!/^([0-9a-f]{8}-[0-9a-f-]{27,})$/.test(c.ownerAccountId)
    ||!/^([0-9a-f]{8}-[0-9a-f-]{27,})$/.test(c.recipientAccountId)
    ||!/^[a-f0-9]{64}$/.test(c.recipientKeyDigest)
    ||!/^[a-f0-9]{64}$/.test(c.mediaContractHash))
    throw Error('media_grant.invalid_scope')
  const envelope=c.envelope
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)
    ||Object.keys(envelope).sort().join('|')!=='ciphertext|ephemeralSpki|iv|salt'
    ||typeof envelope.ephemeralSpki!=='string'
    ||typeof envelope.salt!=='string'
    ||typeof envelope.iv!=='string'
    ||typeof envelope.ciphertext!=='string'
    ||unb64(envelope.salt,16).length!==16
    ||unb64(envelope.iv,12).length!==12
    ||unb64(envelope.ciphertext,48).length!==48)
    throw Error('media_grant.invalid_envelope')
  return c
}

/**
 * Called ONLY after a visible, independently fingerprint-confirmed recipient
 * has been explicitly selected; no ACL follows from assignment membership.
 */
export async function queueMediaRecipientGrant(
  mediaId:string,recipientAccountId:string,assignmentId?:string,
  maxExpiresAt?:number|null,
):Promise<string>{
  const session=requireSession()
  if(session.accountId===recipientAccountId)
    throw Error('media_grant.cannot_share_self')
  const peer=await pinnedPeer(recipientAccountId)
  const row=(await listLocalMedia()).find(x=>x.mediaId===mediaId)
  if(!row||row.state!=='synced'||row.expiresAt<=Date.now())
    throw Error('media_grant.media_must_be_synced')
  validateMediaContract(row.contract,{
    accountId:session.accountId,mediaId,
  })
  const grantId=crypto.randomUUID()
  const mediaContractHash=await sha(enc.encode(JSON.stringify(row.contract)))
  // Sample once, before expensive crypto. Do not sign the backend's
  // exact +24h upper boundary; it is based on independent server time.
  const createdAtMs=Date.now()
  const expiresAt=mediaGrantExpiry(
    row.expiresAt,createdAtMs,assignmentId?maxExpiresAt:null,
  )
  const scope={
    ownerAccountId:session.accountId,recipientAccountId,
    mediaId,grantId,expiresAt,mediaContractHash,
    ...(assignmentId?{assignmentId}:{}),
  }
  const info=wrappingInfo(scope)
  const pair=await crypto.subtle.generateKey(
    {name:'ECDH',namedCurve:'P-256'},true,['deriveBits'])
  const ephemeralSpki=await exportECDHPublic(pair.publicKey)
  const salt=random(16),iv=random(12)
  const derived=await exchangeKey(pair.privateKey,peer.exchangeSpki,info,salt)
  const ciphertext=await withTransientOwnerDEK(
    session.pkg,mediaId,String(row.expiresAt),row.contract.wrappedDEK,
    async raw=>b64(await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:enc.encode(info),tagLength:128,
    },derived,raw)))
  const contract:MediaGrantContract={
    version:assignmentId?2:1,grantId,mediaId,
    ownerAccountId:session.accountId,recipientAccountId,
    ...(assignmentId?{assignmentId}:{}),
    recipientKeyDigest:peer.descriptorHash,mediaContractHash,
    scope:'read',expiresAt,
    envelope:{ephemeralSpki,salt:b64(salt),iv:b64(iv),ciphertext},
  }
  const json=JSON.stringify(contract)
  const signature=await sign(await importSigner(session.pkg.accountPkcs8),
    (assignmentId?SCOPED_GRANT_DOMAIN:GRANT_DOMAIN)+json)
  same(session)
  await db.grants.put({
    id:grantId,ownerAccountId:session.accountId,
    recipientAccountId,mediaId,contract:json,signature,state:'queued',
  })
  void flushMediaGrants()
  return grantId
}
export async function listOutgoingMediaGrants():Promise<OutgoingMediaGrant[]>{
  const session=requireSession()
  return db.grants.where('ownerAccountId').equals(session.accountId).toArray()
}

let running:Promise<void>|null=null
let rerun=false
export function flushMediaGrants():Promise<void>{
  if(running){rerun=true;return running}
  running=(async()=>{
    do{
      rerun=false;await flushPass()
    }while(rerun&&activeSession.value?.online&&navigator.onLine)
  })().finally(()=>{running=null})
  return running
}
async function flushPass():Promise<void>{
  const session=activeSession.value
  if(!session?.online||!navigator.onLine)return
  const grants=await db.grants.where('ownerAccountId')
    .equals(session.accountId).toArray()
  for(const g of grants.filter(x=>x.state==='queued'||x.state==='retry')){
    if(activeSession.value!==session)return
    try{
      await jsonApi(URI+'/grants','POST',{
        contract:g.contract,signature:g.signature,
      })
      same(session)
      await db.grants.update(g.id,{state:'sent',lastError:undefined})
    }catch(error){
      const reason=error instanceof Error?error.message:'media_grant.network_error'
      await db.grants.update(g.id,{
        state:/^api\.http_(401|403|409|410|422)$/.test(reason)
          ?'conflict':'retry',
        lastError:/^api\.http_\d+$/.test(reason)
          ?reason:'media_grant.retry_required',
      })
      if(!navigator.onLine)return
    }
  }
}
export function attachMediaGrantLifecycle():()=>void{
  const run=()=>{void flushMediaGrants()}
  window.addEventListener('online',run)
  document.addEventListener('visibilitychange',run)
  return()=>{
    window.removeEventListener('online',run)
    document.removeEventListener('visibilitychange',run)
  }
}
export async function listReceivedMediaGrants():Promise<ReceivedMediaGrant[]>{
  const session=requireSession()
  if(!session.online)throw Error('media_grant.online_acl_required')
  const result=await jsonApi<{items:ReceivedMediaGrant[]}>(
    URI+'/received')
  same(session)
  return result.items
}

export async function readReceivedMediaGrant(grantId:string):Promise<{
  blob:Blob;metadata:MediaMetadata
}>{
  const session=requireSession()
  if(!session.online)throw Error('media_grant.online_acl_required')
  const detail=await jsonApi<RecipientDetail>(
    URI+'/grants/'+encodeURIComponent(grantId))
  same(session)
  if(!detail||detail.grantId!==grantId
    ||typeof detail.contract!=='string'
    ||typeof detail.signature!=='string'
    ||typeof detail.mediaContract!=='string'
    ||detail.mediaContract.length>80000)
    throw Error('media_grant.invalid_scope')
  const contract=parseMediaGrantContract(JSON.parse(detail.contract))
  if(JSON.stringify(contract)!==detail.contract
    ||contract.grantId!==grantId
    ||contract.mediaId!==detail.mediaId
    ||contract.ownerAccountId!==detail.ownerAccountId
    ||contract.recipientAccountId!==session.accountId
    ||contract.expiresAt!==detail.expiresAt
    ||contract.expiresAt<=Date.now())
    throw Error('media_grant.invalid_scope')
  const peer=await pinnedPeer(contract.ownerAccountId)
  if(peer.accountSpki!==detail.ownerAccountSpki
    ||!await verify(await importSpki(peer.accountSpki),
      (contract.version===2?SCOPED_GRANT_DOMAIN:GRANT_DOMAIN)
        +detail.contract,detail.signature))
    throw Error('media_grant.unauthenticated_owner')
  const own=await ensureOwnExchangeKey()
  same(session)
  if(own.directory.descriptorHash!==contract.recipientKeyDigest)
    throw Error('media_grant.wrong_recipient_key')
  if(await sha(enc.encode(detail.mediaContract))!==contract.mediaContractHash)
    throw Error('media_grant.media_contract_changed')
  const media=JSON.parse(detail.mediaContract) as MediaContract
  validateMediaContract(media,{
    accountId:contract.ownerAccountId,mediaId:contract.mediaId,
  })
  if(JSON.stringify(media)!==detail.mediaContract
    ||media.expiresAt<=Date.now()
    ||contract.expiresAt>media.expiresAt)
    throw Error('media_grant.invalid_media_contract')
  await verifyReceipt(media,detail.receipt)
  const info=wrappingInfo({
    ownerAccountId:contract.ownerAccountId,
    recipientAccountId:contract.recipientAccountId,
    mediaId:contract.mediaId,grantId,
    expiresAt:contract.expiresAt,
    mediaContractHash:contract.mediaContractHash,
    ...(contract.version===2?{assignmentId:contract.assignmentId}:{}),
  })
  const env=contract.envelope
  const derived=await exchangeKey(
    own.privateKey,env.ephemeralSpki,info,unb64(env.salt,16))
  const bytes=new Uint8Array(await crypto.subtle.decrypt({
    name:'AES-GCM',iv:unb64(env.iv,12),
    additionalData:enc.encode(info),tagLength:128,
  },derived,unb64(env.ciphertext,48)))
  if(bytes.length!==32){bytes.fill(0);throw Error('media_grant.invalid_dek')}
  let dek:CryptoKey
  try{
    dek=await crypto.subtle.importKey('raw',bytes,
      {name:'AES-GCM'},false,['decrypt'])
  }finally{bytes.fill(0)}
  const chunks:Blob[]=[]
  for(const chunk of media.chunks){
    same(session)
    // Explicit server re-authorization per physical chunk, including
    // after a pending revoke or underlying expiration.
    const response=await readCiphertext(
      URI+'/grants/'+encodeURIComponent(grantId)
        +'/chunks/'+encodeURIComponent(chunk.chunkId))
    if(response.blob.size!==chunk.bytes
      ||response.digest!==chunk.sha256
      ||await sha(new Uint8Array(await response.blob.arrayBuffer()))!==chunk.sha256)
      throw Error('media_grant.ciphertext_corrupt')
    chunks.push(response.blob)
  }
  same(session)
  return decryptMediaChunksWithDEK(media,chunks,dek,()=>same(session))
}
export async function revokeMediaGrant(grantId:string):Promise<void>{
  const session=requireSession()
  if(!session.online)throw Error('media_grant.online_acl_required')
  const row=await db.grants.get(grantId)
  if(!row||row.ownerAccountId!==session.accountId||row.state!=='sent')
    throw Error('media_grant.not_confirmed')
  const command=JSON.stringify({
    version:1,grantId,operationId:crypto.randomUUID(),
  })
  const signature=await sign(await importSigner(session.pkg.accountPkcs8),
    REVOKE_DOMAIN+command)
  await jsonApi(URI+'/grants/'+encodeURIComponent(grantId)+'/revoke',
    'POST',{command,signature})
  same(session)
  await db.grants.update(grantId,{
    state:'conflict',lastError:'media_grant.revoked',
  })
}
