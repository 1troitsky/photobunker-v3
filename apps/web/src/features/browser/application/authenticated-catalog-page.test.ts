import {describe,expect,it} from 'vitest'
import {appendAuthenticatedCatalogPage} from './authenticated-catalog-page'

const uuid=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
const photo=(n:number)=>({photoId:uuid(n),expiresAt:1890000000000})
const media=(n:number)=>({mediaId:uuid(n),mediaType:'photo',expiresAt:1890000000000})

describe('P2 V-34 ordinary authenticated Browser pagination does not trust opaque server cursors',()=>{
  it('appends 50+2 P1 photographs and P2 MediaFile pages independently',()=>{
    const p1=appendAuthenticatedCatalogPage([],
      {items:Array.from({length:50},(_,i)=>photo(i+1)),nextCursor:uuid(50)},
      null,x=>x.photoId)
    const p2=appendAuthenticatedCatalogPage([],
      {items:Array.from({length:50},(_,i)=>media(i+1)),nextCursor:uuid(50)},
      null,x=>x.mediaId)
    const nextPhotos=appendAuthenticatedCatalogPage(p1.items,
      {items:[photo(51),photo(52)],nextCursor:null},
      p1.nextCursor,x=>x.photoId)
    const nextMedia=appendAuthenticatedCatalogPage(p2.items,
      {items:[media(51),media(52)],nextCursor:null},
      p2.nextCursor,x=>x.mediaId)
    expect(nextPhotos.items).toHaveLength(52)
    expect(nextMedia.items).toHaveLength(52)
    expect(nextPhotos.items.at(-1)?.photoId).toBe(uuid(52))
    expect(nextMedia.items.at(-1)?.mediaId).toBe(uuid(52))
    expect(nextPhotos.nextCursor).toBeNull()
    expect(nextMedia.nextCursor).toBeNull()
  })
  it('rejects a spoofed page and leaves the already loaded catalog unchanged',()=>{
    const previous=Array.from({length:50},(_,i)=>photo(i+1))
    const original=JSON.stringify(previous)
    const failures=[
      {items:[photo(50),photo(51)],nextCursor:null},
      {items:[photo(53),photo(52)],nextCursor:null},
      {items:[photo(51)],nextCursor:uuid(51)},
      {items:Array.from({length:50},(_,i)=>photo(i+51)),nextCursor:uuid(95)},
      {items:Array.from({length:51},(_,i)=>photo(i+51)),nextCursor:null},
      {items:[{photoId:'INVALID',expiresAt:1}],nextCursor:null},
    ]
    for(const page of failures)
      expect(()=>appendAuthenticatedCatalogPage(previous,page,
        uuid(50),x=>x.photoId))
        .toThrow('browser.invalid_cloud_catalog_page')
    expect(JSON.stringify(previous)).toBe(original)
  })
  it('fails on fake initial continuation and skips no UUIDs due to replay',()=>{
    expect(()=>appendAuthenticatedCatalogPage([],
      {items:[photo(1)],nextCursor:uuid(1)},null,x=>x.photoId))
      .toThrow('browser.invalid_cloud_catalog_page')
    const rows=Array.from({length:50},(_,i)=>media(i+1))
    expect(()=>appendAuthenticatedCatalogPage(rows,
      {items:rows,nextCursor:uuid(50)},uuid(50),x=>x.mediaId))
      .toThrow('browser.invalid_cloud_catalog_page')
  })
})
