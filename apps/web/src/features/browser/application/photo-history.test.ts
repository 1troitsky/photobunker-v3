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
  it('records geometry, turn, RGB and annotation layers in one bounded undo stack',()=>{
    let h=initialPhotoHistory()
    const initial=h.states[0]?.view
    expect(initial).toEqual({
      crop:{left:0,top:0,width:100,height:100,turns:0},
      effects:{brightness:100,contrast:100,saturation:100},
      aspect:'original',
    })
    const next={
      ...a,
      view:{
        crop:{left:12,top:4,width:80,height:90,turns:1 as const},
        effects:{brightness:130,contrast:90,saturation:20},
        aspect:'custom' as const,
      },
    }
    h=recordPhotoEdit(h,next)
    const changed=travelPhotoHistory(h,-1)!
    expect(changed.snapshot.view?.crop.turns).toBe(0)
    const replay=travelPhotoHistory(changed.history,1)!
    expect(replay.snapshot.view).toEqual(next.view)
    expect(replay.snapshot.strokes).toEqual(a.strokes)
    // The committed snapshots are deep copies, not writable references
    // to component input refs or mutable encrypted-media metadata.
    next.view.crop.left=55
    next.view.effects.brightness=200
    expect(replay.snapshot.view?.crop.left).toBe(12)
    expect(replay.snapshot.view?.effects.brightness).toBe(130)
    h=recordPhotoEdit(changed.history,{
      ...next,
      view:{...next.view,crop:{...next.view.crop,turns:3}},
    })
    expect(canPhotoRedo(h)).toBe(false)
    expect(h.states.length).toBe(2)
    expect(h.states[1]?.view?.crop.turns).toBe(3)
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
