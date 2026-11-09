import {describe,it,expect} from 'vitest'
import {freshPackage} from '../../identity/infrastructure/crypto'
import {
  encryptMediaFile,decryptMediaChunks,validateMediaContract,
  MEDIA_CHUNK,
} from './media-crypto'
import type {MediaContract} from './media-crypto'

const check=()=>{}
async function fixture(type:'video'|'audio'|'photo'='video',length=MEDIA_CHUNK+257){
  const {pkg}=await freshPackage(crypto.randomUUID())
  const data=new Uint8Array(length)
  for(let i=0;i<length;i++)data[i]=i%251
  const mime=type==='video'?'video/webm':type==='audio'?'audio/wav':'image/jpeg'
  const file=new File([data],'SECRET-PERSONAL-FILENAME.'+type,{type:mime})
  const encrypted=await encryptMediaFile(file,pkg,Date.now()+86400000,check)
  return {...encrypted,file,pkg,data}
}
describe('P1-10 multi-media E2EE authenticated chunks',()=>{
  it('round-trips >1 MiB video, preserves exact bytes and keeps name/MIME private',async()=>{
    const f=await fixture()
    expect(f.chunks).toHaveLength(3)
    expect(f.contract.mediaType).toBe('video')
    expect(JSON.stringify(f.contract)).not.toContain('SECRET-PERSONAL')
    expect(JSON.stringify(f.contract)).not.toContain('video/webm')
    expect(f.chunks[0]?.plainBytes).toBe(MEDIA_CHUNK)
    expect(f.chunks[1]?.plainBytes).toBe(257)
    expect(f.chunks[2]?.kind).toBe('metadata')
    validateMediaContract(f.contract,{
      accountId:f.pkg.accountId,mediaId:f.contract.mediaId,
    })
    const out=await decryptMediaChunks(f.pkg,f.contract,
      f.chunks.map(x=>x.blob),check)
    expect(out.metadata.fileName).toBe(f.file.name)
    expect(out.metadata.mime).toBe('video/webm')
    expect(out.blob.type).toBe('video/webm')
    expect(new Uint8Array(await out.blob.arrayBuffer())).toEqual(f.data)
  })
  it('supports photo/audio and authenticates metadata independently',async()=>{
    for(const type of ['photo','audio'] as const){
      const f=await fixture(type,1032)
      expect(f.chunks).toHaveLength(2)
      const result=await decryptMediaChunks(f.pkg,f.contract,
        f.chunks.map(x=>x.blob),check)
      expect(result.metadata.fileName).toBe(f.file.name)
    }
  })
  it('rejects wrong owner, tampered ciphertext, swizzled IV, chunk reordering and wrong MIME',async()=>{
    const f=await fixture('audio',4096)
    const blobs=f.chunks.map(x=>x.blob)
    const corrupted=new Uint8Array(await blobs[0]!.arrayBuffer())
    corrupted[17]^=1
    await expect(decryptMediaChunks(f.pkg,f.contract,[
      new Blob([corrupted]),blobs[1]!,
    ],check)).rejects.toThrow('media.chunk_corrupt')
    await expect(decryptMediaChunks(f.pkg,f.contract,[
      blobs[1]!,blobs[0]!,
    ],check)).rejects.toThrow()
    const wrong={...f.contract,
      chunks:[{...f.contract.chunks[0]!,iv:f.contract.chunks[1]!.iv},
        f.contract.chunks[1]!],
    }
    await expect(decryptMediaChunks(f.pkg,wrong,blobs,check)).rejects.toThrow()
    const {pkg:outsider}=await freshPackage(crypto.randomUUID())
    await expect(decryptMediaChunks(outsider,f.contract,blobs,check))
      .rejects.toThrow('media.wrong_identity')
    await expect(encryptMediaFile(
      new File([new Uint8Array(1024)],'filename.txt',{type:'text/plain'}),
      f.pkg,Date.now()+86400000,check,
    )).rejects.toThrow('media.unsupported_mime')
  })
  it('refuses over-claimed byte lengths, duplicated IDs and altered signed envelope shapes',async()=>{
    const f=await fixture('photo',160)
    expect(()=>validateMediaContract({
      ...f.contract,plainBytes:f.contract.plainBytes+1,
    })).toThrow('media.chunk_invalid')
    expect(()=>validateMediaContract({
      ...f.contract,chunks:[f.contract.chunks[0]!,{
        ...f.contract.chunks[1]!,chunkId:f.contract.chunks[0]!.chunkId,
      }],
    })).toThrow('media.chunk_invalid')
    expect(()=>validateMediaContract({
      ...f.contract,extra:'clear' ,
    } as MediaContract)).toThrow('media.contract_fields')
  })
})
