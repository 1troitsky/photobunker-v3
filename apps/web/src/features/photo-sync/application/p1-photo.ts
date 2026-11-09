import Dexie, { type Table } from 'dexie'
import { activeSession, requireSession, signPhotoContract } from '../../identity/application/session'
import { jsonApi, putCiphertext, readCiphertext } from '../../identity/infrastructure/api'
import { unwrapAssetDEK, wrapAssetDEK } from '../../identity/infrastructure/crypto'
import { decryptAsset, encryptAsset, sha } from '../../local-storage/infrastructure/cipher'
import type { CipherManifest, Scope } from '../../local-storage/domain/contracts'

export type PhotoStatus = 'queued'|'retry'|'synced'|'conflict'
export type StoredAsset = {
  assetId:string
  kind:'master'|'metadata'
  manifest:CipherManifest
  blob:Blob // ciphertext ONLY
  sha256:string
}
export type StoredPhoto = {
  key:string
  accountId:string
  photoId:string
  operationId:string
  createdAt:number
  expiresAt:number
  state:PhotoStatus
  lastError?:string
  assets:StoredAsset[]
}

class PhotoDatabase extends Dexie {
  photos!:Table<StoredPhoto,string>
  constructor(){
    super('pb3-encrypted-photo-outbox-v1')
    this.version(1).stores({
      photos:'&key, accountId, [accountId+createdAt], [accountId+state]',
    })
  }
}
const db=new PhotoDatabase()
const enc=new TextEncoder()

function scope():Scope {
  const s=requireSession()
  return {accountId:s.accountId,deviceId:s.deviceId,generation:0}
}
function requireSame(session:ReturnType<typeof requireSession>):void {
  if(activeSession.value!==session)throw new Error('identity.account_changed')
}
function path(photoId:string):string {
  return '/photos/v1/'+encodeURIComponent(photoId)
}
async function makeAsset(kind:'master'|'metadata',plaintext:Blob,
  photoId:string,expiresAt:number):Promise<StoredAsset> {
  const session=requireSession()
  const assetId=crypto.randomUUID()
  const wrapped=await wrapAssetDEK(session.pkg,assetId,String(expiresAt))
  const key=await unwrapAssetDEK(session.pkg,assetId,String(expiresAt),wrapped)
  const localKey=[session.accountId,photoId,assetId,crypto.randomUUID()].join('/')
  const encrypted=await encryptAsset(
    scope(),photoId,assetId,kind,1,expiresAt,plaintext,key,wrapped,'idb-blob',localKey,
    ()=>requireSame(session),
  )
  return {
    assetId,kind,manifest:encrypted.manifest,blob:encrypted.blob,
    sha256:await sha(new Uint8Array(await encrypted.blob.arrayBuffer())),
  }
}

export async function captureEncrypted(jpeg:Blob):Promise<StoredPhoto> {
  const session=requireSession()
  if (jpeg.type!=='image/jpeg'||jpeg.size<128||jpeg.size>10*1024*1024)
    throw new Error('capture.invalid_jpeg')
  const photoId=crypto.randomUUID()
  const operationId=crypto.randomUUID()
  const createdAt=Date.now()
  // 13 days is an intentional conservative buffer against the initial 14-day
  // Free cap and unsynchronized browser clocks. Authoritative TTL needs P1 clock sync.
  const expiresAt=createdAt+13*86400000
  const metadata= new Blob([enc.encode(JSON.stringify({
    type:'image/jpeg',capturedAt:createdAt,source:'camera',version:1,
  }))],{type:'application/json'})
  const main=await makeAsset('master',jpeg,photoId,expiresAt)
  const detail=await makeAsset('metadata',metadata,photoId,expiresAt)
  requireSame(session)
  const stored:StoredPhoto={
    key:session.accountId+'/'+photoId,accountId:session.accountId,
    photoId,operationId,createdAt,expiresAt,state:'queued',assets:[main,detail],
  }
  // Durable, atomic ciphertext before any attempt to contact the server.
  await db.transaction('rw',db.photos,async()=>{await db.photos.put(stored)})
  void flushOutbox()
  return stored
}

export async function listLocalPhotos():Promise<StoredPhoto[]> {
  const s=requireSession()
  return db.photos.where('accountId').equals(s.accountId).reverse().sortBy('createdAt')
}

function serverManifest(m:CipherManifest):Omit<CipherManifest,'backend'|'storageKey'> {
  const {backend: _backend,storageKey:_storageKey,...server}=m
  void _backend
  void _storageKey
  return server
}

export function signedPhotoContract(p:StoredPhoto):string {
  const assets=p.assets.map(a=>({
    assetId:a.assetId,kind:a.kind,revision:1,bytes:a.blob.size,
    sha256:a.sha256,manifest:serverManifest(a.manifest),
  })).sort((a,b)=>a.assetId.localeCompare(b.assetId))
  return JSON.stringify({
    version:1,photoId:p.photoId,operationId:p.operationId,
    expiresAt:p.expiresAt,assets,
  })
}

let running:Promise<void>|null=null
let rerunRequested=false
export function flushOutbox():Promise<void> {
  if(running){
    // A later authenticated session may have arrived during the first upload.
    // Queue a new pass instead of silently returning the stale in-flight one.
    rerunRequested=true
    return running
  }
  running=(async()=>{
    do {
      rerunRequested=false
      await flushLoop()
    } while(rerunRequested && activeSession.value?.online && navigator.onLine)
  })().finally(()=>{running=null})
  return running
}
async function flushLoop():Promise<void> {
  const s=activeSession.value
  if(!s?.online||typeof navigator!=='undefined'&&!navigator.onLine)return
  const photos=await db.photos.where('accountId').equals(s.accountId).toArray()
  for(const row of photos.filter(p=>p.state!=='synced'&&p.state!=='conflict')){
    if(activeSession.value!==s)return
    try{
      const contract=signedPhotoContract(row)
      const signature=await signPhotoContract(contract)
      const reserve=await jsonApi<{state:string}>( '/photos/v1/reserve','POST',{contract,signature})
      if(reserve.state!=='active'){
        for(const asset of row.assets){
          requireSame(s)
          await putCiphertext(path(row.photoId)+'/objects/'+asset.assetId,asset.blob)
        }
        await jsonApi(path(row.photoId)+'/finalize','POST',{operationId:row.operationId})
      }
      requireSame(s)
      await db.photos.update(row.key,{state:'synced',lastError:undefined})
    }catch(error){
      // Never delete ciphertext on failed HTTP, offline, quota or session reset.
      const failure=error instanceof Error?error.message:'sync.network_error'
      const conflict=/http_(401|403|409|410|413|422)/.test(failure)
      await db.photos.update(row.key,{
        state:conflict?'conflict':'retry',
        lastError:/^api\.http_\d+$/.test(failure)?failure:'sync.retry_required',
      })
      if(!navigator.onLine)return
    }
  }
}
export function attachOutboxLifecycle():()=>void {
  const run=()=>{void flushOutbox()}
  window.addEventListener('online',run)
  document.addEventListener('visibilitychange',run)
  run()
  return ()=>{window.removeEventListener('online',run);document.removeEventListener('visibilitychange',run)}
}

export async function readLocalPhoto(photoId:string):Promise<Blob> {
  const s=requireSession()
  const row=await db.photos.get(s.accountId+'/'+photoId)
  if(!row||row.expiresAt<=Date.now())throw new Error('photo.not_available')
  const asset=row.assets.find(a=>a.kind==='master')
  if(!asset)throw new Error('photo.missing_master')
  const key=await unwrapAssetDEK(s.pkg,asset.assetId,String(row.expiresAt),asset.manifest.wrappedDEK)
  return decryptAsset(asset.manifest,asset.blob,key,scope(),()=>requireSame(s))
}

export interface CloudPhoto {photoId:string;expiresAt:number;metadataAssetId:string|null}
export async function listCloudPhotos(after?:string):Promise<{items:CloudPhoto[];nextCursor:string|null}> {
  const s=requireSession()
  if(!s.online)throw new Error('identity.offline')
  const query=after?'?after='+encodeURIComponent(after):''
  return jsonApi('/photos/v1'+query)
}

type CloudManifest={
  photoId:string;expiresAt:number
  assets:Array<{
    assetId:string;kind:string;revision:number;bytes:number;sha256:string
    manifest:Omit<CipherManifest,'backend'|'storageKey'>
  }>
}
export async function readCloudPhoto(photoId:string):Promise<Blob> {
  const s=requireSession()
  if(!s.online)throw new Error('identity.offline')
  const result=await jsonApi<CloudManifest>(path(photoId)+'/manifests')
  if(result.photoId!==photoId||result.expiresAt<=Date.now())throw new Error('photo.expired')
  const asset=result.assets.find(a=>a.kind==='master')
  if(!asset)throw new Error('photo.no_master')
  const download=await readCiphertext(path(photoId)+'/objects/'+asset.assetId)
  const digest=await sha(new Uint8Array(await download.blob.arrayBuffer()))
  if(digest!==asset.sha256||download.digest!==asset.sha256||download.blob.size!==asset.bytes)
    throw new Error('photo.invalid_ciphertext')
  const manifest:CipherManifest={
    ...asset.manifest, backend:'idb-blob',
    storageKey:[s.accountId,photoId,asset.assetId,asset.assetId].join('/'),
  }
  const key=await unwrapAssetDEK(s.pkg,asset.assetId,String(result.expiresAt),manifest.wrappedDEK)
  return decryptAsset(manifest,download.blob,key,scope(),()=>requireSame(s))
}
