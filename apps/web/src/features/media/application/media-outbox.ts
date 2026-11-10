import Dexie,{type Table} from 'dexie'
import { activeSession, requireSession, reauthenticate } from '../../identity/application/session'
import { jsonApi, putCiphertext, readCiphertext } from '../../identity/infrastructure/api'
import { importSigner, sign } from '../../identity/infrastructure/crypto'
import { sha } from '../../local-storage/infrastructure/cipher'
import {
  encryptMediaFile,decryptMediaChunks,validateMediaContract,
} from '../domain/media-crypto'
import type {
  MediaContract,MediaMetadata,StoredMediaChunk,MediaType,MediaPrivateFields,
} from '../domain/media-crypto'

export type MediaCaptureIntent={
  assignmentId:string;ownerAccountId:string;contributorAccountId:string
  policyRevision:number;policyHash:string
  mediaType:'video'|'audio';startedAt:number;finishedAt:number
}
export type SignedMediaCapture={
  contract:string;signature:string
}
export type MediaState='queued'|'retry'|'synced'|'conflict'
export type StoredMedia={
  key:string;accountId:string;mediaId:string
  operationId:string;createdAt:number;expiresAt:number
  mediaType:MediaType;plainBytes:number
  state:MediaState;lastError?:string
  contract:MediaContract;signature:string
  capture?:SignedMediaCapture // signed opaque assignment scope, never raw GPS
  chunks:StoredMediaChunk[] // each Blob is AES-GCM ciphertext, never raw media
}
export type CloudMedia={
  mediaId:string;mediaType:MediaType;plainBytes:number;expiresAt:number
}
export type MediaReceipt={
  mediaId:string;operationId:string;mediaType:MediaType;expiresAt:number
  chunks:Array<{chunkId:string;index:number;sha256:string;bytes:number}>
  receiptHash:string
}
class MediaDb extends Dexie{
  files!:Table<StoredMedia,string>
  constructor(){
    super('pb3-encrypted-media-outbox-v1')
    this.version(1).stores({
      files:'&key,accountId,[accountId+createdAt],[accountId+state]',
    })
  }
}
const db=new MediaDb()
function same(session:ReturnType<typeof requireSession>):void{
  if(activeSession.value!==session)throw Error('identity.account_changed')
}
function apiPath(mediaId:string):string{
  return '/media/v1/'+encodeURIComponent(mediaId)
}
export async function verifyReceipt(contract:MediaContract,receipt:MediaReceipt):Promise<void>{
  const publicReceipt={
    mediaId:contract.mediaId,
    operationId:contract.operationId,
    mediaType:contract.mediaType,
    expiresAt:contract.expiresAt,
    chunks:contract.chunks.map(c=>({
      chunkId:c.chunkId,index:c.index,sha256:c.sha256,bytes:c.bytes,
    })),
  }
  if(!receipt||JSON.stringify({...publicReceipt,receiptHash:receipt.receiptHash})
      !==JSON.stringify(receipt)
    ||receipt.receiptHash!==await sha(
      new TextEncoder().encode(JSON.stringify(publicReceipt))))
    throw Error('media.receipt_invalid')
}

/**
 * The selected file never enters OS gallery from our code and no plaintext
 * filename, MIME or content is persisted. Offline creation is durable before
 * an optional network flush; an unapproved quota cannot erase the local row.
 */
export async function enqueueEncryptedMedia(
  file:File,capture?:MediaCaptureIntent,privateFields:MediaPrivateFields={},
):Promise<string>{
  const session=requireSession()
  const createdAt=Date.now()
  const expiresAt=createdAt+13*86400000
  const {contract,chunks}=await encryptMediaFile(
    file,session.pkg,expiresAt,()=>same(session),
    privateFields,capture?.startedAt??createdAt)
  same(session)
  const signed=JSON.stringify(contract)
  const signature=await sign(session.device.deviceKey,'pb3.media.v1\n'+signed)
  let proof:SignedMediaCapture|undefined
  if(capture){
    if(capture.contributorAccountId!==session.accountId
      ||capture.mediaType!==contract.mediaType
      ||capture.ownerAccountId===session.accountId
      ||!Number.isSafeInteger(capture.policyRevision)
      ||capture.policyRevision<2||capture.policyRevision>1001
      ||!/^[a-f0-9]{64}$/.test(capture.policyHash)
      ||!Number.isSafeInteger(capture.startedAt)
      ||!Number.isSafeInteger(capture.finishedAt)
      ||capture.finishedAt<=capture.startedAt
      ||capture.finishedAt-capture.startedAt>3*60*1000
      ||capture.finishedAt>Date.now()+120000)
      throw Error('media.invalid_capture_intent')
    const contractHash=await sha(new TextEncoder().encode(signed))
    const captureContract=JSON.stringify({
      version:1,assignmentId:capture.assignmentId,
      ownerAccountId:capture.ownerAccountId,
      contributorAccountId:session.accountId,
      policyRevision:capture.policyRevision,policyHash:capture.policyHash,
      mediaId:contract.mediaId,mediaContractHash:contractHash,
      mediaType:contract.mediaType,
      startedAt:capture.startedAt,finishedAt:capture.finishedAt,
    })
    const captureSignature=await sign(
      await importSigner(session.pkg.accountPkcs8),
      'pb3.assignment-media-capture.v1\n'+captureContract)
    proof={contract:captureContract,signature:captureSignature}
  }
  same(session)
  const stored:StoredMedia={
    key:session.accountId+'/'+contract.mediaId,
    accountId:session.accountId,
    mediaId:contract.mediaId,operationId:contract.operationId,
    createdAt,expiresAt,mediaType:contract.mediaType,
    plainBytes:contract.plainBytes,
    state:'queued',contract,signature,capture:proof,chunks,
  }
  await db.transaction('rw',db.files,async()=>{await db.files.put(stored)})
  void flushMediaOutbox()
  return contract.mediaId
}
export async function listLocalMedia():Promise<StoredMedia[]>{
  const session=requireSession()
  return db.files.where('accountId').equals(session.accountId)
    .reverse().sortBy('createdAt')
}
export async function listCloudMedia(after?:string):Promise<{
  items:CloudMedia[];nextCursor:string|null
}>{
  const session=requireSession()
  if(!session.online)throw Error('identity.offline')
  const path=after?'/media/v1?after='+encodeURIComponent(after):'/media/v1'
  const result=await jsonApi<{items:CloudMedia[];nextCursor:string|null}>(path)
  same(session)
  return result
}
export async function readLocalMedia(mediaId:string):Promise<{
  blob:Blob;metadata:MediaMetadata
}>{
  const session=requireSession()
  const item=await db.files.get(session.accountId+'/'+mediaId)
  if(!item||item.expiresAt<=Date.now())throw Error('media.not_available')
  return decryptMediaChunks(session.pkg,item.contract,
    item.chunks.map(c=>c.blob),()=>same(session))
}
export async function readCloudMedia(mediaId:string):Promise<{
  blob:Blob;metadata:MediaMetadata
}>{
  const session=requireSession()
  if(!session.online)throw Error('identity.offline')
  const response=await jsonApi<{
    mediaId:string;contract:string;signature:string;receipt:MediaReceipt
  }>(apiPath(mediaId)+'/manifests')
  same(session)
  if(response.mediaId!==mediaId
    ||typeof response.contract!=='string'||response.contract.length>80000
    ||typeof response.signature!=='string')
    throw Error('media.manifest_invalid')
  const contract=JSON.parse(response.contract) as MediaContract
  validateMediaContract(contract,{accountId:session.accountId,mediaId})
  if(contract.expiresAt<=Date.now())throw Error('media.expired')
  await verifyReceipt(contract,response.receipt)
  const ciphertext:Blob[]=[]
  for(const part of contract.chunks){
    same(session)
    const result=await readCiphertext(
      apiPath(mediaId)+'/chunks/'+encodeURIComponent(part.chunkId))
    if(result.blob.size!==part.bytes || result.digest!==part.sha256
      ||await sha(new Uint8Array(await result.blob.arrayBuffer()))!==part.sha256)
      throw Error('media.chunk_corrupt')
    ciphertext.push(result.blob)
  }
  same(session)
  // Every individual SHA and AES-GCM AAD is authenticated before this
  // method exposes any plaintext to the application.
  return decryptMediaChunks(session.pkg,contract,ciphertext,()=>same(session))
}
let running:Promise<void>|null=null
let rerun=false
export function flushMediaOutbox():Promise<void>{
  if(running){rerun=true;return running}
  running=(async()=>{
    do{
      rerun=false
      await flushPass()
    }while(rerun&&activeSession.value?.online&&navigator.onLine)
  })().finally(()=>{running=null})
  return running
}
async function flushPass():Promise<void>{
  const session=activeSession.value
  if(!session?.online||!navigator.onLine)return
  const rows=await db.files.where('accountId').equals(session.accountId).toArray()
  for(const row of rows.filter(x=>x.state==='queued'||x.state==='retry')){
    if(activeSession.value!==session)return
    if(row.expiresAt<=Date.now()){
      await db.files.update(row.key,{
        state:'conflict',lastError:'media.expired',
      })
      continue
    }
    try{
      validateMediaContract(row.contract,{
        accountId:session.accountId,mediaId:row.mediaId,
      })
      const accepted=await jsonApi<{state:'active'|'pending';receipt?:MediaReceipt}>(
        '/media/v1/reserve','POST',{
          contract:JSON.stringify(row.contract),signature:row.signature,
        })
      if(accepted.state==='active'){
        if(!accepted.receipt)throw Error('media.receipt_invalid')
        await verifyReceipt(row.contract,accepted.receipt)
      }else if(accepted.state==='pending'){
        for(const part of row.chunks){
          same(session)
          await putCiphertext(
            apiPath(row.mediaId)+'/chunks/'+encodeURIComponent(part.chunkId),
            part.blob)
        }
        const finish=await jsonApi<{receipt:MediaReceipt}>(
          apiPath(row.mediaId)+'/finalize','POST',
          {operationId:row.operationId})
        await verifyReceipt(row.contract,finish.receipt)
      }else throw Error('media.reserve_invalid')
      same(session)
      await db.files.update(row.key,{state:'synced',lastError:undefined})
    }catch(error){
      const reason=error instanceof Error?error.message:'media.network_error'
      await db.files.update(row.key,{
        state:/^api\.http_(403|409|410|413|422)$/.test(reason)
          ?'conflict':'retry',
        lastError:/^api\.http_\d+$/.test(reason)?reason:'media.retry_required',
      })
      if(!navigator.onLine)return
    }
  }
}
export async function synchronizeMedia():Promise<void>{
  if(!activeSession.value?.online)await reauthenticate()
  await flushMediaOutbox()
}
export function attachMediaOutboxLifecycle():()=>void{
  const run=()=>{void flushMediaOutbox()}
  window.addEventListener('online',run)
  document.addEventListener('visibilitychange',run)
  run()
  return()=>{
    window.removeEventListener('online',run)
    document.removeEventListener('visibilitychange',run)
  }
}
