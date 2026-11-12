import {describe,it,expect} from 'vitest'
import {cropGeometry,fullResolutionCropGeometry,cropFileName} from './photo-crop'
import type {CropSelection} from './photo-crop'

const area:CropSelection={left:10,top:10,width:50,height:60,turns:1}
describe('Viewer non-destructive private JPEG crop and rotation',()=>{
  it('converts exact percent bounds and swaps axes on 90/270 rotation',()=>{
    expect(cropGeometry(200,100,area)).toEqual({
      sx:20,sy:10,sw:100,sh:60,drawnWidth:100,drawnHeight:60,
      outputWidth:60,outputHeight:100,
    })
    expect(cropGeometry(200,100,{...area,turns:2})).toMatchObject({
      outputWidth:100,outputHeight:60,
    })
    expect(cropGeometry(200,100,{...area,turns:3})).toMatchObject({
      outputWidth:60,outputHeight:100,
    })
  })
  it('caps huge decoded images without scaling them up',()=>{
    const normal=cropGeometry(300,200,{
      left:0,top:0,width:100,height:100,turns:0,
    })
    expect(normal).toMatchObject({outputWidth:300,outputHeight:200})
    const large=cropGeometry(16000,10000,{
      left:0,top:0,width:100,height:100,turns:0,
    })
    expect(large.outputWidth).toBeLessThanOrEqual(4096)
    expect(large.outputHeight).toBeLessThanOrEqual(4096)
    expect(large.outputWidth*large.outputHeight).toBeLessThanOrEqual(16_777_216)
  })
  it('fails closed on invalid percentages, empty selections and dimensions',()=>{
    for(const changed of [
      {...area,left:99},{...area,top:-1},{...area,width:9},
      {...area,turns:4},{...area,height:NaN},{...area,left:0.25},
    ])expect(()=>cropGeometry(200,100,changed as CropSelection))
      .toThrow('viewer.crop_invalid_region')
    for(const width of [0,-1,Infinity,100000])
      expect(()=>cropGeometry(width,100,area)).toThrow('viewer.crop_invalid_region')
  })
  it('preserves native >4096px and >16.8MP dimensions for real JPEG, unlike preview',()=>{
    const region:CropSelection={
      left:0,top:0,width:100,height:100,turns:0,
    }
    const preview=cropGeometry(5200,3400,region)
    expect(preview.outputWidth).toBe(4096)
    const final=fullResolutionCropGeometry(5200,3400,region,8)
    expect(final).toMatchObject({
      sx:0,sy:0,sw:5200,sh:3400,drawnWidth:5200,
      drawnHeight:3400,outputWidth:5200,outputHeight:3400,
    })
    expect(final.outputWidth*final.outputHeight).toBeGreaterThan(16_777_216)
    const rotated=fullResolutionCropGeometry(5200,3400,{...region,turns:1},8)
    expect(rotated).toMatchObject({
      drawnWidth:5200,drawnHeight:3400,
      outputWidth:3400,outputHeight:5200,
    })
  })
  it('fails closed instead of shrinking when native JPEG exceeds device budget',()=>{
    const region:CropSelection={
      left:0,top:0,width:100,height:100,turns:0,
    }
    for(const [w,h,memory] of [[5200,3400,2],[9000,2000,8],[6000,5000,8]]){
      expect(()=>fullResolutionCropGeometry(w!,h!,region,memory!))
        .toThrow('viewer.photo_export_exceeds_safe_budget')
    }
    // A large SOURCE may still produce a safe native crop.
    const safe=fullResolutionCropGeometry(12000,5000,{
      left:25,top:25,width:25,height:25,turns:0,
    },8)
    expect(safe.outputWidth).toBe(3000)
    expect(safe.outputHeight).toBe(1250)
  })
  it('creates short private filenames with no OS path separators',()=>{
    expect(cropFileName('../PRIVATE\\photo.jpg',area))
      .toBe('PRIVATE_photo-crop-10-10-50-60-r90.jpg')
    expect(cropFileName('день-1.png',{...area,turns:0}))
      .toBe('день-1-crop-10-10-50-60-r0.jpg')
    expect(cropFileName('a'.repeat(160)+'.webp',area).length)
      .toBeLessThan(130)
    expect(cropFileName('name.jpg',area,{
      brightness:120,contrast:100,saturation:0,
    })).toBe('name-crop-10-10-50-60-r90-fx-120-100-0.jpg')
    expect(()=>cropFileName('name.jpg',area,{
      brightness:Infinity,contrast:100,saturation:100,
    })).toThrow('viewer.photo_adjustment_invalid')
  })
})
