import type { AssetKind, CipherFrame, CipherManifest, Scope, WrappedDEK, StorageBackend } from '../domain/contracts'

const encode=new TextEncoder()
const MAX_PLAINTEXT=128*1024*1024
export const CHUNK=256*1024
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export function invalid(condition:boolean,code:string):asserts condition {
  if(!condition)throw new Error(code)
}
export function identifier(s:string):void{invalid(UUID.test(s),'storage.invalid_id')}
function hex(bytes:Uint8Array):string{return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('')}
export function sha(bytes:Uint8Array<ArrayBuffer>|ArrayBuffer):Promise<string> {
  return crypto.subtle.digest('SHA-256',bytes).then(x=>hex(new Uint8Array(x)))
}
function rawHex(value:string):Uint8Array<ArrayBuffer>{
  invalid(/^[a-f0-9]{64}$/.test(value),'storage.digest_invalid')
  return Uint8Array.from(value.match(/../g)!,x=>parseInt(x,16))
}
function b64(bytes:Uint8Array):string{
  let text='';for(const value of bytes)text+=String.fromCharCode(value)
  return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
function unb64(value:string,length:number):Uint8Array<ArrayBuffer>{
  invalid(/^[A-Za-z0-9_-]+$/.test(value),'storage.iv_invalid')
  const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0))
  invalid(bytes.length===length && b64(bytes)===value,'storage.iv_invalid')
  return bytes
}
export function bytesToB64(bytes:Uint8Array):string{return b64(bytes)}
function ascii(value:unknown):string{
  invalid(typeof value==='string' && /^[\x20-\x7e]+$/.test(value),'storage.aad_invalid')
  return value
}
function aad(context: Pick<CipherManifest,'accountId'|'photoId'|'assetId'|'kind'|'revision'|'expiresAt'|'plainBytes'>,index:number,count:number,size:number):Uint8Array<ArrayBuffer>{
  const {accountId,photoId,assetId,kind,revision,expiresAt,plainBytes}=context
  const fields={v:1,alg:'AES-256-GCM',accountId:ascii(accountId),photoId:ascii(photoId),
    assetId:ascii(assetId),kind:ascii(kind),revision,expiresAt,plainBytes,index,count,size,
    final:index===count-1}
  // Exact stable ASCII framing (field names and order are protocol v1).
  return encode.encode(JSON.stringify(fields))
}
export function manifestValid(m:CipherManifest,expected?:{scope:Scope;photoId:string;assetId:string}):void {
  invalid(m!==null && typeof m==='object' && !Array.isArray(m),'storage.manifest_invalid')
  const exact=['version','algorithm','chunkBytes','accountId','photoId','assetId','kind','revision','expiresAt',
    'plainBytes','cipherBytes','frames','cipherDigest','wrappedDEK','backend','storageKey']
  invalid(Object.keys(m).sort().join('|')===exact.sort().join('|'),'storage.manifest_fields')
  invalid(m.version===1 && m.algorithm==='AES-256-GCM' && m.chunkBytes===CHUNK,'storage.manifest_version')
  identifier(m.accountId);identifier(m.photoId);identifier(m.assetId)
  invalid(['master','original','edit','thumbnail','metadata'].includes(m.kind) &&
    Number.isSafeInteger(m.revision)&&m.revision>=1 &&
    Number.isSafeInteger(m.expiresAt)&&m.expiresAt>0 &&
    Number.isSafeInteger(m.plainBytes)&&m.plainBytes>=0&&m.plainBytes<=MAX_PLAINTEXT &&
    Number.isSafeInteger(m.cipherBytes)&&m.cipherBytes>0 &&
    (m.backend==='opfs'||m.backend==='idb-blob') &&
    /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(m.storageKey),
    'storage.manifest_invalid')
  if(expected)invalid(expected.scope.accountId===m.accountId && expected.photoId===m.photoId && expected.assetId===m.assetId,'storage.wrong_scope')
  invalid(Array.isArray(m.frames)&&m.frames.length===Math.max(1,Math.ceil(m.plainBytes/CHUNK)),'storage.frames_invalid')
  let offset=0,total=0
  for(let i=0;i<m.frames.length;i++){
    const f=m.frames[i]
    invalid(f!==null && typeof f==='object' && Object.keys(f).sort().join('|')===
      ['index','offset','bytes','plainBytes','iv','digest'].sort().join('|'),'storage.frame_fields')
    const expectedPlain=Math.min(CHUNK,m.plainBytes-total)
    invalid(f.index===i && f.offset===offset && f.plainBytes===expectedPlain &&
      f.bytes===expectedPlain+16 && /^[a-f0-9]{64}$/.test(f.digest),'storage.frame_order')
    unb64(f.iv,12)
    offset+=f.bytes;total+=f.plainBytes
  }
  invalid(offset===m.cipherBytes && total===m.plainBytes && /^[a-f0-9]{64}$/.test(m.cipherDigest),
    'storage.manifest_length')
  invalid(m.wrappedDEK!==null && typeof m.wrappedDEK==='object' &&
    Object.keys(m.wrappedDEK).sort().join('|')===['iv','ciphertext'].sort().join('|') &&
    typeof m.wrappedDEK.ciphertext==='string','storage.wrapped_key_invalid')
  unb64(m.wrappedDEK.iv,12)
}
export async function treeDigest(context:Pick<CipherManifest,'accountId'|'photoId'|'assetId'|'kind'|'revision'|'expiresAt'|'plainBytes'>,
  frames:readonly CipherFrame[]):Promise<string>{
  const {accountId,photoId,assetId,kind,revision,expiresAt,plainBytes}=context
  const header=encode.encode(JSON.stringify({accountId,photoId,assetId,kind,revision,expiresAt,plainBytes,version:1,count:frames.length,chunkBytes:CHUNK}))
  const digests=frames.map(frame=>rawHex(frame.digest))
  const joined=new Uint8Array(header.length+digests.length*32);joined.set(header)
  let offset=header.length
  for(const digest of digests){joined.set(digest,offset);offset+=32}
  return sha(joined)
}
export async function encryptAsset(
  scope:Scope,photoId:string,assetId:string,kind:AssetKind,revision:number,expiresAt:number,
  plaintext:Blob,key:CryptoKey,wrappedDEK:WrappedDEK,backend:StorageBackend,storageKey:string,
  assertCurrent:()=>void,
):Promise<{manifest:CipherManifest;blob:Blob}>{
  invalid(plaintext.size<=MAX_PLAINTEXT,'storage.asset_too_large')
  identifier(scope.accountId);identifier(photoId);identifier(assetId)
  const context={accountId:scope.accountId,photoId,assetId,kind,revision,expiresAt,plainBytes:plaintext.size}
  const count=Math.max(1,Math.ceil(plaintext.size/CHUNK))
  const frames:CipherFrame[]=[],parts:BlobPart[]=[]
  let offset=0
  for(let index=0;index<count;index++){
    assertCurrent()
    const slice=plaintext.slice(index*CHUNK,Math.min(plaintext.size,(index+1)*CHUNK))
    const clear=new Uint8Array(await slice.arrayBuffer())
    const iv=crypto.getRandomValues(new Uint8Array(12))
    const crypt=new Uint8Array(await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:aad(context,index,count,clear.length),tagLength:128,
    },key,clear))
    clear.fill(0)
    assertCurrent()
    frames.push({index,offset,bytes:crypt.length,plainBytes:slice.size,iv:b64(iv),digest:await sha(crypt)})
    parts.push(crypt);offset+=crypt.length
  }
  const manifest:CipherManifest={version:1,algorithm:'AES-256-GCM',chunkBytes:CHUNK,...context,
    cipherBytes:offset,frames,cipherDigest:await treeDigest(context,frames),wrappedDEK,backend,storageKey}
  manifestValid(manifest,{scope,photoId,assetId})
  return {manifest,blob:new Blob(parts,{type:'application/octet-stream'})}
}
/** Verifies every ciphertext chunk BEFORE exposing any decrypted bytes to caller. */
export async function decryptAsset(manifest:CipherManifest,blob:Blob,key:CryptoKey,
  scope:Scope,assertCurrent:()=>void):Promise<Blob>{
  manifestValid(manifest,{scope,photoId:manifest.photoId,assetId:manifest.assetId})
  invalid(blob.size===manifest.cipherBytes,'storage.ciphertext_truncated')
  const calculated:CipherFrame[]=[]
  for(const frame of manifest.frames){
    assertCurrent()
    const frameBytes=new Uint8Array(await blob.slice(frame.offset,frame.offset+frame.bytes).arrayBuffer())
    invalid(frameBytes.length===frame.bytes && await sha(frameBytes)===frame.digest,'storage.ciphertext_corrupt')
    calculated.push(frame)
  }
  invalid(await treeDigest(manifest,calculated)===manifest.cipherDigest,'storage.manifest_corrupt')
  const pieces:BlobPart[]=[]
  for(const frame of manifest.frames){
    assertCurrent()
    const bytes=new Uint8Array(await blob.slice(frame.offset,frame.offset+frame.bytes).arrayBuffer())
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(frame.iv,12),tagLength:128,
      additionalData:aad(manifest,frame.index,manifest.frames.length,frame.plainBytes)},key,bytes)
    assertCurrent()
    invalid(clear.byteLength===frame.plainBytes,'storage.plaintext_length')
    pieces.push(clear)
  }
  return new Blob(pieces,{type:'application/octet-stream'})
}
