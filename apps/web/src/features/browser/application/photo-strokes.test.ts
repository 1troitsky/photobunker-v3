import {describe,it,expect,vi} from 'vitest'
import {
  drawPhotoStrokes,validatePhotoStrokes,MAX_PHOTO_STROKES,
  MAX_TOTAL_STROKE_POINTS,
} from './photo-strokes'
import type {PhotoStroke} from './photo-strokes'
const stroke:PhotoStroke={
  id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tool:'brush',color:'#1ed760',width:8,
  points:[{x:100,y:200},{x:400,y:600}],
}
const eraser:PhotoStroke={
  ...stroke,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tool:'eraser',points:[{x:200,y:300},{x:250,y:400}],
}
describe('P2 private paint stroke safety',()=>{
  it('validates bounded normalized drawing points and three kinds',()=>{
    expect(()=>validatePhotoStrokes([stroke,eraser])).not.toThrow()
    expect(MAX_PHOTO_STROKES).toBe(80)
    expect(MAX_TOTAL_STROKE_POINTS).toBe(12000)
    for(const bad of [
      {...stroke,tool:'blur'}, {...stroke,width:1},
      {...stroke,width:37}, {...stroke,color:'#ff00GG'},
      {...stroke,points:[]},
      {...stroke,points:[{x:-1,y:0}]},
      {...stroke,points:[{x:1001,y:0}]},
      {...stroke,points:[{x:NaN,y:3}]},
      {...stroke,points:[{x:1.5,y:3}]},
      {...stroke,leak:'secret'},
    ])expect(()=>validatePhotoStrokes([bad] as PhotoStroke[]))
      .toThrow()
    expect(()=>validatePhotoStrokes([stroke,stroke]))
      .toThrow('viewer.stroke_invalid_mark')
    expect(()=>validatePhotoStrokes(Array(81).fill(stroke)))
      .toThrow('viewer.stroke_invalid_count')
  })
  it('paints on transparent layer and erases strokes without touching source',()=>{
    const modes:string[]=[]
    const ctx={
      save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),
      lineTo:vi.fn(),stroke:vi.fn(function(this:CanvasRenderingContext2D){
        modes.push(this.globalCompositeOperation)
      }),arc:vi.fn(),fill:vi.fn(),
      globalCompositeOperation:'source-over',strokeStyle:'',fillStyle:'',
      lineWidth:0,lineCap:'',lineJoin:'',
    } as unknown as CanvasRenderingContext2D
    drawPhotoStrokes(ctx,320,240,[stroke,{...stroke,
      id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',tool:'pencil'},eraser])
    expect(ctx.stroke).toHaveBeenCalledTimes(3)
    expect(modes).toEqual(['source-over','source-over','destination-out'])
    expect(ctx.restore).toHaveBeenCalledTimes(3)
    const dot={...stroke,id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      points:[{x:200,y:200}]}
    drawPhotoStrokes(ctx,320,240,[dot])
    expect(ctx.arc).toHaveBeenCalledOnce()
    expect(ctx.fill).toHaveBeenCalledOnce()
    expect(()=>drawPhotoStrokes(ctx,8193,240,[stroke]))
      .toThrow('viewer.stroke_invalid_canvas')
  })
})
