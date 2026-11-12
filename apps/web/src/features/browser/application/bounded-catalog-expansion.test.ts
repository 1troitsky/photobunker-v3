import {describe,expect,it,vi} from 'vitest'
import {loadBoundedCatalogIndex} from './bounded-catalog-expansion'

const uuid=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
const page=(start:number,count:number)=>Array.from({length:count},
  (_,i)=>({mediaId:uuid(start+i),expiresAt:1890000000000}))

describe('P2 Browser opt-in bounded authorized catalog expansion',()=>{
  it('loads 51st+ opaque media IDs via strict cursor, without any private query',async()=>{
    const loader=vi.fn(async(after?:string)=>{
      if(after===undefined)return {items:page(1,50),nextCursor:uuid(50)}
      if(after===uuid(50))return {items:page(51,2),nextCursor:null}
      throw Error('unexpected_page')
    })
    const data=await loadBoundedCatalogIndex(loader,item=>item.mediaId,()=>true)
    expect(data.items).toHaveLength(52)
    expect(data.items[51]?.mediaId).toBe(uuid(52))
    expect(data).toMatchObject({complete:true,pages:2,nextCursor:null})
    expect(loader.mock.calls.map(args=>args[0])).toEqual([undefined,uuid(50)])
  })
  it('rejects duplicate/rollback/out-of-order or forged continuation',async()=>{
    const broken=[
      {items:page(1,49),nextCursor:uuid(49)},
      {items:page(1,50),nextCursor:uuid(40)},
      {items:[page(2,1)[0]!,page(1,1)[0]!],nextCursor:null},
      {items:[{mediaId:'not-uuid',expiresAt:0}],nextCursor:null},
    ]
    for(const response of broken)
      await expect(loadBoundedCatalogIndex(async()=>response,
        x=>x.mediaId,()=>true)).rejects.toThrow('assignment.invalid_cursor_page')
    const replay=vi.fn(async()=>({items:page(1,50),nextCursor:uuid(50)}))
    await expect(loadBoundedCatalogIndex(replay,x=>x.mediaId,()=>true))
      .rejects.toThrow('assignment.invalid_cursor_page')
    expect(replay).toHaveBeenCalledTimes(2)
  })
  it('bounds an endless but monotone index at ten pages, never claiming full coverage',async()=>{
    let counter=0
    const loader=vi.fn(async()=>{
      const result={items:page(counter*50+1,50),
        nextCursor:uuid((counter+1)*50)}
      counter++
      return result
    })
    const result=await loadBoundedCatalogIndex(loader,
      x=>x.mediaId,()=>true)
    expect(result.items).toHaveLength(500)
    expect(result).toMatchObject({complete:false,pages:10,nextCursor:uuid(500)})
    expect(loader).toHaveBeenCalledTimes(10)
    await expect(loadBoundedCatalogIndex(loader,x=>x.mediaId,()=>true,11))
      .rejects.toThrow('browser.invalid_catalog_page_limit')
  })
  it('cancels before the next fetch when account/query changes mid-request',async()=>{
    let live=true
    const loader=vi.fn(async()=>{
      live=false
      return {items:page(1,50),nextCursor:uuid(50)}
    })
    await expect(loadBoundedCatalogIndex(loader,x=>x.mediaId,()=>live))
      .rejects.toThrow('browser.catalog_search_cancelled')
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
