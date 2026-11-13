import {describe,it,expect,vi} from 'vitest'
import {drawPhotoShapes,validateShapeMarks} from './photo-shapes'
import type {PhotoShapeMark,ShapeKind} from './photo-shapes'

const base:PhotoShapeMark={
  id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind:'square',x:10,y:15,width:30,height:25,stroke:'#1ed760',
  strokeWidth:6,fill:'#60a5fa',filled:false,
}
describe('P2 photo editor approved shapes and privacy guards',()=>{
  it('accepts arrow/circle/square/triangle/star with bounded geometry',()=>{
    for(const kind of ['arrow','circle','square','triangle','star'] as ShapeKind[])
      expect(()=>validateShapeMarks([{...base,kind}])).not.toThrow()
  })
  it('rejects malformed marks before drawing ciphertext-bound pixels',()=>{
    const bad=[
      {...base,kind:'hexagon'}, {...base,id:'x'},
      {...base,x:-1},{...base,x:90},{...base,width:2},
      {...base,y:95},{...base,height:90},
      {...base,strokeWidth:0},{...base,strokeWidth:29},
      {...base,stroke:'#00ffAA'},{...base,fill:'red'},
      {...base,filled:'true'}, {...base,key:'exfiltrate'},
    ]
    for(const mark of bad)
      expect(()=>validateShapeMarks([mark] as PhotoShapeMark[]))
        .toThrow('viewer.shape_invalid_mark')
    expect(()=>validateShapeMarks([base,base]))
      .toThrow('viewer.shape_invalid_mark')
    expect(()=>validateShapeMarks(Array(13).fill(base)))
      .toThrow('viewer.shape_invalid_count')
  })
  it('draws real stroked and filled paths with a bounded canvas',()=>{
    const ctx={
      save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),
      arc:vi.fn(),rect:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),
      closePath:vi.fn(),fill:vi.fn(),stroke:vi.fn(),
      lineWidth:1,lineJoin:'',lineCap:'',strokeStyle:'',fillStyle:'',
    } as unknown as CanvasRenderingContext2D
    drawPhotoShapes(ctx,320,240,[base,{...base,id:
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',kind:'circle',filled:true}])
    expect(ctx.stroke).toHaveBeenCalledTimes(2)
    expect(ctx.fill).toHaveBeenCalledTimes(1)
    expect(ctx.arc).toHaveBeenCalledTimes(1)
    expect(ctx.rect).toHaveBeenCalledTimes(1)
    expect(ctx.restore).toHaveBeenCalledTimes(2)
    expect(()=>drawPhotoShapes(ctx,8193,1,[base]))
      .toThrow('viewer.shape_invalid_canvas')
  })
})
