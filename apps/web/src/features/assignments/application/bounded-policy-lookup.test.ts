import {describe,expect,it,vi} from 'vitest'
import {findBoundedAssignmentPolicy} from './bounded-policy-lookup'

const id=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
type Row={assignmentId:string;revision:number}
const rows=(start:number,count:number):Row[]=>
  Array.from({length:count},(_,i)=>({assignmentId:id(start+i),revision:1}))

describe('P2 V-32 account-signed media policy search is bounded and cursor-safe',()=>{
  it('finds an assignment beyond the first 50 without fetching unrelated later pages',async()=>{
    const first=rows(1,50),second=rows(51,4)
    const fetch=vi.fn(async(after?:string)=>{
      if(!after)return {items:first,nextCursor:id(50)}
      if(after===id(50))return {items:second,nextCursor:null}
      throw Error('unexpected_page')
    })
    await expect(findBoundedAssignmentPolicy(id(53),fetch))
      .resolves.toEqual({assignmentId:id(53),revision:1})
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('returns immediately for the first verified page, without reading more data',async()=>{
    const fetch=vi.fn(async(after?:string)=>{
      if(after)throw Error('unexpected_additional_page')
      return {items:rows(1,50),nextCursor:id(50)}
    })
    await expect(findBoundedAssignmentPolicy(id(1),fetch))
      .resolves.toMatchObject({assignmentId:id(1)})
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('returns undefined only on a well-formed terminal page',async()=>{
    await expect(findBoundedAssignmentPolicy(id(99),async()=>({
      items:rows(1,2),nextCursor:null,
    }))).resolves.toBeUndefined()
    await expect(findBoundedAssignmentPolicy(id(1),async()=>({
      items:[],nextCursor:null,
    }))).resolves.toBeUndefined()
  })
  it('fails closed on replayed, backwards, truncated, unordered or forged cursors',async()=>{
    const first=rows(1,50)
    const malformed=[
      {items:first.slice(0,2),nextCursor:id(2)},
      {items:[first[1]!,first[0]!],nextCursor:null},
      {items:[{assignmentId:'not-a-uuid',revision:1}],nextCursor:null},
      {items:first,nextCursor:id(1)},
      {items:[...first,first[0]!],nextCursor:id(50)},
    ]
    for(const page of malformed){
      await expect(findBoundedAssignmentPolicy(id(1),async()=>page))
        .rejects.toThrow('assignment.invalid_cursor_page')
    }
    const replay=vi.fn(async(after?:string)=>({
      items:first,nextCursor:id(50),
    }))
    await expect(findBoundedAssignmentPolicy(id(60),replay))
      .rejects.toThrow('assignment.invalid_cursor_page')
    expect(replay).toHaveBeenCalledTimes(2)
  })
  it('never permits unlimited network pagination even if each page is otherwise valid',async()=>{
    let calls=0
    const fetch=vi.fn(async(after?:string)=>{
      const start=calls*50+1
      expect(after).toBe(calls===0?undefined:id(start-1))
      calls++
      return {items:rows(start,50),nextCursor:id(start+49)}
    })
    await expect(findBoundedAssignmentPolicy(id(6000),fetch))
      .rejects.toThrow('assignment.media_policy_pagination_limit')
    expect(fetch).toHaveBeenCalledTimes(100)
  })
})
