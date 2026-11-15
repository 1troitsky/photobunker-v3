import {afterEach,describe,expect,it,vi} from 'vitest'
import {
  inspectFlattenedSafeJpeg,stripCanvasIccProfile,prepareSafePublicJpeg,
  PUBLIC_JPEG_MAX_SOURCE_BYTES,PUBLIC_JPEG_MAX_EDGE,
} from './public-card-safe-jpeg'

const seg=(marker:number,payload:number[]):number[]=>[
  0xff,marker,((payload.length+2)>>8)&255,(payload.length+2)&255,
  ...payload,
]
const jfif=seg(0xe0,[
  0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0,
])
const frame=(width=3,height=2):number[]=>seg(0xc0,[
  8,(height>>8)&255,height&255,(width>>8)&255,width&255,
  1,1,0x11,0,
])
const dqt=seg(0xdb,[0,1])
const dht=seg(0xc4,[0,0])
const sos=seg(0xda,[1,1,0,0,63,0])
function jpeg(opts:{app?:number[];before?:number[];after?:number[];width?:number;height?:number;end?:number[]}={}):Uint8Array{
  return new Uint8Array([
    0xff,0xd8,
    ...jfif,...(opts.app??[]),...dqt,...dht,...frame(opts.width,opts.height),
    ...(opts.before??[]),...sos,0x35,0x46,0xff,0x00,0x67,
    0xff,0xd9,...(opts.end??[]),...(opts.after??[]),
  ])
}
const icc=seg(0xe2,[
  0x49,0x43,0x43,0x5f,0x50,0x52,0x4f,0x46,
  0x49,0x4c,0x45,0,1,1,0x12,0x34,0x56,
])
const jpegBlob=(bytes:Uint8Array,type='image/jpeg'):Blob=>{
  const copy=new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy],{type})
}
afterEach(()=>{
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('P2 #211 client-only safe JPEG prepublication gate',()=>{
  it('accepts a minimal flat baseline marker stream and records dimensions',()=>{
    expect(inspectFlattenedSafeJpeg(jpeg())).toEqual({
      width:3,height:2,scanCount:1,hasMetadata:false,
    })
  })
  it('strips only exact Chromium ICC APP2 header and still rejects all unknown APP2',()=>{
    const withIcc=jpeg({app:icc})
    expect(()=>inspectFlattenedSafeJpeg(withIcc))
      .toThrow('public_card.unsafe_jpeg')
    const cleaned=stripCanvasIccProfile(withIcc)
    expect(cleaned).toEqual(jpeg())
    expect(inspectFlattenedSafeJpeg(cleaned)).toMatchObject({
      width:3,height:2,hasMetadata:false,
    })
    expect(()=>stripCanvasIccProfile(jpeg({app:seg(0xe2,[1,2,3,4])})))
      .toThrow('public_card.unsafe_jpeg')
    const multipart=[...icc]
    multipart[17]=2
    expect(()=>stripCanvasIccProfile(jpeg({app:multipart})))
      .toThrow('public_card.unsafe_jpeg')
  })
  it('rejects EXIF, XMP, ICC, Photoshop, COM and hidden data appended to EOI',()=>{
    const forbidden=[
      seg(0xe1,[0x45,0x78,0x69,0x66,0,0]),
      seg(0xe1,[0x58,0x4d,0x50,0]),
      seg(0xe2,[0x49,0x43,0x43,0]),
      seg(0xed,[0x50,0x68,0x6f,0x74]),
      seg(0xee,[0x41,0x64,0x6f,0x62,0x65]),
      seg(0xfe,[0x47,0x50,0x53,0x3d,0x31]),
      [0xff,0xd8],
    ]
    for(const part of forbidden){
      expect(()=>inspectFlattenedSafeJpeg(jpeg({before:part})))
        .toThrow('public_card.unsafe_jpeg')
    }
    expect(()=>inspectFlattenedSafeJpeg(jpeg({after:[
      0x47,0x50,0x53,0x3d,0x31,
    ]}))).toThrow('public_card.unsafe_jpeg')
  })
  it('rejects JFIF thumbnails, additional JFIF and invalid entropy endings',()=>{
    const withThumb=[...jfif]
    withThumb[withThumb.length-2]=1
    expect(()=>inspectFlattenedSafeJpeg(new Uint8Array([
      0xff,0xd8,...withThumb,...dqt,...dht,...frame(),...sos,
      0x21,0x34,0xff,0xd9,
    ]))).toThrow('public_card.unsafe_jpeg')
    expect(()=>inspectFlattenedSafeJpeg(jpeg({before:jfif})))
      .toThrow('public_card.unsafe_jpeg')
    const unfinished=jpeg().slice(0,-2)
    expect(()=>inspectFlattenedSafeJpeg(unfinished))
      .toThrow('public_card.unsafe_jpeg')
    const bare=new Uint8Array([0xff,0xd8,...jfif,...frame(),...sos,
      0x46,0xff,0xd9])
    expect(()=>inspectFlattenedSafeJpeg(bare))
      .toThrow('public_card.unsafe_jpeg')
  })
  it('rejects oversized, malformed or hidden multiple-frame JPEG streams',()=>{
    for(const sample of [
      jpeg({width:PUBLIC_JPEG_MAX_EDGE+1}),
      jpeg({width:4096,height:4096}),
      jpeg({width:0}),
      new Uint8Array([0xff,0xd8]),
      jpeg({before:seg(0xc0,[8,0,2,0,3,1,1,0x11,0])}),
      jpeg({before:seg(0xc3,[8,0,2,0,3,1,1,0x11,0])}),
    ]){
      expect(()=>inspectFlattenedSafeJpeg(sample))
        .toThrow('public_card.unsafe_jpeg')
    }
  })
  it('rejects truncated output and excessive image input before allocation',async()=>{
    const input=jpegBlob(jpeg(),'image/png')
    await expect(prepareSafePublicJpeg(input))
      .rejects.toThrow('public_card.invalid_source_jpeg')
    const oversize={type:'image/jpeg',size:PUBLIC_JPEG_MAX_SOURCE_BYTES+1}
    await expect(prepareSafePublicJpeg(oversize as Blob))
      .rejects.toThrow('public_card.invalid_source_jpeg')
  })
  it('re-encodes locally, verifies exact output bytes and returns NO public capability',async()=>{
    const input=jpegBlob(jpeg())
    const out=jpegBlob(jpeg())
    const close=vi.fn()
    const decoder=vi.fn(async()=>({width:3,height:2,close}))
    const drawImage=vi.fn()
    const fillRect=vi.fn()
    const toBlob=vi.fn((cb:(b:Blob|null)=>void)=>cb(out))
    const canvas={width:0,height:0,toBlob,
      getContext:vi.fn(()=>({drawImage,fillRect,fillStyle:''}))}
    vi.stubGlobal('document',{createElement:vi.fn(()=>canvas)})
    vi.stubGlobal('createImageBitmap',decoder)
    const digest=vi.fn(async(_algorithm:string,_data:BufferSource)=>new Uint8Array(32).fill(0xaf).buffer)
    vi.stubGlobal('crypto',{subtle:{digest}})
    const r=await prepareSafePublicJpeg(input)
    expect(r).toMatchObject({
      width:3,height:2,sha256:'af'.repeat(32),
      published:false,humanReviewRequired:true,
    })
    expect(r.blob).toBeInstanceOf(Blob)
    expect(new Uint8Array(await r.blob.arrayBuffer())).toEqual(jpeg())
    expect(decoder).toHaveBeenCalledTimes(2)
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(toBlob).toHaveBeenCalledTimes(1)
    expect(digest).toHaveBeenCalledTimes(1)
    expect(new Uint8Array(digest.mock.calls[0]![1] as Uint8Array))
      .toEqual(jpeg())
    expect(close).toHaveBeenCalledTimes(2)
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
  })
  it('removes an exact ICC chunk from real-style Canvas bytes before hashing',async()=>{
    const source=jpegBlob(jpeg())
    const canvasOutput=jpegBlob(jpeg({app:icc}))
    const close=vi.fn()
    vi.stubGlobal('createImageBitmap',async()=>({width:3,height:2,close}))
    vi.stubGlobal('document',{createElement:()=>({
      width:0,height:0,
      getContext:()=>({drawImage:vi.fn(),fillRect:vi.fn(),fillStyle:''}),
      toBlob:(cb:(b:Blob|null)=>void)=>cb(canvasOutput),
    })})
    vi.stubGlobal('crypto',{subtle:{digest:async()=>
      new Uint8Array(32).fill(0x7b).buffer}})
    const prepared=await prepareSafePublicJpeg(source)
    expect(new Uint8Array(await prepared.blob.arrayBuffer())).toEqual(jpeg())
    expect(prepared.sha256).toBe('7b'.repeat(32))
    expect(close).toHaveBeenCalledTimes(2)
    expect(prepared.published).toBe(false)
  })
  it('never returns a JPEG if Canvas inserts metadata or changes dimensions',async()=>{
    const src=jpegBlob(jpeg())
    const exif=jpegBlob(jpeg({before:seg(0xe1,[1,2,3,4])}))
    const close=vi.fn()
    const decoder=vi.fn(async()=>({width:3,height:2,close}))
    const canvas={
      width:0,height:0,
      getContext:()=>({drawImage:vi.fn(),fillRect:vi.fn(),fillStyle:''}),
      toBlob:(cb:(b:Blob|null)=>void)=>cb(exif),
    }
    vi.stubGlobal('createImageBitmap',decoder)
    vi.stubGlobal('document',{createElement:()=>canvas})
    vi.stubGlobal('crypto',{subtle:{digest:vi.fn()}})
    await expect(prepareSafePublicJpeg(src))
      .rejects.toThrow('public_card.unsafe_jpeg')
    expect(decoder).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(canvas.width).toBe(0)
  })
  it('fails closed when client Canvas encoder stalls and releases bitmap',async()=>{
    vi.useFakeTimers()
    const src=jpegBlob(jpeg())
    const close=vi.fn()
    const canvas={
      width:0,height:0,
      getContext:()=>({drawImage:vi.fn(),fillRect:vi.fn(),fillStyle:''}),
      toBlob:()=>{},
    }
    vi.stubGlobal('document',{createElement:()=>canvas})
    vi.stubGlobal('createImageBitmap',async()=>({width:3,height:2,close}))
    vi.stubGlobal('crypto',{subtle:{digest:vi.fn()}})
    const p=prepareSafePublicJpeg(src)
    const rejected=expect(p).rejects.toThrow('public_card.jpeg_timeout')
    await vi.advanceTimersByTimeAsync(30_001)
    await rejected
    expect(close).toHaveBeenCalledTimes(1)
    expect(canvas.width).toBe(0)
  })
})
