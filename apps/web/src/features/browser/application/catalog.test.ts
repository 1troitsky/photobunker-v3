import {describe,it,expect} from 'vitest'
import {buildCatalog,filterCatalog} from './catalog'
import type {StoredPhoto,CloudPhoto} from '../../photo-sync/application/p1-photo'
import type {StoredMedia,CloudMedia} from '../../media/application/media-outbox'

const photo=(id:string,createdAt:number,state:'queued'|'synced'='queued')=>({
  photoId:id,createdAt,expiresAt:createdAt+10000,state,key:'a/'+id,
}) as StoredPhoto
const media=(id:string,type:'video'|'audio',createdAt:number)=>({
  mediaId:id,mediaType:type,createdAt,expiresAt:createdAt+20000,
  plainBytes:4096,state:'retry',key:'a/'+id,
}) as StoredMedia
const remotePhoto=(id:string):CloudPhoto=>({
  photoId:id,expiresAt:60000,metadataAssetId:null,
})
const remoteMedia=(id:string,type:'video'|'audio'):CloudMedia=>({
  mediaId:id,mediaType:type,plainBytes:2048,expiresAt:50000,
})
describe('Browser v3 encrypted catalog union',()=>{
  it('deduplicates local/cloud by protocol ID, preserving offline state',()=>{
    const rows=buildCatalog(
      [photo('p1',5000)],
      [remotePhoto('p1'),remotePhoto('p2')],
      [media('m1','video',8000)],
      [remoteMedia('m1','video'),remoteMedia('m2','audio')],
    )
    expect(rows).toHaveLength(4)
    expect(rows.find(x=>x.key==='photo:p1')).toMatchObject({
      local:true,cloud:true,state:'queued',source:'photo',
    })
    expect(rows.find(x=>x.key==='photo:p2')).toMatchObject({
      local:false,cloud:true,createdAt:null,source:'photo',
    })
    expect(rows.find(x=>x.key==='media:m1')).toMatchObject({
      local:true,cloud:true,state:'retry',type:'video',
    })
    expect(rows.find(x=>x.key==='media:m2')).toMatchObject({
      local:false,cloud:true,type:'audio',
    })
  })
  it('never merges different protocols merely because opaque IDs match',()=>{
    const rows=buildCatalog(
      [photo('same-id',1000)],[],[media('same-id','audio',1000)],[],
    )
    expect(rows).toHaveLength(2)
    expect(rows.map(x=>x.key)).toEqual(['photo:same-id','media:same-id'])
  })
  it('works entirely offline and sorts pending before unknown cloud timestamps',()=>{
    const rows=buildCatalog(
      [photo('recent',2000),photo('old',1000)],[],
      [media('video','video',3000)],[remoteMedia('cloud','audio')],
    )
    expect(filterCatalog(rows,{type:'all',query:'',sort:'newest'})
      .map(x=>x.id)).toEqual(['video','recent','old','cloud'])
    expect(filterCatalog(rows,{type:'all',query:'',sort:'oldest'})
      .map(x=>x.id)).toEqual(['old','recent','video','cloud'])
  })
  it('filters video/audio/photo independently; matches ID, not secret filename',()=>{
    const rows=buildCatalog(
      [photo('aabbcc',5000)],[],[
        media('dd0022','video',7000),media('ee0033','audio',6000),
      ],[],
    )
    expect(filterCatalog(rows,{type:'video',query:'',sort:'expiry'})
      .map(x=>x.id)).toEqual(['dd0022'])
    expect(filterCatalog(rows,{type:'audio',query:'',sort:'expiry'})
      .map(x=>x.id)).toEqual(['ee0033'])
    expect(filterCatalog(rows,{type:'photo',query:'',sort:'expiry'})
      .map(x=>x.id)).toEqual(['aabbcc'])
    expect(filterCatalog(rows,{type:'all',query:'  DD00  ',sort:'newest'})
      .map(x=>x.id)).toEqual(['dd0022'])
    expect(filterCatalog(rows,{type:'all',query:'secret.jpg',sort:'newest'}))
      .toEqual([])
  })
  it('sorts by actual TTL regardless of local/cloud origin',()=>{
    const rows=buildCatalog(
      [photo('late',3000)],[],[media('soon','audio',1000)],[],
    )
    expect(filterCatalog(rows,{type:'all',query:'',sort:'expiry'})
      .map(x=>x.id)).toEqual(['late','soon'])
  })
})
