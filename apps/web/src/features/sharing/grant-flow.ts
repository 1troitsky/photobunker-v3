import Dexie, { type Table } from 'dexie'
import { activeSession, requireSession, reauthenticate } from '../../identity/application/session'
import { jsonApi, readCiphertext } from '../../identity/infrastructure/api'
import {
  b64, unb64, random, exchangeKey, exportECDHPublic,
  importSigner, sign, verify, importSpki, withTransientOwnerDEK,
} from '../../identity/infrastructure/crypto'
import { decryptAsset, sha } from '../../local-storage/infrastructure/cipher'
import type { CipherManifest } from '../../local-storage/domain/contracts'
import { listLocalPhotos } from '../../photo-sync/application/p1-photo'
import { ensureOwnExchangeKey, pinnedPeer, inspectPeer } from './key-directory'

const encoder=new TextEncoder()
const grantDomain='pb3.photo-grant.v1\n'
const revokeDomain='pb3.photo-revoke.v1\n'
const path='/shares/v1'

export type RecipientPhoto={
  grantId:string;photoId:string;ownerAccountId:string;expiresAt:number
}
export type Envelope={
  assetId:string;ephemeralSpki:string;salt:string;iv:string;ciphertext:string
}
export type GrantContract={
  version:1;grantId:string;photoId:string
  ownerAccountId:string;recipientAccountId:string
  recipientKeyDigest:string;scope:'read';expiresAt:number
  assets:Envelope[]
}
export type OutgoingGrant={
  id:string;ownerAccountId:string;recipientAccountId:string;photoId:string
  contract:string;signature:string;state:'queued'|'retry'|'sent'|'conflict'
  lastError?:string
}

class GrantOutbox extends Dexie {
  grants!:Table<OutgoingGrant,string>
  constructor(){
    super('pb3-encrypted-grant-outbox-v1')
    this.version(1).stores({grants:'&id, ownerAccountId, recipientAccountId, state'})
  }
}
const db=new GrantOutbox()

function still(s:ReturnType<typeof requireSession>):void {
  if(activeSession.value!==s)throw new Error('identity.changed')
}

function wrapInfo(context:{
  ownerAccountId:string;recipientAccountId:string;photoId:string;grantId:string
  assetId:string;expiresAt:number
}):string {
  return 'pb3.recipient-dek.v1\n'+JSON.stringify({
    version:1,scope:'read',...context,
  })
}

export async function queueRecipientGrant(photoId:string,recipientAccountId:string):Promise<string> {
  const s=requireSession()
  if(s.accountId===recipientAccountId)throw new Error('share.cannot_share_self')
  // Only explicitly, independently fingerprint-confirmed peers may receive keys.
  const peer=await pinnedPeer(recipientAccountId)
  const row=(await listLocalPhotos()).find(r=>r.photoId===photoId)
  if(!row || row.state!=='synced'||row.expiresAt<=Date.now()){
    throw new Error('share.photo_must_be_synced')
  }
  const grantId=crypto.randomUUID()
  const expiresAt=Math.min(row.expiresAt,Date.now()+86400000)
  const assets:Envelope[]=[]
  for(const asset of [...row.assets].sort((a,b)=>a.assetId.localeCompare(b.assetId))){
    still(s)
    const scope={
      ownerAccountId:s.accountId,recipientAccountId,photoId,grantId,
      assetId:asset.assetId,expiresAt,
    }
    const info=wrapInfo(scope)
    const ephemeral=await crypto.subtle.generateKey(
      {name:'ECDH',namedCurve:'P-256'},true,['deriveBits'])
    const ephemeralSpki=await exportECDHPublic(ephemeral.publicKey)
    const salt=random(16),iv=random(12)
    const derived=await exchangeKey(ephemeral.privateKey,peer.exchangeSpki,info,salt)
    const ciphertext=await withTransientOwnerDEK(
      s.pkg,asset.assetId,String(row.expiresAt),asset.manifest.wrappedDEK,
      async raw=>b64(await crypto.subtle.encrypt({
        name:'AES-GCM',iv,additionalData:encoder.encode(info),tagLength:128,
      },derived,raw)))
    assets.push({
      assetId:asset.assetId,ephemeralSpki,salt:b64(salt),
      iv:b64(iv),ciphertext,
    })
  }
  const contract:GrantContract={
    version:1,grantId,photoId,ownerAccountId:s.accountId,
    recipientAccountId,recipientKeyDigest:peer.descriptorHash,
    scope:'read',expiresAt,assets,
  }
  const json=JSON.stringify(contract)
  const signature=await sign(await importSigner(s.pkg.accountPkcs8),grantDomain+json)
  still(s)
  const draft:OutgoingGrant={
    id:grantId,ownerAccountId:s.accountId,recipientAccountId,photoId,
    contract:json,signature,state:'queued',
  }
  await db.transaction('rw',db.grants,async()=>{await db.grants.put(draft)})
  void flushRecipientGrants()
  return grantId
}

export async function listOutgoingGrants():Promise<OutgoingGrant[]> {
  const s=requireSession()
  return db.grants.where('ownerAccountId').equals(s.accountId).toArray()
}

let running:Promise<void>|null=null
let rerun=false
export function flushRecipientGrants():Promise<void> {
  if(running){rerun=true;return running}
  running=(async()=>{
    do{
      rerun=false
      await flushOnce()
    }while(rerun&&activeSession.value?.online&&navigator.onLine)
  })().finally(()=>{running=null})
  return running
}
async function flushOnce():Promise<void> {
  const s=activeSession.value
  if(!s?.online||!navigator.onLine)return
  const drafts=await db.grants.where('ownerAccountId').equals(s.accountId).toArray()
  for(const d of drafts.filter(x=>x.state==='queued'||x.state==='retry')){
    if(activeSession.value!==s)return
    try{
      await jsonApi(path+'/grants','POST',{contract:d.contract,signature:d.signature})
      still(s)
      await db.grants.update(d.id,{state:'sent',lastError:undefined})
    }catch(error){
      const message=error instanceof Error?error.message:'share.network_error'
      await db.grants.update(d.id,{
        state:/http_(401|403|409|410|422)/.test(message)?'conflict':'retry',
        lastError:/^api\.http_\d+$/.test(message)?message:'share.retry_required',
      })
      if(!navigator.onLine)return
    }
  }
}
export function attachShareLifecycle():()=>void {
  const run=()=>{void flushRecipientGrants()}
  window.addEventListener('online',run)
  document.addEventListener('visibilitychange',run)
  return()=>{window.removeEventListener('online',run);document.removeEventListener('visibilitychange',run)}
}

export async function listReceivedGrants():Promise<RecipientPhoto[]> {
  const s=requireSession()
  if(!s.online)throw new Error('share.online_acl_required')
  const response=await jsonApi<{items:RecipientPhoto[];nextCursor:string|null}>(path+'/received')
  still(s)
  return response.items
}

type ReceivedAsset={
  assetId:string;kind:string;bytes:number;sha256:string
  manifest:Omit<CipherManifest,'backend'|'storageKey'>
}
type ReceivedDetail={
  grantId:string;photoId:string;ownerAccountId:string;ownerAccountSpki:string
  expiresAt:number;contract:string;signature:string;assets:ReceivedAsset[]
}

export async function readReceivedPhoto(grantId:string):Promise<Blob> {
  const s=requireSession()
  if(!s.online)throw new Error('share.online_acl_required')
  const detail=await jsonApi<ReceivedDetail>(path+'/grants/'+encodeURIComponent(grantId))
  const contract=JSON.parse(detail.contract) as GrantContract
  if(contract.version!==1||contract.scope!=='read'
    ||contract.grantId!==grantId||contract.photoId!==detail.photoId
    ||contract.ownerAccountId!==detail.ownerAccountId
    ||contract.recipientAccountId!==s.accountId
    ||contract.expiresAt!==detail.expiresAt||contract.expiresAt<=Date.now()){
    throw new Error('share.invalid_signed_scope')
  }
  const peer=await pinnedPeer(contract.ownerAccountId)
  // Signed identity directory pinned to a fingerprint; no silent TOFU.
  if(peer.accountSpki!==detail.ownerAccountSpki
    ||!await verify(await importSpki(peer.accountSpki),
      grantDomain+detail.contract,detail.signature)){
    throw new Error('share.unauthenticated_owner')
  }
  const own=await ensureOwnExchangeKey()
  if(own.directory.descriptorHash!==contract.recipientKeyDigest)
    throw new Error('share.wrong_recipient_key')
  const master=detail.assets.find(a=>a.kind==='master')
  if(!master)throw new Error('share.missing_master')
  const envelope=contract.assets.find(e=>e.assetId===master.assetId)
  if(!envelope||contract.assets.length!==detail.assets.length)
    throw new Error('share.missing_asset_envelopes')

  const info=wrapInfo({
    ownerAccountId:contract.ownerAccountId,
    recipientAccountId:contract.recipientAccountId,
    photoId:contract.photoId,grantId,assetId:master.assetId,
    expiresAt:contract.expiresAt,
  })
  const wrappingKey=await exchangeKey(
    own.privateKey,envelope.ephemeralSpki,info,unb64(envelope.salt,16))
  const bytes=new Uint8Array(await crypto.subtle.decrypt({
    name:'AES-GCM',iv:unb64(envelope.iv,12),
    additionalData:encoder.encode(info),tagLength:128,
  },wrappingKey,unb64(envelope.ciphertext,48)))
  if(bytes.byteLength!==32){bytes.fill(0);throw new Error('share.invalid_dek')}
  let dek:CryptoKey
  try{
    dek=await crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['decrypt'])
  }finally{bytes.fill(0)}

  // Check active ACL at the server again on the actual physical object read.
  const downloaded=await readCiphertext(path+'/grants/'+encodeURIComponent(grantId)
    +'/objects/'+encodeURIComponent(master.assetId))
  if(downloaded.blob.size!==master.bytes
    ||await sha(new Uint8Array(await downloaded.blob.arrayBuffer()))!==master.sha256
    ||downloaded.digest!==master.sha256)throw new Error('share.ciphertext_corrupt')
  still(s)
  const manifest:CipherManifest={
    ...master.manifest,backend:'idb-blob',
    storageKey:[contract.ownerAccountId,contract.photoId,master.assetId,master.assetId].join('/'),
  }
  const clear=await decryptAsset(manifest,downloaded.blob,dek,
    {accountId:contract.ownerAccountId,deviceId:s.deviceId,generation:0},()=>still(s))
  still(s)
  return new Blob([await clear.arrayBuffer()],{type:'image/jpeg'})
}

export async function revokeOutgoingGrant(grantId:string):Promise<void> {
  const s=requireSession()
  if(!s.online)throw new Error('share.online_acl_required')
  const draft=await db.grants.get(grantId)
  if(!draft||draft.ownerAccountId!==s.accountId||draft.state!=='sent')
    throw new Error('share.not_confirmed')
  const command=JSON.stringify({version:1,grantId,operationId:crypto.randomUUID()})
  const signature=await sign(await importSigner(s.pkg.accountPkcs8),revokeDomain+command)
  await jsonApi(path+'/grants/'+encodeURIComponent(grantId)+'/revoke',
    'POST',{command,signature})
  still(s)
  await db.grants.update(grantId,{state:'conflict',lastError:'share.revoked'})
}

export async function candidateOwnerFingerprint(ownerId:string):Promise<{
  fingerprint:string;confirmed:boolean
}> {
  const {directory,confirmed}=await inspectPeer(ownerId)
  return {fingerprint:directory.safetyFingerprint,confirmed}
}
