import type {Session} from '../../identity/application/session'
import {
  b64,unb64,importSigner,importSpki,sign,verify,
} from '../../identity/infrastructure/crypto'
import {validateWorkspace} from '../domain/folders'
import type {FolderWorkspace} from '../domain/folders'

const encoder=new TextEncoder()
const decoder=new TextDecoder('utf-8',{fatal:true})
const DOMAIN='pb3.browser-folders.v1'
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const B64=/^[A-Za-z0-9_-]+$/

export type FolderSyncEnvelope={
  version:1;iv:string;ciphertext:string
  wrappedKey:{iv:string;ciphertext:string}
}
export type FolderSyncContract={
  version:1;accountId:string;writerDeviceId:string;operationId:string
  fromRevision:number;toRevision:number;keyRevision:number
  envelope:FolderSyncEnvelope
}
export type SignedFolderContract={contract:string;signature:string}

function aad(accountId:string,revision:number,purpose:'workspace'|'dek'):Uint8Array<ArrayBuffer>{
  return encoder.encode(JSON.stringify({
    domain:'pb3/browser/account-folders/v1',accountId,revision,purpose,
  }))
}
function largeB64(bytes:Uint8Array):string{
  let raw=''
  for(let i=0;i<bytes.length;i+=4096)
    raw+=String.fromCharCode(...bytes.subarray(i,i+4096))
  return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')
}
function largeUnb64(value:string):Uint8Array<ArrayBuffer>{
  if(value.length<22||value.length>160100||!B64.test(value))
    throw Error('browser.sync_invalid_ciphertext')
  let decoded:string
  try{decoded=atob(value.replace(/-/g,'+').replace(/_/g,'/'))}
  catch{throw Error('browser.sync_invalid_ciphertext')}
  if(decoded.length<16||decoded.length>120016)
    throw Error('browser.sync_invalid_ciphertext')
  const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0))
  if(largeB64(bytes)!==value)throw Error('browser.sync_invalid_ciphertext')
  return bytes
}
function exactly(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw Error('browser.sync_invalid_contract')
  const d=value as Record<string,unknown>
  if(Object.keys(d).sort().join('|')!==[...keys].sort().join('|'))
    throw Error('browser.sync_invalid_contract')
  return d
}
export function parseFolderContract(raw:string):FolderSyncContract{
  if(typeof raw!=='string'||raw.length<180||raw.length>190000)
    throw Error('browser.sync_invalid_contract')
  let parsed:unknown
  try{parsed=JSON.parse(raw)}catch{throw Error('browser.sync_invalid_contract')}
  const obj=exactly(parsed,[
    'version','accountId','writerDeviceId','operationId','fromRevision',
    'toRevision','keyRevision','envelope',
  ])
  if(JSON.stringify(parsed)!==raw||obj.version!==1
    ||typeof obj.accountId!=='string'||!UUID.test(obj.accountId)
    ||typeof obj.writerDeviceId!=='string'||!UUID.test(obj.writerDeviceId)
    ||typeof obj.operationId!=='string'||!UUID.test(obj.operationId)
    ||typeof obj.fromRevision!=='number'||!Number.isSafeInteger(obj.fromRevision)
    ||obj.fromRevision<0||obj.fromRevision>=100000000
    ||typeof obj.toRevision!=='number'||obj.toRevision!==obj.fromRevision+1
    ||typeof obj.keyRevision!=='number'||!Number.isSafeInteger(obj.keyRevision)
    ||obj.keyRevision<1||obj.keyRevision>=100000000)
    throw Error('browser.sync_invalid_contract')
  const env=exactly(obj.envelope,['version','iv','ciphertext','wrappedKey'])
  const wrapped=exactly(env.wrappedKey,['iv','ciphertext'])
  if(env.version!==1||typeof env.iv!=='string'
    ||typeof env.ciphertext!=='string'
    ||typeof wrapped.iv!=='string'||typeof wrapped.ciphertext!=='string')
    throw Error('browser.sync_invalid_contract')
  unb64(env.iv,12);unb64(wrapped.iv,12);unb64(wrapped.ciphertext,48)
  largeUnb64(env.ciphertext)
  return parsed as FolderSyncContract
}

async function accountKey(session:Session,usage:KeyUsage):Promise<CryptoKey>{
  const bytes=unb64(session.pkg.akek,32)
  try{
    return await crypto.subtle.importKey('raw',bytes,
      {name:'AES-GCM'},false,[usage])
  }finally{bytes.fill(0)}
}

/**
 * AKEK wraps a fresh per-revision DEK. It never encrypts workspace content.
 * Workspace ciphertext is account scoped, revision-bound and account-signed;
 * an independently recovered device can decrypt it using its account package.
 */
export async function createFolderSyncContract(
  session:Session,workspace:FolderWorkspace,
  fromRevision:number,operationId:string,
):Promise<SignedFolderContract>{
  validateWorkspace(workspace)
  if(!UUID.test(operationId)||!Number.isSafeInteger(fromRevision)
    ||fromRevision<0||fromRevision>=100000000)
    throw Error('browser.sync_invalid_revision')
  const toRevision=fromRevision+1,keyRevision=session.pkg.revision
  const clear=encoder.encode(JSON.stringify(workspace))
  if(clear.length>120000)throw Error('browser.folder_limit')
  const raw=crypto.getRandomValues(new Uint8Array(32))
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const wrapIv=crypto.getRandomValues(new Uint8Array(12))
  try{
    const dek=await crypto.subtle.importKey('raw',raw,
      {name:'AES-GCM'},false,['encrypt'])
    const ciphertext=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:aad(session.accountId,toRevision,'workspace'),
      tagLength:128,
    },dek,clear)
    const wrapped=await crypto.subtle.encrypt({
      name:'AES-GCM',iv:wrapIv,
      additionalData:aad(session.accountId,keyRevision,'dek'),tagLength:128,
    },await accountKey(session,'encrypt'),raw)
    const obj:FolderSyncContract={
      version:1,accountId:session.accountId,
      writerDeviceId:session.deviceId,operationId,
      fromRevision,toRevision,keyRevision,
      envelope:{
        version:1,iv:b64(iv),ciphertext:largeB64(new Uint8Array(ciphertext)),
        wrappedKey:{iv:b64(wrapIv),ciphertext:b64(wrapped)},
      },
    }
    const contract=JSON.stringify(obj)
    const signature=await sign(await importSigner(session.pkg.accountPkcs8),
      DOMAIN+'\n'+contract)
    return {contract,signature}
  }finally{clear.fill(0);raw.fill(0)}
}

export async function verifyAndOpenFolderSync(
  session:Session,record:SignedFolderContract,revision:number,
):Promise<FolderWorkspace>{
  const d=parseFolderContract(record.contract)
  if(d.accountId!==session.accountId||d.toRevision!==revision
    ||revision<1)throw Error('browser.sync_identity_mismatch')
  if(!await verify(await importSpki(session.pkg.accountSpki),
    DOMAIN+'\n'+record.contract,record.signature))
    throw Error('browser.sync_signature_invalid')
  const wrapped=unb64(d.envelope.wrappedKey.ciphertext,48)
  const key=await accountKey(session,'decrypt')
  let raw:Uint8Array<ArrayBuffer>
  try{
    raw=new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(d.envelope.wrappedKey.iv,12),
      additionalData:aad(session.accountId,d.keyRevision,'dek'),tagLength:128,
    },key,wrapped))
  }catch{
    throw Error('browser.sync_key_or_cipher_unavailable')
  }
  try{
    if(raw.length!==32)throw Error('browser.sync_invalid_key')
    const dek=await crypto.subtle.importKey('raw',raw,
      {name:'AES-GCM'},false,['decrypt'])
    const clear=new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(d.envelope.iv,12),
      additionalData:aad(session.accountId,revision,'workspace'),tagLength:128,
    },dek,largeUnb64(d.envelope.ciphertext)))
    try{
      if(clear.length>120000)throw Error('browser.sync_invalid_workspace')
      return validateWorkspace(JSON.parse(decoder.decode(clear)) as unknown)
    }finally{clear.fill(0)}
  }catch(e){
    // Older snapshot may have been sealed under an AKEK rotated elsewhere.
    // Refuse to overwrite either the server or the pending local workspace.
    if(e instanceof Error&&e.name==='OperationError')
      throw Error('browser.sync_key_or_cipher_unavailable')
    throw e
  }finally{raw.fill(0)}
}
