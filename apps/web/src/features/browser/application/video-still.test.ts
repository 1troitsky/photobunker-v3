import {describe,it,expect} from 'vitest'
import {stillDimensions,stillName} from './video-still'

describe('Viewer decoded video stop frame privacy boundaries',()=>{
  it('preserves ordinary pixels and caps massive dimensions and area',()=>{
    expect(stillDimensions(1920,1080)).toEqual({width:1920,height:1080})
    expect(stillDimensions(7680,4320)).toEqual({width:4096,height:2304})
    const wide=stillDimensions(12000,9000)
    expect(wide.width).toBeLessThanOrEqual(4096)
    expect(wide.height).toBeLessThanOrEqual(4096)
    expect(wide.width*wide.height).toBeLessThanOrEqual(16_777_216)
    for(const [w,h] of [[0,720],[-1,9],[Infinity,42],[NaN,43],
      [100000,900], [1,0]])expect(()=>stillDimensions(w,h))
      .toThrow('viewer.frame_invalid_dimensions')
  })
  it('sanitizes the private filename and keeps exact seek time out of URLs',()=>{
    expect(stillName('../../SECRET\\video.webm',1250))
      .toBe('SECRET_video-frame-1250ms.jpg')
    expect(stillName('архив.mov',0)).toBe('архив-frame-0ms.jpg')
    expect(stillName('... ',99)).toBe('video-frame-99ms.jpg')
    expect(stillName('x'.repeat(160)+'.mp4',100).length).toBeLessThan(130)
    for(const t of [-1,NaN,Infinity,86_400_001])
      expect(()=>stillName('video.webm',t)).toThrow('viewer.frame_invalid_time')
  })
})
