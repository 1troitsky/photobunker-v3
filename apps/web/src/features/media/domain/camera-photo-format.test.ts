import {describe,expect,it} from 'vitest'
import {cameraPhotoFormat} from './camera-photo-format'

describe('Camera Fieldwork real photo crop/quality',()=>{
  it('keeps existing 4:3 camera capture unchanged at the default 640×480',()=>{
    expect(cameraPhotoFormat(640,480,'4:3','high')).toEqual({
      sx:0,sy:0,sw:640,sh:480,
      width:640,height:480,jpegQuality:.85,
    })
  })
  it('crops centered square and widescreen areas without upscaling',()=>{
    expect(cameraPhotoFormat(640,480,'1:1','maximum')).toEqual({
      sx:80,sy:0,sw:480,sh:480,
      width:480,height:480,jpegQuality:.96,
    })
    expect(cameraPhotoFormat(1920,1080,'16:9','medium')).toEqual({
      sx:0,sy:0,sw:1920,sh:1080,
      width:960,height:540,jpegQuality:.7,
    })
    const format=cameraPhotoFormat(1920,1080,'3:2','low')
    expect(format.sw/format.sh).toBeCloseTo(1.5)
    expect(format.sx).toBeGreaterThan(0)
    expect(format.width).toBeLessThanOrEqual(640)
    expect(format.jpegQuality).toBe(.5)
  })
  it('produces four distinct approved native-JPEG size tiers, never upscaling',()=>{
    for(const [quality,edge,width,height,jpegQuality] of [
      ['maximum',1600,1600,1200,.96],
      ['high',1280,1280,960,.85],
      ['medium',960,960,720,.70],
      ['low',640,640,480,.50],
    ] as const){
      const frame=cameraPhotoFormat(4000,3000,'4:3',quality)
      expect(frame.width).toBe(width)
      expect(frame.height).toBe(height)
      expect(Math.max(frame.width,frame.height)).toBe(edge)
      expect(frame.jpegQuality).toBe(jpegQuality)
    }
    expect(cameraPhotoFormat(320,240,'4:3','maximum')).toMatchObject({
      width:320,height:240,
    })
  })
  it('rejects malformed source dimensions and preset types',()=>{
    for(const dims of [[0,1],[NaN,400],[300,Infinity],[40000,100]]){
      expect(()=>cameraPhotoFormat(dims[0]!,dims[1]!,'4:3','high'))
        .toThrow('camera.invalid_frame')
    }
    expect(()=>cameraPhotoFormat(640,480,'secret' as never,'high'))
      .toThrow('camera.invalid_photo_preset')
  })
})
