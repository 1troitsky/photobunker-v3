import {inspectFlattenedSafeJpeg} from './public-card-safe-jpeg'

export const PUBLIC_CARD_DOMAIN='pb3.public-card.v1\n'
export type PublicCardContract={version:1;cardId:string;accountId:string;sourceKind:'photo'|'media';sourceId:string;sourceContractHash:string;tokenHash:string;expiresAt:number;bytes:number;sha256:string;iv:string;width:number;height:number;allowDownload:boolean;ownerEnvelope:{iv:string;ciphertext:string}}
export type PublicCardPayload={version:1;name:string;description:string;jpeg:string}
const enc=new TextEncoder()
export function encodePublicBytes(bytes:Uint8Array):string{
  let result=''
  for(let offset=0;offset<bytes.length;offset+=8192)
    result+=String.fromCharCode(...bytes.subarray(offset,offset+8192))
  return btoa(result).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
export function decodePublicBytes(value:string,max=24_000_000):Uint8Array<ArrayBuffer>{
  if(typeof value!=='string'||value.length>Math.ceil(max*4/3)||!/^[A-Za-z0-9_-]+$/.test(value))
    throw Error('public_card.invalid_payload')
  const result=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))
  if(result.length>max||encodePublicBytes(result)!==value)throw Error('public_card.invalid_payload')
  return result
}
export async function publicHash(bytes:Uint8Array<ArrayBuffer>):Promise<string>{
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
    .map(x=>x.toString(16).padStart(2,'0')).join('')
}
export function publicCardAAD(c:Pick<PublicCardContract,'cardId'|'sourceContractHash'|'expiresAt'|'allowDownload'>):Uint8Array<ArrayBuffer>{
  return enc.encode(PUBLIC_CARD_DOMAIN+JSON.stringify({cardId:c.cardId,sourceContractHash:c.sourceContractHash,expiresAt:c.expiresAt,allowDownload:c.allowDownload}))
}
/** No Identity bootstrap, cookies, original keys, telemetry, external maps or cache. */
export async function readPublicCard(token:string,fragment:string,signal?:AbortSignal):Promise<{contract:PublicCardContract;payload:PublicCardPayload;image:Blob}>{
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)||!/^key=[A-Za-z0-9_-]{43}$/.test(fragment))throw Error('public_card.unavailable')
  const keyBytes=decodePublicBytes(fragment.slice(4),32)
  const response=await fetch('/public-cards/v1/'+token,{credentials:'omit',cache:'no-store',signal,headers:{Accept:'application/json'}})
  if(!response.ok)throw Error('public_card.unavailable')
  const data=await response.json() as {contract:string;signature:string;accountSpki:string;ciphertext:string}
  const c=JSON.parse(data.contract) as PublicCardContract
  if(c.version!==1||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=Date.now()
    ||c.bytes>24_000_000||c.bytes<32||c.tokenHash!==await publicHash(enc.encode(token)))throw Error('public_card.unavailable')
  const signer=await crypto.subtle.importKey('spki',decodePublicBytes(data.accountSpki,256),{name:'ECDSA',namedCurve:'P-256'},false,['verify'])
  if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},signer,decodePublicBytes(data.signature,64),enc.encode(PUBLIC_CARD_DOMAIN+data.contract)))throw Error('public_card.invalid_signature')
  const cipher=decodePublicBytes(data.ciphertext)
  if(cipher.length!==c.bytes||await publicHash(cipher)!==c.sha256)throw Error('public_card.corrupt')
  const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['decrypt'])
  keyBytes.fill(0)
  const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:decodePublicBytes(c.iv,12),additionalData:publicCardAAD(c)},key,cipher))
  try{
    const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain)) as PublicCardPayload
    if(Object.keys(payload).sort().join('|')!=='description|jpeg|name|version'||payload.version!==1
      ||typeof payload.name!=='string'||payload.name.length>160||typeof payload.description!=='string'||payload.description.length>2000)
      throw Error('public_card.invalid_payload')
    const jpeg=decodePublicBytes(payload.jpeg,16*1024*1024)
    const inspection=inspectFlattenedSafeJpeg(jpeg)
    if(inspection.width!==c.width||inspection.height!==c.height||c.expiresAt<=Date.now())throw Error('public_card.unavailable')
    return {contract:c,payload,image:new Blob([jpeg],{type:'image/jpeg'})}
  }finally{plain.fill(0)}
}
