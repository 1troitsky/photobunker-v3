import Dexie,{type Table} from 'dexie'
import {reauthenticate,requireSession} from '../../identity/application/session'
import {b64,importSigner,importSpki,random,sign,verify} from '../../identity/infrastructure/crypto'
import {jsonApi,putCiphertext} from '../../identity/infrastructure/api'
import {prepareSafePublicJpeg} from './public-card-safe-jpeg'
import type {PreparedSafePublicJpeg} from './public-card-safe-jpeg'
import {decodePublicBytes,encodePublicBytes,publicHash,publicCardAAD,PUBLIC_CARD_DOMAIN} from './public-card-crypto'
import type {PublicCardContract} from './public-card-crypto'

type Draft={id:string;accountId:string;sourceId:string;sourceKind:'photo'|'media';contract:string;signature:string;cipher:Blob;secretIv:Uint8Array<ArrayBuffer>;secret:Uint8Array<ArrayBuffer>;state:'queued'|'active'|'revoked'}
class Publications extends Dexie{
  cards!:Table<Draft,string>
  constructor(){super('pb3-encrypted-public-card-outbox-v1');this.version(1).stores({cards:'&id,accountId,[accountId+sourceId]'})}
}
const db=new Publications()
const enc=new TextEncoder()
const ownerCapabilityAAD=(id:string)=>enc.encode(PUBLIC_CARD_DOMAIN+'owner-capability\n'+id)
export {prepareSafePublicJpeg}
export type {PreparedSafePublicJpeg}
function same(s:ReturnType<typeof requireSession>):void{
  const current=requireSession()
  if(current.accountId!==s.accountId||current.deviceId!==s.deviceId||current.pkg.akek!==s.pkg.akek)throw Error('identity.changed')
}
async function wrapKey(s:ReturnType<typeof requireSession>):Promise<CryptoKey>{
  const {unb64}=await import('../../identity/infrastructure/crypto')
  return crypto.subtle.importKey('raw',unb64(s.pkg.akek,32),'AES-GCM',false,['encrypt','decrypt'])
}
export async function preparePublication(input:{sourceKind:'photo'|'media';sourceId:string;prepared:PreparedSafePublicJpeg;name:string;description:string;expiresAt:number;allowDownload:boolean;reviewedSha256:string}):Promise<string>{
  const s=requireSession()
  if(input.reviewedSha256!==input.prepared.sha256||await publicHash(new Uint8Array(await input.prepared.blob.arrayBuffer()))!==input.reviewedSha256)throw Error('public_card.review_changed')
  if(!Number.isSafeInteger(input.expiresAt)||input.expiresAt<=Date.now()||input.expiresAt>Date.now()+86400000)throw Error('public_card.invalid_expiry')
  // Bind to the signed source actually confirmed by the server; never infer
  // publication authority from a Viewer URL, cached thumbnail or recipient grant.
  const source=await jsonApi<{sourceContractHash:string;expiresAt:number}>('/public-cards/v1/source/'+input.sourceKind+'/'+input.sourceId)
  if(!/^[a-f0-9]{64}$/.test(source.sourceContractHash)||input.expiresAt>source.expiresAt)throw Error('public_card.assignment_or_ttl')
  const id=crypto.randomUUID(),token=b64(random(32)),rawKey=random(32),iv=random(12)
  const context={cardId:id,sourceContractHash:source.sourceContractHash,expiresAt:input.expiresAt,allowDownload:input.allowDownload}
  const key=await crypto.subtle.importKey('raw',rawKey,'AES-GCM',false,['encrypt'])
  const jpeg=encodePublicBytes(new Uint8Array(await input.prepared.blob.arrayBuffer()))
  const plain=enc.encode(JSON.stringify({version:1,name:input.name.slice(0,160),description:input.description.slice(0,2000),jpeg}))
  let cipher:ArrayBuffer
  try{cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:publicCardAAD(context)},key,plain)}finally{plain.fill(0)}
  const secretIv=random(12),localKey=await wrapKey(s)
  const secret=enc.encode(JSON.stringify({token,key:b64(rawKey)}));rawKey.fill(0)
  let sealed:Uint8Array<ArrayBuffer>
  try{sealed=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:secretIv,additionalData:ownerCapabilityAAD(id)},localKey,secret))}finally{secret.fill(0)}
  const c:PublicCardContract={version:1,cardId:id,accountId:s.accountId,sourceKind:input.sourceKind,sourceId:input.sourceId,sourceContractHash:context.sourceContractHash,tokenHash:await publicHash(enc.encode(token)),expiresAt:input.expiresAt,bytes:cipher.byteLength,sha256:await publicHash(new Uint8Array(cipher)),iv:b64(iv),width:input.prepared.width,height:input.prepared.height,allowDownload:input.allowDownload,ownerEnvelope:{iv:b64(secretIv),ciphertext:b64(sealed)}}
  const contract=JSON.stringify(c),signature=await sign(await importSigner(s.pkg.accountPkcs8),PUBLIC_CARD_DOMAIN+contract)
  same(s)
  await db.cards.add({id,accountId:s.accountId,sourceId:input.sourceId,sourceKind:input.sourceKind,contract,signature,cipher:new Blob([cipher],{type:'application/octet-stream'}),secretIv,secret:sealed,state:'queued'})
  same(s)
  return id
}
export async function sendPublication(id:string):Promise<string>{
  await reauthenticate();const s=requireSession(),row=await db.cards.get(id)
  if(row){
    if(row.accountId!==s.accountId||row.state==='revoked')throw Error('public_card.unavailable')
    await jsonApi('/public-cards/v1/reserve','POST',{contract:row.contract,signature:row.signature});same(s)
    await putCiphertext('/public-cards/v1/owned/'+id+'/payload',row.cipher);same(s)
    await db.cards.update(id,{state:'active'})
  }
  // Owner-only encrypted capability backup is signed and independently
  // recoverable using the SAME account AKEK after Recovery Key restoration.
  const remote=await jsonApi<{contract:string;signature:string}>('/public-cards/v1/owned/'+id);same(s)
  if(!await verify(await importSpki(s.pkg.accountSpki),PUBLIC_CARD_DOMAIN+remote.contract,remote.signature))throw Error('public_card.invalid_signature')
  const c=JSON.parse(remote.contract) as PublicCardContract
  if(c.cardId!==id||c.accountId!==s.accountId||c.expiresAt<=Date.now())throw Error('public_card.unavailable')
  const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:decodePublicBytes(c.ownerEnvelope.iv,12),additionalData:ownerCapabilityAAD(id)},await wrapKey(s),decodePublicBytes(c.ownerEnvelope.ciphertext,512)))
  try{
    const secret=JSON.parse(new TextDecoder().decode(plain)) as {token:string;key:string};same(s)
    return location.origin+'/p/'+secret.token+'#key='+secret.key
  }finally{plain.fill(0)}
}
export async function listPublications(kind:'photo'|'media',sourceId:string):Promise<Array<{id:string;state:Draft['state']}>>{
  const s=requireSession();const rows=await db.cards.where('[accountId+sourceId]').equals([s.accountId,sourceId]).toArray();same(s)
  const remote=await jsonApi<{items:Array<{id:string;state:Draft['state']}>}>('/public-cards/v1/owned/'+kind+'/'+sourceId);same(s)
  const merged=new Map(rows.filter(r=>r.sourceKind===kind).map(r=>[r.id,{id:r.id,state:r.state}]))
  for(const item of remote.items)merged.set(item.id,item)
  return [...merged.values()]
}
export async function revokePublication(id:string):Promise<void>{
  await reauthenticate();const s=requireSession()
  const signature=await sign(await importSigner(s.pkg.accountPkcs8),'pb3.public-card-revoke.v1\n'+id)
  await jsonApi('/public-cards/v1/owned/'+id+'/revoke','POST',{signature});same(s)
  await db.cards.update(id,{state:'revoked'})
}
