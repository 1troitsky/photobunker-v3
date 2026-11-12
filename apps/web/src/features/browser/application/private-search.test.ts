import {afterEach,describe,expect,it,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import type {CatalogItem} from './catalog'
import {filterCatalog} from './catalog'
import {
  normalizePrivateSearch,privateMetadataMatches,searchPrivateMetadata,
  searchPrivateMetadataBatches,
} from './private-search'

const mocks=vi.hoisted(()=>({
  localPhoto:vi.fn(),cloudPhoto:vi.fn(),
  localMedia:vi.fn(),cloudMedia:vi.fn(),
}))
vi.mock('../../photo-sync/application/p1-photo',()=>({
  readLocalPhotoMetadata:mocks.localPhoto,
  readCloudPhotoMetadata:mocks.cloudPhoto,
}))
vi.mock('../../media/application/media-outbox',()=>({
  readLocalMediaMetadata:mocks.localMedia,
  readCloudMediaMetadata:mocks.cloudMedia,
}))
afterEach(()=>{
  activeSession.value=null
  Object.values(mocks).forEach(m=>m.mockReset())
})
function owner(online=true):Session{
  const s={accountId:crypto.randomUUID(),deviceId:crypto.randomUUID(),
    online} as Session
  activeSession.value=s
  return s
}
function media(id:string,local=true,cloud=true):CatalogItem{
  return {key:'media:'+id,id,source:'media',type:'audio',
    local,cloud,state:local?'queued':null,createdAt:local?Date.now():null,
    expiresAt:Date.now()+86400000,bytes:512}
}
function photo(id:string,local=true,cloud=true):CatalogItem{
  return {...media(id,local,cloud),key:'photo:'+id,
    source:'photo',type:'photo'}
}
describe('P2 Browser V-33 opt-in 1000-row metadata-only search',()=>{
  it('finds a confidential filename at row 201 without submitting a plaintext query',async()=>{
    owner()
    const rows=Array.from({length:205},(_,i)=>media(
      '00000000-0000-4000-8000-'+(i+1).toString(16).padStart(12,'0'),
      false,true))
    mocks.cloudMedia.mockImplementation(async(id:string)=>({
      fileName:id===rows[204]?.id?'FOUND-ONLY-AT-205.wav':'ordinary.wav',
      description:'private evidence',tags:[],category:'audio',
    }))
    const progress:Array<[number,number]>=[]
    const result=await searchPrivateMetadataBatches('FOUND-ONLY-AT-205',
      rows,()=>true,(completed,total)=>progress.push([completed,total]))
    expect(result.scanned).toBe(205)
    expect(result.total).toBe(205)
    expect([...result.matches]).toEqual([rows[204]?.key])
    expect(progress).toEqual([[200,205],[205,205]])
    expect(mocks.cloudMedia).toHaveBeenCalledTimes(205)
    // The reader receives only opaque media IDs, never query, filename or GPS.
    expect(JSON.stringify(mocks.cloudMedia.mock.calls))
      .not.toContain('FOUND-ONLY-AT-205')
  })
  it('rejects duplicated rows, >1000 and cancels between batches',async()=>{
    owner()
    const row=media(crypto.randomUUID(),false,true)
    await expect(searchPrivateMetadataBatches('private',[row,row]))
      .rejects.toThrow('browser.search_duplicate_row')
    await expect(searchPrivateMetadataBatches('private',
      Array.from({length:1001},(_,i)=>media(
        '00000000-0000-4000-8000-'+(i+1).toString(16).padStart(12,'0'),
        false,true,
      )))).rejects.toThrow('browser.expanded_search_limit')
    let active=true
    const rows=Array.from({length:205},()=>media(crypto.randomUUID(),false,true))
    mocks.cloudMedia.mockResolvedValue({fileName:'private-note.wav'})
    const seen:number[]=[]
    await expect(searchPrivateMetadataBatches('private',rows,()=>active,
      checked=>{seen.push(checked);active=false}))
      .rejects.toThrow('browser.search_session_changed')
    expect(seen).toEqual([200])
    expect(mocks.cloudMedia).toHaveBeenCalledTimes(200)
  })
})

describe('P2 Browser ephemeral, owner-only E2EE search',()=>{
  it('matches normalized Cyrillic filename, descriptions, categories and tags',()=>{
    expect(normalizePrivateSearch('  ＲＥＰＯＲＴ  ')).toBe('report')
    const m={fileName:'Отчёт-Смена.WAV',category:'ПОЛЕ',
      description:'Видеоотчёт СЕКРЕТНЫЙ',tags:['Свидетельство','ночь']}
    expect(privateMetadataMatches('отчёт',m)).toBe(true)
    expect(privateMetadataMatches('ПОЛЕ Свидетельство',m)).toBe(true)
    expect(privateMetadataMatches('секретный ночь',m)).toBe(true)
    expect(privateMetadataMatches('неизвестно',m)).toBe(false)
  })
  it('reads local ciphertext metadata, never full media or network for offline media',async()=>{
    owner(false)
    const id=crypto.randomUUID()
    const row=media(id,true,true)
    mocks.localMedia.mockResolvedValue({
      fileName:'PRIVATE-VOCAL-TRACK.wav',
      description:'Скрытая запись',category:'Полевые данные',
      tags:['свидетельство'],
    })
    const result=await searchPrivateMetadata('скрытая запись',[row])
    expect(result.matches.has(row.key)).toBe(true)
    expect(result.scanned).toBe(1)
    expect(result.failed).toBe(0)
    expect(mocks.localMedia).toHaveBeenCalledWith(id)
    expect(mocks.cloudMedia).not.toHaveBeenCalled()
    // A public ID-only search remains independent of metadata processing.
    expect(filterCatalog([row],{type:'all',query:id.slice(0,6),
      sort:'newest',privateMatches:result.matches})).toHaveLength(1)
  })
  it('cloud-only search calls metadata endpoint with opaque ID, not private query',async()=>{
    owner()
    const id=crypto.randomUUID()
    const row=media(id,false,true)
    mocks.cloudMedia.mockResolvedValue({
      fileName:'PRIVATE-CLOUD-AUDIO.wav',category:'Evidence',
      description:'Confidential transcript',tags:['only-client'],
    })
    const result=await searchPrivateMetadata('confidential',[row])
    expect(result.matches.has(row.key)).toBe(true)
    expect(mocks.cloudMedia).toHaveBeenCalledExactlyOnceWith(id)
    expect(mocks.localMedia).not.toHaveBeenCalled()
    expect(JSON.stringify([...result.matches])).not.toContain('confidential')
  })
  it('photo metadata includes encrypted description/category/tags, never fabricated filename',async()=>{
    owner()
    const p=photo(crypto.randomUUID())
    mocks.localPhoto.mockResolvedValue({
      category:'Report',description:'SECRET PHOTO DETAILS',tags:['field'],
    })
    const r=await searchPrivateMetadata('secret field',[p])
    expect(r.matches.has(p.key)).toBe(true)
    expect(mocks.localPhoto).toHaveBeenCalledWith(p.id)
  })
  it('falls back to authenticated cloud metadata after damaged local ciphertext',async()=>{
    owner()
    const row=media(crypto.randomUUID())
    mocks.localMedia.mockRejectedValue(Error('media.chunk_corrupt'))
    mocks.cloudMedia.mockResolvedValue({
      fileName:'RECOVERED-VOICE.wav',
    })
    const r=await searchPrivateMetadata('recovered',[row])
    expect(r.matches).toEqual(new Set([row.key]))
    expect(r.failed).toBe(0)
    expect(mocks.localMedia).toHaveBeenCalledOnce()
    expect(mocks.cloudMedia).toHaveBeenCalledOnce()
  })
  it('reports unreadable/expired/unavailable files as incomplete rather than absent',async()=>{
    owner(false)
    const corrupt=media(crypto.randomUUID(),true,false)
    const cloudOnly=media(crypto.randomUUID(),false,true)
    const expired=photo(crypto.randomUUID())
    expired.expiresAt=Date.now()-5000
    mocks.localMedia.mockRejectedValue(Error('media.chunk_corrupt'))
    const r=await searchPrivateMetadata('private',[corrupt,cloudOnly,expired])
    expect(r.matches.size).toBe(0)
    expect(r.failed).toBe(1)
    expect(r.skipped).toBe(2)
    expect(r.total).toBe(3)
  })
  it('fences stale query and account switch without leaking prior results',async()=>{
    const s=owner()
    const row=photo(crypto.randomUUID())
    let finish:((value:{description:string})=>void)|undefined
    mocks.localPhoto.mockImplementation(()=>new Promise(resolve=>{
      finish=resolve
    }))
    const p=searchPrivateMetadata('secret',[row],()=>true)
    await Promise.resolve()
    activeSession.value={...s,accountId:crypto.randomUUID()} as Session
    finish?.({description:'secret after logout'})
    await expect(p).rejects.toThrow('browser.search_session_changed')
    expect(mocks.cloudPhoto).not.toHaveBeenCalled()
  })
  it('cancels old query after debounce epoch changes and refuses unbounded scans',async()=>{
    owner()
    const row=media(crypto.randomUUID(),true,false)
    mocks.localMedia.mockResolvedValue({fileName:'private.wav'})
    await expect(searchPrivateMetadata('private',[row],()=>false))
      .rejects.toThrow('browser.search_session_changed')
    await expect(searchPrivateMetadata('x',[row]))
      .rejects.toThrow('browser.search_query_limit')
    await expect(searchPrivateMetadata('hello',Array.from({length:201},
      (_,i)=>media('id-'+i))))
      .rejects.toThrow('browser.search_page_limit')
    await expect(searchPrivateMetadata('hello',[row,row]))
      .rejects.toThrow('browser.search_duplicate_row')
  })
})
