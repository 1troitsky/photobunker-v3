import { wrapAssetDEK, unwrapAssetDEK, b64, unb64 } from '../../identity/infrastructure/crypto'
import type { PackageV2 } from '../../identity/infrastructure/crypto'
import { sha } from '../../local-storage/infrastructure/cipher'

export type MediaType='photo'|'video'|'audio'
export const MEDIA_CHUNK=1024*1024
export const MAX_MEDIA_BYTES=128*1024*1024
const encoder=new TextEncoder()
const decoder=new TextDecoder('utf-8',{fatal:true})
const allowed:Record<MediaType,string[]>={
  photo:['image/jpeg','image/png','image/webp'],
  video:['video/mp4','video/webm','video/quicktime'],
  audio:['audio/mp4','audio/mpeg','audio/webm','audio/wav','audio/x-wav',
    'audio/aac','audio/ogg'],
}
export type MediaChunkContract={
  chunkId:string;index:number;kind:'data'|'metadata'
  plainBytes:number;bytes:number;sha256:string;iv:string
}
export type MediaContract={
  version:1;accountId:string;mediaId:string;operationId:string
  mediaType:MediaType;expiresAt:number;chunkBytes:number
  plainBytes:number
  wrappedDEK:{iv:string;ciphertext:string}
  chunks:MediaChunkContract[]
}
export type StoredMediaChunk=MediaChunkContract & {blob:Blob}
export type MediaMetadata={
  version:1;fileName:string;mime:string;plainBytes:number;createdAt:number
}
function validate(cond:boolean,error:string):asserts cond{
  if(!cond)throw Error(error)
}
const isUUID=(s:unknown):s is string=>typeof s==='string'
  &&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(s)
const digest=/^[a-f0-9]{64}$/
function hexIV(value:string):Uint8Array<ArrayBuffer>{
  return unb64(value,12)
}
function context(contract:MediaContract,index:number,kind:'data'|'metadata',
  plainBytes:number):Uint8Array<ArrayBuffer>{
  return encoder.encode(JSON.stringify({
    v:1,alg:'AES-256-GCM',accountId:contract.accountId,
    mediaId:contract.mediaId,mediaType:contract.mediaType,
    expiresAt:contract.expiresAt,totalPlainBytes:contract.plainBytes,
    chunkBytes:contract.chunkBytes,totalChunks:contract.chunks.length,
    index,kind,plainBytes,
  }))
}
function mediaTypeForMime(mime:string):MediaType{
  for(const [kind,formats]of Object.entries(allowed))
    if(formats.includes(mime))return kind as MediaType
  throw Error('media.unsupported_mime')
}
export function validateMediaContract(c:MediaContract,expected?:{
  accountId:string;mediaId:string
}):void{
  validate(c!==null&&typeof c==='object'&&!Array.isArray(c)
    &&Object.keys(c).sort().join('|')===
      ['version','accountId','mediaId','operationId','mediaType','expiresAt',
        'chunkBytes','plainBytes','wrappedDEK','chunks'].sort().join('|'),
  'media.contract_fields')
  validate(c.version===1&&isUUID(c.accountId)
    &&isUUID(c.mediaId)&&isUUID(c.operationId)
    &&['photo','video','audio'].includes(c.mediaType)
    &&c.chunkBytes===MEDIA_CHUNK
    &&Number.isSafeInteger(c.plainBytes)
    &&c.plainBytes>=128&&c.plainBytes<=MAX_MEDIA_BYTES
    &&Number.isSafeInteger(c.expiresAt)&&c.expiresAt>0,
  'media.contract_invalid')
  if(expected)validate(c.accountId===expected.accountId
    &&c.mediaId===expected.mediaId,'media.wrong_identity')
  validate(c.wrappedDEK!==null&&typeof c.wrappedDEK==='object'
    &&Object.keys(c.wrappedDEK).sort().join('|')==='ciphertext|iv'
    &&typeof c.wrappedDEK.ciphertext==='string'
    &&unb64(c.wrappedDEK.ciphertext,48).length===48
    &&hexIV(c.wrappedDEK.iv).length===12,
  'media.wrapped_key_invalid')
  const dataCount=Math.ceil(c.plainBytes/MEDIA_CHUNK)
  validate(Array.isArray(c.chunks)&&c.chunks.length===dataCount+1,
    'media.chunk_count_invalid')
  const seen=new Set<string>()
  for(const [index,chunk]of c.chunks.entries()){
    const metadata=index===dataCount
    const expectedPlain=metadata?null:
      Math.min(MEDIA_CHUNK,c.plainBytes-index*MEDIA_CHUNK)
    validate(chunk!==null&&typeof chunk==='object'
      &&Object.keys(chunk).sort().join('|')===
        ['chunkId','index','kind','plainBytes','bytes','sha256','iv'].sort().join('|')
      &&isUUID(chunk.chunkId)&&!seen.has(chunk.chunkId)
      &&chunk.index===index
      &&chunk.kind===(metadata?'metadata':'data')
      &&Number.isSafeInteger(chunk.plainBytes)
      &&(metadata?(chunk.plainBytes>=2&&chunk.plainBytes<=4096)
        :chunk.plainBytes===expectedPlain)
      &&chunk.bytes===chunk.plainBytes+16
      &&typeof chunk.sha256==='string'&&digest.test(chunk.sha256)
      &&typeof chunk.iv==='string'&&hexIV(chunk.iv).length===12,
    'media.chunk_invalid')
    seen.add(chunk.chunkId)
  }
}

function metadataFor(file:File,mediaType:MediaType):MediaMetadata{
  validate(mediaTypeForMime(file.type)===mediaType,'media.mime_mismatch')
  const cleanName=file.name.trim()
  validate(cleanName.length>=1&&cleanName.length<=160
    &&!/[\x00-\x1f\x7f]/.test(cleanName),'media.filename_invalid')
  return {
    version:1,fileName:cleanName,mime:file.type,
    plainBytes:file.size,createdAt:Date.now(),
  }
}
export function parseMediaMetadata(raw:unknown,contract:MediaContract):MediaMetadata{
  validate(raw!==null&&typeof raw==='object'&&!Array.isArray(raw),
    'media.metadata_invalid')
  const m=raw as MediaMetadata
  validate(Object.keys(m).sort().join('|')==='createdAt|fileName|mime|plainBytes|version'
    &&m.version===1&&typeof m.fileName==='string'
    &&m.fileName.length>=1&&m.fileName.length<=160
    &&typeof m.mime==='string'
    &&mediaTypeForMime(m.mime)===contract.mediaType
    &&m.plainBytes===contract.plainBytes
    &&Number.isSafeInteger(m.createdAt),
  'media.metadata_invalid')
  return m
}

export async function encryptMediaFile(
  file:File,pkg:PackageV2,expiresAt:number,assertCurrent:()=>void,
):Promise<{contract:MediaContract;chunks:StoredMediaChunk[]}>{
  validate(file.size>=128&&file.size<=MAX_MEDIA_BYTES,'media.invalid_size')
  const mediaType=mediaTypeForMime(file.type)
  const meta=metadataFor(file,mediaType)
  const mediaId=crypto.randomUUID()
  const operationId=crypto.randomUUID()
  const wrappedDEK=await wrapAssetDEK(pkg,mediaId,String(expiresAt))
  const key=await unwrapAssetDEK(pkg,mediaId,String(expiresAt),wrappedDEK)
  const count=Math.ceil(file.size/MEDIA_CHUNK)
  const contract:MediaContract={
    version:1,accountId:pkg.accountId,mediaId,operationId,
    mediaType,expiresAt,chunkBytes:MEDIA_CHUNK,plainBytes:file.size,
    wrappedDEK,chunks:[],
  }
  // Allocate final chunk count before encryption: AAD binds the count.
  const chunks:StoredMediaChunk[]=[]
  for(let i=0;i<=count;i++){
    assertCurrent()
    const kind=i===count?'metadata':'data'
    const source=i===count
      ?new Blob([encoder.encode(JSON.stringify(meta))],{type:'application/json'})
      :file.slice(i*MEDIA_CHUNK,(i+1)*MEDIA_CHUNK)
    const clear=new Uint8Array(await source.arrayBuffer())
    validate(kind!=='metadata'||clear.length<=4096,'media.metadata_too_large')
    const iv=crypto.getRandomValues(new Uint8Array(12))
    const aad=encoder.encode(JSON.stringify({
      v:1,alg:'AES-256-GCM',accountId:contract.accountId,
      mediaId:contract.mediaId,mediaType:contract.mediaType,
      expiresAt:contract.expiresAt,totalPlainBytes:contract.plainBytes,
      chunkBytes:contract.chunkBytes,totalChunks:count+1,
      index:i,kind,plainBytes:clear.length,
    }))
    const encrypted=new Uint8Array(await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:aad,tagLength:128,
    },key,clear))
    clear.fill(0)
    assertCurrent()
    const blob=new Blob([encrypted],{type:'application/octet-stream'})
    chunks.push({
      chunkId:crypto.randomUUID(),index:i,kind,
      plainBytes:source.size,bytes:blob.size,sha256:await sha(encrypted),
      iv:b64(iv),blob,
    })
  }
  contract.chunks=chunks.map(({blob:_blob,...chunk})=>chunk)
  validateMediaContract(contract,{accountId:pkg.accountId,mediaId})
  return {contract,chunks}
}
export async function decryptMediaChunks(
  pkg:PackageV2,contract:MediaContract,
  chunks:readonly Blob[],assertCurrent:()=>void,
):Promise<{blob:Blob;metadata:MediaMetadata}>{
  validateMediaContract(contract,{accountId:pkg.accountId,mediaId:contract.mediaId})
  validate(contract.expiresAt>Date.now(),'media.expired')
  validate(chunks.length===contract.chunks.length,'media.missing_chunk')
  const key=await unwrapAssetDEK(pkg,contract.mediaId,
    String(contract.expiresAt),contract.wrappedDEK)
  const parts:BlobPart[]=[]
  let metadata:MediaMetadata|null=null
  for(const [index,entry]of contract.chunks.entries()){
    assertCurrent()
    const blob=chunks[index]
    validate(!!blob&&blob.size===entry.bytes,'media.chunk_truncated')
    const ciphertext=new Uint8Array(await blob.arrayBuffer())
    validate(await sha(ciphertext)===entry.sha256,'media.chunk_corrupt')
    const clear=new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM',iv:hexIV(entry.iv),
      additionalData:context(contract,index,entry.kind,entry.plainBytes),
      tagLength:128,
    },key,ciphertext))
    assertCurrent()
    validate(clear.length===entry.plainBytes,'media.chunk_length')
    if(entry.kind==='metadata'){
      metadata=parseMediaMetadata(JSON.parse(decoder.decode(clear)),contract)
      clear.fill(0)
    }else parts.push(clear)
  }
  validate(metadata!==null,'media.metadata_missing')
  return {blob:new Blob(parts,{type:metadata.mime}),metadata}
}
