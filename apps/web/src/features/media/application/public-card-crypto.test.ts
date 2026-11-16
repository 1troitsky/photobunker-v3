import {afterEach,describe,expect,it,vi} from 'vitest'
import {encodePublicBytes,decodePublicBytes,publicHash,publicCardAAD,readPublicCard,PUBLIC_CARD_DOMAIN} from './public-card-crypto'
import type {PublicCardContract} from './public-card-crypto'

const enc=new TextEncoder()
const segment=(marker:number,data:number[])=>[255,marker,0,data.length+2,...data]
const jpeg=new Uint8Array([255,216,...segment(224,[74,70,73,70,0,1,1,0,0,1,0,1,0,0]),
  ...segment(219,[0,1]),...segment(196,[0,0]),...segment(192,[8,0,2,0,3,1,1,17,0]),
  ...segment(218,[1,1,0,0,63,0]),53,70,255,0,103,255,217])
async function fixture(){
  const token=encodePublicBytes(crypto.getRandomValues(new Uint8Array(32)))
  const raw=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12))
  const signing=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  const c:PublicCardContract={version:1,cardId:crypto.randomUUID(),accountId:crypto.randomUUID(),sourceKind:'photo',sourceId:crypto.randomUUID(),sourceContractHash:'a'.repeat(64),tokenHash:await publicHash(enc.encode(token)),expiresAt:Date.now()+60000,bytes:0,sha256:'',iv:encodePublicBytes(iv),width:3,height:2,allowDownload:false,ownerEnvelope:{iv:encodePublicBytes(iv),ciphertext:encodePublicBytes(new Uint8Array(128))}}
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt'])
  const payload={version:1,name:'Safe photo',description:'Explicitly public',jpeg:encodePublicBytes(jpeg)}
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:publicCardAAD(c)},key,enc.encode(JSON.stringify(payload))))
  c.bytes=cipher.length;c.sha256=await publicHash(cipher)
  const contract=JSON.stringify(c)
  const data={contract,signature:encodePublicBytes(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signing.privateKey,enc.encode(PUBLIC_CARD_DOMAIN+contract)))),accountSpki:encodePublicBytes(new Uint8Array(await crypto.subtle.exportKey('spki',signing.publicKey))),ciphertext:encodePublicBytes(cipher)}
  const fetch=vi.fn(async()=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}))
  vi.stubGlobal('fetch',fetch)
  return {token,fragment:'key='+encodePublicBytes(raw),data,c,fetch}
}
afterEach(()=>vi.unstubAllGlobals())
describe('Public Card independent ciphertext capability',()=>{
  it('decrypts only the separately signed flattened JPEG without Identity cookies',async()=>{
    const f=await fixture(),r=await readPublicCard(f.token,f.fragment)
    expect(r.payload.name).toBe('Safe photo');expect(r.contract.allowDownload).toBe(false)
    expect(new Uint8Array(await r.image.arrayBuffer())).toEqual(jpeg)
    expect(f.fetch).toHaveBeenCalledWith('/public-cards/v1/'+f.token,expect.objectContaining({credentials:'omit',cache:'no-store'}))
  })
  it('never sends a fragment key to the server and refuses a missing key before HTTP',async()=>{
    const f=await fixture();await expect(readPublicCard(f.token,'')).rejects.toThrow('public_card.unavailable')
    expect(f.fetch).not.toHaveBeenCalled()
    await readPublicCard(f.token,f.fragment)
    expect(JSON.stringify(f.fetch.mock.calls)).not.toContain(f.fragment.slice(4))
  })
  it('rejects the wrong independent key without returning pixels',async()=>{
    const f=await fixture()
    await expect(readPublicCard(f.token,'key='+encodePublicBytes(crypto.getRandomValues(new Uint8Array(32))))).rejects.toThrow()
  })
  it('rejects ciphertext corruption before decrypting',async()=>{
    const f=await fixture(),bytes=decodePublicBytes(f.data.ciphertext);bytes[0]^=1;f.data.ciphertext=encodePublicBytes(bytes)
    await expect(readPublicCard(f.token,f.fragment)).rejects.toThrow('public_card.corrupt')
  })
  it('rejects download or TTL escalation when the signed grant is modified',async()=>{
    const f=await fixture();f.data.contract=JSON.stringify({...f.c,allowDownload:true})
    await expect(readPublicCard(f.token,f.fragment)).rejects.toThrow('public_card.invalid_signature')
  })
  it('does not reveal pixels when the server denies a revoked token',async()=>{
    const f=await fixture();f.fetch.mockImplementation(async()=>new Response('',{status:404}))
    await expect(readPublicCard(f.token,f.fragment)).rejects.toThrow('public_card.unavailable')
  })
})
