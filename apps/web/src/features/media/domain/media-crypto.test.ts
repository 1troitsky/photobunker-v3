import {describe,it,expect} from 'vitest'
import {freshPackage} from '../../identity/infrastructure/crypto'
import {
  encryptMediaFile,decryptMediaChunks,validateMediaContract,
  MEDIA_CHUNK,prepareMediaPrivateFields,validateMediaPrivateRequirements,
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

describe('P1-16 encrypted private video/audio metadata',()=>{
  it('roundtrips category, description and fresh GPS inside AES-GCM metadata ONLY',async()=>{
    const {pkg}=await freshPackage(crypto.randomUUID())
    const data=new Uint8Array(512).fill(37)
    const file=new File([data],'PRIVATE-RECORDING.wav',{type:'audio/wav'})
    const capturedAt=Date.now()
    const fields={
      category:'Field report',description:'SECRET-PRIVATE-DESCRIPTION',
      gps:{latitude:41.647849,longitude:41.639411,
        accuracyMeters:5,recordedAt:capturedAt-500},
    }
    const {contract,chunks}=await encryptMediaFile(
      file,pkg,Date.now()+86400000,check,fields,capturedAt)
    const wire=JSON.stringify(contract)
    expect(wire).not.toContain('SECRET-PRIVATE-DESCRIPTION')
    expect(wire).not.toContain('Field report')
    expect(wire).not.toContain('41.647849')
    expect(wire).not.toContain('PRIVATE-RECORDING')
    for(const chunk of chunks){
      const raw=new TextDecoder().decode(await chunk.blob.arrayBuffer())
      expect(raw).not.toContain('SECRET-PRIVATE-DESCRIPTION')
    }
    const output=await decryptMediaChunks(pkg,contract,chunks.map(x=>x.blob),check)
    expect(output.metadata).toMatchObject({
      version:2,category:'Field report',description:'SECRET-PRIVATE-DESCRIPTION',
      gps:fields.gps,createdAt:capturedAt,
    })
    expect(new Uint8Array(await output.blob.arrayBuffer())).toEqual(data)
    validateMediaPrivateRequirements(output.metadata,{
      requiredCategory:true,descriptionMinLength:12,requiredGps:true,
    })
    const bytes=new Uint8Array(await chunks.at(-1)!.blob.arrayBuffer())
    bytes[0]^=1
    await expect(decryptMediaChunks(pkg,contract,[
      chunks[0]!.blob,new Blob([bytes]),
    ],check)).rejects.toThrow('media.chunk_corrupt')
  })
  it('rejects missing, empty, malformed and stale private evidence before encryption',async()=>{
    const rules={requiredCategory:true,descriptionMinLength:12,requiredGps:true}
    expect(()=>validateMediaPrivateRequirements({},rules))
      .toThrow('assignment.category_required')
    expect(()=>validateMediaPrivateRequirements({category:'Report'},rules))
      .toThrow('assignment.description_too_short')
    expect(()=>validateMediaPrivateRequirements({
      category:'Report',description:'Long enough text',
    },rules)).toThrow('assignment.gps_required')
    const now=Date.now()
    expect(()=>prepareMediaPrivateFields({gps:{
      latitude:41.6,longitude:41.7,accuracyMeters:5,recordedAt:now-180000,
    }},now)).toThrow('capture.invalid_or_stale_gps')
    expect(()=>prepareMediaPrivateFields({description:'\u0001 control'}))
      .toThrow('media.invalid_description')
    expect(prepareMediaPrivateFields({category:' '.repeat(80)}))
      .toEqual({})
    expect(()=>prepareMediaPrivateFields({description:'x'.repeat(4001)}))
      .toThrow('media.invalid_description')
  })
})

describe('P1-17 encrypted media v3 tags',()=>{
  it('hides actual category and tags in public transport and decrypts them only with DEK',async()=>{
    const {pkg}=await freshPackage(crypto.randomUUID())
    const bytes=new Uint8Array(1024).fill(41)
    const file=new File([bytes],'PRIVATE-TAGS.webm',{type:'video/webm'})
    const fields={category:'Report',description:'private',
      tags:[' evidence ','field']}
    const encrypted=await encryptMediaFile(file,pkg,Date.now()+86400000,
      check,fields)
    expect(encrypted.contract.version).toBe(1)
    const serialized=JSON.stringify(encrypted.contract)
    for(const secret of ['PRIVATE-TAGS','Report','evidence','field','private'])
      expect(serialized).not.toContain(secret)
    const decrypted=await decryptMediaChunks(pkg,encrypted.contract,
      encrypted.chunks.map(c=>c.blob),check)
    expect(decrypted.metadata).toMatchObject({
      version:3,category:'Report',description:'private',
      tags:['evidence','field'],
    })
    expect(new Uint8Array(await decrypted.blob.arrayBuffer())).toEqual(bytes)
    for(const chunk of encrypted.chunks){
      const raw=new TextDecoder().decode(await chunk.blob.arrayBuffer())
      expect(raw).not.toContain('evidence')
      expect(raw).not.toContain('Report')
    }
    await expect(encryptMediaFile(file,pkg,Date.now()+86400000,
      check,{tags:['evidence','evidence']}))
      .rejects.toThrow('assignment.duplicate_rule_label')
  })
})
