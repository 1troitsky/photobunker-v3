import {describe,it,expect,vi} from 'vitest'
import {drawPhotoText,validateTextMarks,MAX_TEXT_MARKS} from './photo-text'
import type {PhotoTextMark} from './photo-text'

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const mark:PhotoTextMark={
  id,text:'Привет, мир!',x:20,y:15,size:6,color:'#ff0000',
}
describe('P2 viewer volatile text annotations',()=>{
  it('accepts bounded Unicode marks with independent IDs',()=>{
    expect(()=>validateTextMarks([mark,{...mark,id:second,x:85,y:85}]))
      .not.toThrow()
    expect(MAX_TEXT_MARKS).toBe(12)
  })
  it('rejects duplicate IDs, malformed colors/coords/control chars',()=>{
    for(const item of [
      [{...mark,id:'bad'}],
      [mark,mark],
      [{...mark,text:' '}],
      [{...mark,text:'a'.repeat(221)}],
      [{...mark,text:'secret\u0000data'}],
      [{...mark,x:NaN}],
      [{...mark,x:86}],
      [{...mark,y:-1}],
      [{...mark,size:1}],
      [{...mark,size:13}],
      [{...mark,color:'red'}],
      [{...mark,color:'#123ABC'}],
      [{...mark,privateKey:'must_not_persist'}],
    ])expect(()=>validateTextMarks(item as PhotoTextMark[]))
      .toThrow('viewer.text_invalid_mark')
    expect(()=>validateTextMarks(Array.from({length:13},(_,i)=>({
      ...mark,id:i===0?id:second,
    })))).toThrow('viewer.text_invalid_count')
  })
  it('draws wrapped text only into bounded canvas coordinates',()=>{
    const drawn:string[]=[]
    const ctx={
      save:vi.fn(),restore:vi.fn(),measureText:vi.fn((s:string)=>({
        width:s.length*8,
      })),strokeText:vi.fn((s:string)=>drawn.push(s)),
      fillText:vi.fn(),
      font:'',textBaseline:'',lineJoin:'',lineWidth:0,strokeStyle:'',fillStyle:'',
    } as unknown as CanvasRenderingContext2D
    drawPhotoText(ctx,200,100,[mark])
    expect(drawn.length).toBeGreaterThanOrEqual(1)
    expect(drawn.join('')).toContain('Привет')
    expect(ctx.fillText).toHaveBeenCalled()
    expect(ctx.restore).toHaveBeenCalled()
    expect(()=>drawPhotoText(ctx,40000,100,[mark]))
      .toThrow('viewer.text_invalid_canvas')
    expect(()=>drawPhotoText(ctx,200,100,[{
      ...mark,y:85,text:'one\ntwo\nthree\nfour\nfive',
    }])).toThrow('viewer.text_outside_frame')
  })
})
