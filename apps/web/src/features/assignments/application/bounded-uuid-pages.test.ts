import {describe,expect,it} from 'vitest'
import {appendBoundedUuidPage} from './bounded-uuid-pages'
const id=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
const row=(n:number)=>({inviteId:id(n),assignmentId:id(n+1000)})
describe('P2 V-26 bounded account-scoped assignment/inbox cursor pages',()=>{
  it('combines a complete 50+2 recipient inbox without losing the 51st invitation',()=>{
    const first=appendBoundedUuidPage([],{
      items:Array.from({length:50},(_,i)=>row(i+1)),nextCursor:id(50),
    },null,x=>x.inviteId)
    expect(first.items).toHaveLength(50)
    const second=appendBoundedUuidPage(first.items,{
      items:[row(51),row(52)],nextCursor:null,
    },first.nextCursor,x=>x.inviteId)
    expect(second.items).toHaveLength(52)
    expect(second.items[51]!.inviteId).toBe(id(52))
    expect(second.nextCursor).toBeNull()
  })
  it('paginates signed assignment overview records independently of inbox IDs',()=>{
    const first=appendBoundedUuidPage([],{
      items:Array.from({length:50},(_,i)=>row(i+1)),nextCursor:id(1050),
    },null,x=>x.assignmentId)
    const second=appendBoundedUuidPage(first.items,{
      items:[row(51),row(52)],nextCursor:null,
    },first.nextCursor,x=>x.assignmentId)
    expect(second.items.map(x=>x.assignmentId)).toHaveLength(52)
  })
  it('rejects duplicates, gaps/forged cursor, rollback and repeated pages',()=>{
    const first=appendBoundedUuidPage([],{
      items:Array.from({length:50},(_,i)=>row(i+1)),nextCursor:id(50),
    },null,x=>x.inviteId)
    const invalid=[
      {items:[row(50)],nextCursor:null},
      {items:[row(52),row(51)],nextCursor:null},
      {items:[row(51)],nextCursor:id(50)},
      {items:[row(51)],nextCursor:id(500)},
      {items:Array.from({length:51},(_,i)=>row(i+51)),nextCursor:null},
    ]
    for(const page of invalid){
      expect(()=>appendBoundedUuidPage(
        first.items,page,first.nextCursor,x=>x.inviteId,
      )).toThrow('assignment.invalid_cursor_page')
    }
  })
  it('rejects bad initial cursor, invalid UUIDs and broken previous-page continuity',()=>{
    expect(()=>appendBoundedUuidPage([],
      {items:[row(1)],nextCursor:null},'bad',x=>x.inviteId))
      .toThrow('assignment.invalid_cursor_page')
    expect(()=>appendBoundedUuidPage([],
      {items:[{inviteId:'bad'}],nextCursor:null},null,x=>x.inviteId))
      .toThrow('assignment.invalid_cursor_page')
    expect(()=>appendBoundedUuidPage([row(1)],
      {items:[row(2)],nextCursor:null},id(3),x=>x.inviteId))
      .toThrow('assignment.invalid_cursor_page')
  })
})
