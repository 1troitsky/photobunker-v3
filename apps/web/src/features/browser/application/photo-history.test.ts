import {describe,it,expect} from 'vitest'
import {
  initialPhotoHistory,recordPhotoEdit,travelPhotoHistory,
  canPhotoUndo,canPhotoRedo,MAX_PHOTO_HISTORY,
} from './photo-history'
const a={text:[],shapes:[],blackouts:[],strokes:[{
  id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',tool:'brush' as const,
  color:'#ff0000',width:8,points:[{x:100,y:100}],
}]}
const b={...a,strokes:[...a.strokes,{
  id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',tool:'eraser' as const,
  color:'#ff0000',width:10,points:[{x:100,y:100}],
}]}
describe('P2 volatile photo editor Undo/Redo',()=>{
  it('restores paint & erase and drops redo branch after new edit',()=>{
    let h=initialPhotoHistory()
    expect(canPhotoUndo(h)).toBe(false)
    h=recordPhotoEdit(h,a);h=recordPhotoEdit(h,b)
    expect(canPhotoUndo(h)).toBe(true)
    const undone=travelPhotoHistory(h,-1)!
    h=undone.history
    expect(undone.snapshot.strokes).toHaveLength(1)
    expect(canPhotoRedo(h)).toBe(true)
    // A new edit after undo must not replay an erased branch.
    h=recordPhotoEdit(h,{...a,text:[{
      id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      text:'новый текст',x:1,y:1,size:6,color:'#ffffff',
    }]})
    expect(canPhotoRedo(h)).toBe(false)
    expect(travelPhotoHistory(h,1)).toBeNull()
    expect(travelPhotoHistory(h,-1)!.snapshot.strokes).toHaveLength(1)
    expect(travelPhotoHistory(h,-1)!.snapshot.blackouts).toEqual([])
  })
  it('does not duplicate unchanged state and caps all in-memory history',()=>{
    let h=initialPhotoHistory()
    h=recordPhotoEdit(h,a)
    const next=recordPhotoEdit(h,a)
    expect(next).toBe(h)
    for(let i=0;i<150;i++)h=recordPhotoEdit(h,{...a,strokes:[{
      ...a.strokes[0]!,width:(i%35)+2,
      points:[{x:i,y:i}],
    }]})
    expect(h.states.length).toBe(MAX_PHOTO_HISTORY)
    expect(h.cursor).toBe(MAX_PHOTO_HISTORY-1)
    const undo=travelPhotoHistory(h,-1)!
    expect(undo.snapshot.strokes[0]?.points[0]?.x).toBe(148)
  })
  it('copies snapshots so later editor mutations cannot rewrite undo state',()=>{
    let h=initialPhotoHistory()
    h=recordPhotoEdit(h,a)
    const p=travelPhotoHistory(h,-1)!
    h=travelPhotoHistory(p.history,1)!.history
    const snapshot=travelPhotoHistory(h,-1)!.snapshot
    expect(snapshot.strokes).toHaveLength(0)
    expect(h.states[1]?.strokes[0]?.points[0]?.x).toBe(100)
  })
})
