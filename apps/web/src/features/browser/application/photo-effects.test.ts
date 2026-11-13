import {describe,it,expect} from 'vitest'
import {
  adjustPhotoPixels,validatePhotoAdjustments,DEFAULT_PHOTO_ADJUSTMENTS,
} from './photo-effects'

describe('P2 photo tonal adjustments — local deterministic output',()=>{
  it('does not alter untouched source samples at 100/100/100',()=>{
    const before=new Uint8ClampedArray([14,90,240,255,0,0,0,0])
    const original=[...before]
    adjustPhotoPixels(before,DEFAULT_PHOTO_ADJUSTMENTS)
    expect([...before]).toEqual(original)
  })
  it('brightness changes RGB without altering alpha or adding private metadata',()=>{
    const image=new Uint8ClampedArray([60,90,120,99])
    adjustPhotoPixels(image,{brightness:150,contrast:100,saturation:100})
    expect([...image]).toEqual([90,135,180,99])
  })
  it('saturation zero generates grayscale with unchanged transparency',()=>{
    const image=new Uint8ClampedArray([240,30,15,100])
    adjustPhotoPixels(image,{brightness:100,contrast:100,saturation:0})
    expect(image[0]).toBe(image[1])
    expect(image[1]).toBe(image[2])
    expect(image[3]).toBe(100)
  })
  it('handles finite underflow/overflow with clamping',()=>{
    const image=new Uint8ClampedArray([250,2,255,255])
    adjustPhotoPixels(image,{brightness:200,contrast:200,saturation:100})
    expect([...image]).toEqual([255,0,255,255])
  })
  it('rejects malformed adjustment structures and pixel buffers',()=>{
    for(const changes of [
      {brightness:201,contrast:100,saturation:100},
      {brightness:-1,contrast:100,saturation:100},
      {brightness:100,contrast:NaN,saturation:100},
      {brightness:100.1,contrast:100,saturation:100},
      {brightness:100,contrast:100,saturation:Infinity},
      {brightness:100,contrast:100,saturation:100,server:true},
    ]){
      expect(()=>validatePhotoAdjustments(changes)).toThrow(
        'viewer.photo_adjustment_invalid')
    }
    expect(()=>adjustPhotoPixels(new Uint8ClampedArray([10,20,30]),
      DEFAULT_PHOTO_ADJUSTMENTS)).toThrow('viewer.photo_pixels_invalid')
  })
})
