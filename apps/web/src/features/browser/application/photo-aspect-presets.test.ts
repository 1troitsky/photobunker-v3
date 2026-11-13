import {describe,expect,it} from 'vitest'
import {cropGeometry} from './photo-crop'
import {choosePhotoAspect} from './photo-aspect-presets'
import type {CropSelection} from './photo-crop'

const full:CropSelection={left:0,top:0,width:100,height:100,turns:0}
function checkRatio(width:number,height:number,ratio:string,turns:0|1|2|3=0){
  const preset=choosePhotoAspect(width,height,{...full,turns},
    ratio as '1:1'|'4:3'|'16:9')
  const geom=cropGeometry(width,height,preset)
  expect(preset.left).toBeGreaterThanOrEqual(0)
  expect(preset.top).toBeGreaterThanOrEqual(0)
  expect(preset.left+preset.width).toBeLessThanOrEqual(100)
  expect(preset.top+preset.height).toBeLessThanOrEqual(100)
  const desired=ratio==='1:1'?1:ratio==='4:3'?4/3:16/9
  expect(Math.abs(geom.outputWidth/geom.outputHeight-desired)/desired)
    .toBeLessThanOrEqual(0.01)
  return {preset,geom}
}
describe('P2 V-48 photo raster aspect presets',()=>{
  it('chooses full-frame source without silently resetting rotation',()=>{
    expect(choosePhotoAspect(200,100,full,'original')).toEqual(full)
    expect(choosePhotoAspect(200,100,{...full,turns:3},
      'original')).toEqual({...full,turns:3})
  })
  it('gives a mathematically square crop for 2:1 source',()=>{
    const result=checkRatio(200,100,'1:1')
    expect(result.geom.outputWidth).toBe(100)
    expect(result.geom.outputHeight).toBe(100)
    expect(result.preset.width).toBe(50)
    expect(result.preset.height).toBe(100)
  })
  it('preserves requested output ratios across orientations and rotations',()=>{
    for(const dims of [[200,100],[100,200],[1080,1920],[1200,800]]){
      for(const preset of ['1:1','4:3','16:9']){
        checkRatio(dims[0]!,dims[1]!,preset)
        checkRatio(dims[0]!,dims[1]!,preset,1)
        checkRatio(dims[0]!,dims[1]!,preset,3)
      }
    }
  })
  it('preserves the manually selected focus center when selecting a preset',()=>{
    const current:CropSelection={left:20,top:25,width:40,height:40,turns:0}
    const selected=choosePhotoAspect(200,100,current,'1:1')
    const center=selected.left+selected.width/2
    expect(Math.abs(center-(current.left+current.width/2)))
      .toBeLessThanOrEqual(1)
    expect(cropGeometry(200,100,selected).outputWidth)
      .toBe(cropGeometry(200,100,selected).outputHeight)
  })
  it('rejects invalid natural dimensions and invalid current selection',()=>{
    expect(()=>choosePhotoAspect(0,100,full,'1:1'))
      .toThrow('viewer.crop_invalid_region')
    expect(()=>choosePhotoAspect(200,100,{
      ...full,width:101,
    },'4:3')).toThrow('viewer.crop_invalid_region')
  })
})
