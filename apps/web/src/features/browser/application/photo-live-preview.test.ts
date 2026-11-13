import {describe,expect,it} from 'vitest'
import {livePhotoPreviewSize,LIVE_PREVIEW_MAX_EDGE,LIVE_PREVIEW_MAX_PIXELS}
  from './photo-live-preview'
import type {CropSelection} from './photo-crop'

const selection:CropSelection={left:10,top:10,width:50,height:60,turns:1}

describe('V55 volatile local photo preview bounds',()=>{
  it('uses the crop/JPEG source geometry without upscaling small originals',()=>{
    expect(livePhotoPreviewSize(200,100,selection)).toEqual({
      width:60,height:100,unrotatedWidth:100,unrotatedHeight:60,
    })
    expect(livePhotoPreviewSize(200,100,{...selection,turns:0})).toEqual({
      width:100,height:60,unrotatedWidth:100,unrotatedHeight:60,
    })
  })
  it('caps both rotated and unrotated mega-pixel frames below 1 MiPixel',()=>{
    for(const turns of [0,1,2,3] as const){
      const size=livePhotoPreviewSize(16000,10000,{
        left:0,top:0,width:100,height:100,turns,
      })
      expect(size.width).toBeLessThanOrEqual(LIVE_PREVIEW_MAX_EDGE)
      expect(size.height).toBeLessThanOrEqual(LIVE_PREVIEW_MAX_EDGE)
      expect(size.width*size.height).toBeLessThanOrEqual(LIVE_PREVIEW_MAX_PIXELS)
      expect(size.unrotatedWidth*size.unrotatedHeight)
        .toBe(size.width*size.height)
      expect(size.width).toBeGreaterThan(0)
      expect(size.height).toBeGreaterThan(0)
    }
  })
  it('fails closed before allocating a display canvas',()=>{
    for(const bad of [
      {...selection,left:95},{...selection,turns:4},
      {...selection,width:0},{...selection,height:NaN},
    ])expect(()=>livePhotoPreviewSize(1000,800,bad as CropSelection))
      .toThrow('viewer.crop_invalid_region')
  })
})
