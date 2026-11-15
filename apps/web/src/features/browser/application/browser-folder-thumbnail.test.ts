import {afterEach,describe,expect,it,vi} from 'vitest'
import {makeBrowserFolderThumbnail} from './browser-folder-thumbnail'

afterEach(()=>{
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('authenticated Browser folder JPEG previews',()=>{
  it('center-crops a real local image, strips original metadata and closes the decoder',async()=>{
    const drawImage=vi.fn(),close=vi.fn()
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>({
      width:600,height:400,close,
    } as unknown as ImageBitmap)))
    vi.spyOn(HTMLCanvasElement.prototype,'getContext')
      .mockImplementation(()=>({drawImage} as unknown as CanvasRenderingContext2D))
    const encoded=new Blob([Uint8Array.of(0xff,0xd8,0xff)],{type:'image/jpeg'})
    const toBlob=vi.spyOn(HTMLCanvasElement.prototype,'toBlob')
      .mockImplementation(callback=>callback(encoded))
    const original=new Blob(['SENSITIVE-EXIF-GPS-PRIVATE-PAYLOAD'],{type:'image/png'})
    const thumb=await makeBrowserFolderThumbnail(original)
    expect(thumb).toBe(encoded)
    expect(thumb.size).toBeLessThan(180*1024)
    expect(drawImage).toHaveBeenCalledWith(
      expect.objectContaining({width:600,height:400}),
      100,0,400,400,0,0,96,96,
    )
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function),'image/jpeg',0.68)
    expect(close).toHaveBeenCalledOnce()
    expect(await thumb.text()).not.toContain('SENSITIVE-EXIF')
  })
  it('does not permit non-image types, invalid dimensions or oversized decode',async()=>{
    const original=new Blob(['hi'],{type:'text/html'})
    await expect(makeBrowserFolderThumbnail(original))
      .rejects.toThrow('browser.thumbnail_unsupported')
    await expect(makeBrowserFolderThumbnail(new Blob([],{
      type:'image/jpeg',
    }))).rejects.toThrow('browser.thumbnail_unsupported')
    await expect(makeBrowserFolderThumbnail(new Blob([1],{
      type:'image/jpeg',
    }),300)).rejects.toThrow('browser.thumbnail_unsupported')
    const close=vi.fn()
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>({
      width:0,height:200,close,
    } as unknown as ImageBitmap)))
    await expect(makeBrowserFolderThumbnail(new Blob([1],{
      type:'image/jpeg',
    }))).rejects.toThrow('browser.thumbnail_invalid_dimensions')
    expect(close).toHaveBeenCalledOnce()
  })
  it('supports WebKit without ImageBitmap and revokes the original temporary URL',async()=>{
    vi.stubGlobal('createImageBitmap',undefined)
    class FakeImage{
      naturalWidth=300
      naturalHeight=200
      onload:(()=>void)|null=null
      onerror:(()=>void)|null=null
      private source=''
      set src(next:string){
        this.source=next
        if(next)queueMicrotask(()=>this.onload?.())
      }
      get src():string{return this.source}
    }
    vi.stubGlobal('Image',FakeImage)
    const revoke=vi.fn()
    vi.stubGlobal('URL',{
      createObjectURL:vi.fn(()=>'blob:temporary-private-decoder'),
      revokeObjectURL:revoke,
    })
    const drawImage=vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype,'getContext')
      .mockImplementation(()=>({drawImage} as unknown as CanvasRenderingContext2D))
    const jpeg=new Blob([Uint8Array.of(0xff,0xd8,0xff)],{type:'image/jpeg'})
    vi.spyOn(HTMLCanvasElement.prototype,'toBlob')
      .mockImplementation(callback=>callback(jpeg))
    const output=await makeBrowserFolderThumbnail(new Blob([1,2,3],{
      type:'image/png',
    }))
    expect(output).toBe(jpeg)
    expect(drawImage).toHaveBeenCalledWith(expect.objectContaining({
      naturalWidth:300,naturalHeight:200,
    }),50,0,200,200,0,0,96,96)
    expect(revoke).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:temporary-private-decoder')
  })
  it('always closes the image decoder when canvas encoding fails',async()=>{
    const close=vi.fn()
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>({
      width:100,height:100,close,
    } as unknown as ImageBitmap)))
    vi.spyOn(HTMLCanvasElement.prototype,'getContext')
      .mockImplementation(()=>({drawImage:vi.fn()} as unknown as CanvasRenderingContext2D))
    vi.spyOn(HTMLCanvasElement.prototype,'toBlob')
      .mockImplementation(callback=>callback(null))
    await expect(makeBrowserFolderThumbnail(new Blob([1],{
      type:'image/jpeg',
    }))).rejects.toThrow('browser.thumbnail_encode_failed')
    expect(close).toHaveBeenCalledOnce()
  })
})
