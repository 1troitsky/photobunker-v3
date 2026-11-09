import { describe,expect,it } from 'vitest'
import { CHUNK, decryptAsset, encryptAsset } from './cipher'
import type { CipherManifest, Scope } from '../domain/contracts'

const scope:Scope={accountId:'00000000-0000-4000-8000-000000000001',
  deviceId:'00000000-0000-4000-8000-000000000002',generation:7}
const photoId='00000000-0000-4000-8000-000000000003'
const assetId='00000000-0000-4000-8000-000000000004'
const attempt='00000000-0000-4000-8000-000000000005'
const storageKey=[scope.accountId,photoId,assetId,attempt].join('/')
const expiresAt=1_800_000_000_000
const wrappedDEK={iv:'AAAAAAAAAAAAAAAA',ciphertext:'SyntheticCiphertext'}
const check=()=>{}

async function asset(length=CHUNK+27){
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
  const data=new Uint8Array(length)
  for(let i=0;i<data.length;i+=65536)crypto.getRandomValues(data.subarray(i,Math.min(i+65536,data.length)))
  const plain=new Blob([data])
  const result=await encryptAsset(scope,photoId,assetId,'master',1,expiresAt,plain,key,wrappedDEK,'idb-blob',storageKey,check)
  return{...result,key,plain}
}
describe('PB local object v1 authenticated chunks',()=>{
  it('decrypts exact 2-frame ciphertext, preserving length and SHA digest',async()=>{
    const {manifest,blob,key,plain}=await asset()
    expect(manifest.frames.length).toBe(2)
    expect(blob.size).toBe(manifest.cipherBytes)
    const output=await decryptAsset(manifest,blob,key,scope,check)
    expect(new Uint8Array(await output.arrayBuffer())).toEqual(new Uint8Array(await plain.arrayBuffer()))
  })
  it('rejects truncation, append, corruption, swapped revision and reordered frames',async()=>{
    const {manifest,blob,key}=await asset()
    await expect(decryptAsset(manifest,blob.slice(0,-1),key,scope,check)).rejects.toThrow()
    await expect(decryptAsset(manifest,new Blob([blob,Uint8Array.of(0)]),key,scope,check)).rejects.toThrow()
    const raw=new Uint8Array(await blob.arrayBuffer());raw[17]^=1
    await expect(decryptAsset(manifest,new Blob([raw]),key,scope,check)).rejects.toThrow()
    await expect(decryptAsset({...manifest,revision:2},blob,key,scope,check)).rejects.toThrow()
    const reversed={...manifest,frames:[...manifest.frames].reverse()} as CipherManifest
    await expect(decryptAsset(reversed,blob,key,scope,check)).rejects.toThrow()
  })
  it('rejects swapped account, photo/asset and unsupported manifest fields',async()=>{
    const {manifest,blob,key}=await asset(4096)
    await expect(decryptAsset({...manifest,assetId:photoId},blob,key,scope,check)).rejects.toThrow()
    await expect(decryptAsset({...manifest,accountId:photoId},blob,key,scope,check)).rejects.toThrow()
    await expect(decryptAsset({...manifest,unexpected:'bad'} as CipherManifest,blob,key,scope,check)).rejects.toThrow()
    await expect(decryptAsset({...manifest,version:2} as unknown as CipherManifest,blob,key,scope,check)).rejects.toThrow()
  })
})
