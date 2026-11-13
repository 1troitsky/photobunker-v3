import {describe,expect,it} from 'vitest'
import {photoInlinePoint,prepareInlineText} from './photo-inline-placement'
import type {PhotoTextMark} from './photo-text'

const sample:PhotoTextMark={
  id:'11111111-1111-4111-8111-111111111111',
  text:'Visible annotation',x:25,y:30,size:6,color:'#ffffff',
}
describe('P2 V-49 inline Photo Editor label placement',()=>{
  it('maps the displayed image rect, not the viewport, to percentages',()=>{
    const r={left:125,top:75,width:320,height:200}
    expect(photoInlinePoint(205,135,r)).toEqual({x:25,y:30})
    expect(photoInlinePoint(445,275,r)).toEqual({x:85,y:85})
    expect(photoInlinePoint(-100,-100,r)).toEqual({x:0,y:0})
    expect(photoInlinePoint(125,75,r)).toEqual({x:0,y:0})
  })
  it('refuses zero-size or non-finite canvas coordinates',()=>{
    expect(()=>photoInlinePoint(1,1,{
      left:0,top:0,width:0,height:200,
    })).toThrow('viewer.text_invalid_canvas')
    expect(()=>photoInlinePoint(NaN,1,{
      left:0,top:0,width:100,height:100,
    })).toThrow('viewer.text_invalid_canvas')
  })
  it('does not create a new mark for blank text and preserves old mark',()=>{
    expect(prepareInlineText({...sample,text:'  '})).toBeNull()
    expect(prepareInlineText({...sample,text:'\n'})).toBeNull()
    expect(prepareInlineText({...sample,text:'  Реальная надпись  '}))
      .toEqual({...sample,text:'Реальная надпись'})
  })
  it('rejects control characters, too-long text and invalid coordinates',()=>{
    expect(()=>prepareInlineText({...sample,text:'secret\u0000txt'}))
      .toThrow('viewer.text_invalid_mark')
    expect(()=>prepareInlineText({...sample,text:'t'.repeat(221)}))
      .toThrow('viewer.text_invalid_mark')
    expect(()=>prepareInlineText({...sample,x:100}))
      .toThrow('viewer.text_invalid_mark')
  })
})
