import {afterEach,describe,expect,it,vi} from 'vitest'
import {
  MAX_EXPORT_EDGE,MAX_EXPORT_PIXELS,LOW_MEMORY_EXPORT_PIXELS,
  UNKNOWN_MEMORY_EXPORT_PIXELS,assertFullResolutionExport,
  canExportPhotoCanvas,safeExportPixelBudget,
  encodeFullResolutionJpeg,describePhotoExportError,
} from './photo-export-budget'

afterEach(()=>vi.useRealTimers())

describe('V55 final native JPEG vs mobile preview memory contract',()=>{
  it('accepts >4096px and >16.8MP with enough memory; never downsamples',()=>{
    expect(canExportPhotoCanvas(5200,3400)).toBe(true)
    expect(5200*3400).toBeGreaterThan(16_777_216)
    expect(()=>assertFullResolutionExport(5200,3400,8)).not.toThrow()
    expect(MAX_EXPORT_EDGE).toBeGreaterThan(4096)
    expect(MAX_EXPORT_PIXELS).toBeGreaterThan(16_777_216)
  })
  it('fails closed for low/unknown memory, oversized dimensions and pixels',()=>{
    expect(safeExportPixelBudget(2)).toBe(LOW_MEMORY_EXPORT_PIXELS)
    expect(safeExportPixelBudget(undefined)).toBe(UNKNOWN_MEMORY_EXPORT_PIXELS)
    expect(safeExportPixelBudget(NaN)).toBe(UNKNOWN_MEMORY_EXPORT_PIXELS)
    expect(()=>assertFullResolutionExport(5200,3400,2))
      .toThrow('viewer.photo_export_exceeds_safe_budget')
    expect(()=>assertFullResolutionExport(5200,3400,undefined))
      .toThrow('viewer.photo_export_exceeds_safe_budget')
    for(const dims of [[9000,10],[5000,5000],[0,100],[NaN,20]]){
      expect(()=>assertFullResolutionExport(dims[0]!,dims[1]!,8))
        .toThrow('viewer.photo_export_exceeds_safe_budget')
    }
    expect(describePhotoExportError(Error('viewer.photo_export_exceeds_safe_budget')))
      .toContain('не будет уменьшено автоматически')
  })
  it('fails in bounded time when Canvas encoding never returns',async()=>{
    vi.useFakeTimers()
    const canvas={
      width:5200,height:3400,toBlob:()=>{},
    } as unknown as HTMLCanvasElement
    const pending=encodeFullResolutionJpeg(canvas,0.9,120)
    const result=expect(pending).rejects.toThrow('viewer.photo_export_timeout')
    await vi.advanceTimersByTimeAsync(121)
    await result
  })
  it('fails closed on an encoder-null Blob or thrown codec exception',async()=>{
    const empty={
      width:600,height:300,toBlob:(cb:(b:Blob|null)=>void)=>cb(null),
    } as unknown as HTMLCanvasElement
    await expect(encodeFullResolutionJpeg(empty))
      .rejects.toThrow('viewer.photo_export_encode_failed')
    const crash={
      width:600,height:300,toBlob:()=>{throw Error('untrusted driver')},
    } as unknown as HTMLCanvasElement
    await expect(encodeFullResolutionJpeg(crash))
      .rejects.toThrow('viewer.photo_export_encode_failed')
  })
  it('ignores a late codec callback after timeout and never saves its Blob',async()=>{
    vi.useFakeTimers()
    let callback:((blob:Blob|null)=>void)|null=null
    const canvas={
      width:600,height:300,
      toBlob:(cb:(blob:Blob|null)=>void)=>{callback=cb},
    } as unknown as HTMLCanvasElement
    const pending=encodeFullResolutionJpeg(canvas,0.9,25)
    const outcome=expect(pending).rejects.toThrow('viewer.photo_export_timeout')
    await vi.advanceTimersByTimeAsync(26)
    await outcome
    const deliver=callback as ((blob:Blob|null)=>void)|null
    if(!deliver)throw Error('missing_test_encoder')
    deliver(new Blob(['late'],{type:'image/jpeg'}))
    expect(vi.getTimerCount()).toBe(0)
  })
})
