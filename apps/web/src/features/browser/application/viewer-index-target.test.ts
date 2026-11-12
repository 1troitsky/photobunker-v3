import {describe,expect,it,vi} from 'vitest'
import {findViewerTargetInBoundedIndex} from './viewer-index-target'

const id=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
const media=(start:number,count:number)=>Array.from({length:count},
  (_,i)=>({mediaId:id(start+i),expiresAt:1890000000000}))

describe('P2 V-38 File Viewer bounded authorized target discovery',()=>{
  it('reaches file 57 with authenticated strict 50+7 pagination',async()=>{
    const fetch=vi.fn(async(after:string)=>{
      expect(after).toBe(id(50))
      return {items:media(51,7),nextCursor:null}
    })
    const result=await findViewerTargetInBoundedIndex(
      {items:media(1,50),nextCursor:id(50)},id(57),
      fetch,x=>x.mediaId,()=>true)
    expect(result).toMatchObject({
      found:true,complete:true,pages:2,nextCursor:null,
    })
    expect(result.items).toHaveLength(57)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('returns first-page target without fetching another page',async()=>{
    const fetch=vi.fn(async()=>{throw Error('not_fetched')})
    const r=await findViewerTargetInBoundedIndex(
      {items:media(1,50),nextCursor:id(50)},id(20),
      fetch,x=>x.mediaId,()=>true)
    expect(r).toMatchObject({found:true,complete:false,pages:1})
    expect(fetch).not.toHaveBeenCalled()
  })
  it('refuses to claim complete coverage after 10 full pages',async()=>{
    let pages=1
    const fetch=vi.fn(async(cursor:string)=>{
      expect(cursor).toBe(id(pages*50))
      const result={items:media(pages*50+1,50),
        nextCursor:id((pages+1)*50)}
      pages++
      return result
    })
    const r=await findViewerTargetInBoundedIndex(
      {items:media(1,50),nextCursor:id(50)},id(750),
      fetch,x=>x.mediaId,()=>true)
    expect(r).toMatchObject({
      pages:10,found:false,complete:false,nextCursor:id(500),
    })
    expect(r.items).toHaveLength(500)
    expect(fetch).toHaveBeenCalledTimes(9)
    await expect(findViewerTargetInBoundedIndex(
      {items:[],nextCursor:null},id(1),fetch,x=>x.mediaId,()=>true,11))
      .rejects.toThrow('viewer.invalid_page_limit')
  })
  it('denies malformed first and subsequent pages, no result publication',async()=>{
    const first={items:media(1,50),nextCursor:id(50)}
    const failures=[
      {items:media(50,2),nextCursor:null},
      {items:media(51,1),nextCursor:id(51)},
      {items:[media(52,1)[0]!,media(51,1)[0]!],nextCursor:null},
      {items:[{mediaId:'INVALID',expiresAt:0}],nextCursor:null},
      {items:media(1,50),nextCursor:id(50)},
    ]
    for(const page of failures){
      await expect(findViewerTargetInBoundedIndex(first,id(80),
        async()=>page,x=>x.mediaId,()=>true))
        .rejects.toThrow('browser.invalid_cloud_catalog_page')
    }
    await expect(findViewerTargetInBoundedIndex(
      {items:media(1,2),nextCursor:id(2)},id(3),
      async()=>({items:[],nextCursor:null}),x=>x.mediaId,()=>true))
      .rejects.toThrow('browser.invalid_cloud_catalog_page')
  })
  it('cancels on changed device, route or account without publishing partial pages',async()=>{
    let live=true
    const fetch=vi.fn(async()=>{
      live=false
      return {items:media(51,2),nextCursor:null}
    })
    await expect(findViewerTargetInBoundedIndex(
      {items:media(1,50),nextCursor:id(50)},id(52),
      fetch,x=>x.mediaId,()=>live))
      .rejects.toThrow('viewer.index_cancelled')
    expect(fetch).toHaveBeenCalledOnce()
  })
})
