import {describe,it,expect,vi} from 'vitest'
import {
  paintPhotoBlackouts,validatePhotoBlackouts,MAX_PHOTO_BLACKOUTS,
} from './photo-blackouts'
import type {PhotoBlackout} from './photo-blackouts'

const a:PhotoBlackout={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  x:25,y:20,width:35,height:40}
describe('P2 opaque blackout JPEG pixel replacement',()=>{
  it('accepts bounded regions and rejects duplicate, partial or invalid masks',()=>{
    expect(()=>validatePhotoBlackouts([a])).not.toThrow()
    expect(MAX_PHOTO_BLACKOUTS).toBe(12)
    for(const invalid of [
      {...a,id:'INVALID'}, {...a,x:-1},{...a,y:96},
      {...a,width:4},{...a,height:4},{...a,width:80},
      {...a,y:70,height:40},{...a,x:NaN},
      {...a,x:1.5},{...a,opacity:0.5},
    ])expect(()=>validatePhotoBlackouts([invalid] as PhotoBlackout[]))
      .toThrow('viewer.blackout_invalid_region')
    expect(()=>validatePhotoBlackouts([a,a]))
      .toThrow('viewer.blackout_invalid_region')
    expect(()=>validatePhotoBlackouts(Array(13).fill(a)))
      .toThrow('viewer.blackout_invalid_count')
  })
  it('fills black exact inclusive rounded bounds and restores original context',()=>{
    const ctx={
      save:vi.fn(),restore:vi.fn(),fillRect:vi.fn(),
      fillStyle:'#fff',
    } as unknown as CanvasRenderingContext2D
    paintPhotoBlackouts(ctx,201,103,[a])
    expect(ctx.fillStyle).toBe('#000000')
    expect(ctx.fillRect).toHaveBeenCalledWith(
      Math.floor(201*.25),Math.floor(103*.2),
      Math.ceil(201*.6)-Math.floor(201*.25),
      Math.ceil(103*.6)-Math.floor(103*.2),
    )
    expect(ctx.save).toHaveBeenCalledOnce()
    expect(ctx.restore).toHaveBeenCalledOnce()
    expect(()=>paintPhotoBlackouts(ctx,5000,100,[a]))
      .toThrow('viewer.blackout_invalid_canvas')
  })
})
