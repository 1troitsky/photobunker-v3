import {describe,expect,it,vi} from 'vitest'
import {planArchiveBatch,executeArchiveBatch} from './archive-batch'
import type {CatalogItem} from './catalog'
import type {ArchiveEntry,ArchiveAck} from './browser-archive'

function media(id:string,cloud=true):CatalogItem{
  return {key:'media:'+id,id,source:'media',type:'audio',
    local:true,cloud,state:'synced',createdAt:1,expiresAt:Date.now()+100000,
    bytes:1024}
}
function archived(id:string,revision=1):ArchiveEntry{
  return {entryId:crypto.randomUUID(),assetId:id,kind:'media',
    revision,state:'archived',archiveUntilMs:Date.now()+100000,
    expiresAt:Date.now()+200000,mediaType:'audio',plainBytes:1000,
    physicalStatus:'not_started'}
}
function ack(id:string,state:ArchiveAck['state']):ArchiveAck{
  return {entryId:crypto.randomUUID(),assetId:id,kind:'media',
    revision:1,state,archiveUntilMs:Date.now()+20000,
    expiresAt:Date.now()+100000,physicalStatus:'not_started',unchanged:false}
}
describe('signed Archive batch preflight and fail-fast',()=>{
  it('requires each active file to be confirmed by server; no local-only deletes',()=>{
    const a=media(crypto.randomUUID(),false)
    expect(()=>planArchiveBatch({
      selectedKeys:[a.key],visible:[a],archived:new Map(),
      tab:'all',useArchive:true,action:'archive',
    })).toThrow('browser.archive_batch_requires_cloud_owner')
  })
  it('enforces operator-independent preference action and bound of 25',()=>{
    const a=media(crypto.randomUUID())
    expect(()=>planArchiveBatch({
      selectedKeys:[a.key],visible:[a],archived:new Map(),
      tab:'all',useArchive:false,action:'archive',
    })).toThrow('browser.archive_batch_action_forbidden')
    expect(planArchiveBatch({
      selectedKeys:[a.key],visible:[a],archived:new Map(),
      tab:'all',useArchive:false,action:'delete',
    }).rows).toHaveLength(1)
    expect(()=>planArchiveBatch({
      selectedKeys:Array.from({length:26},(_,i)=>'media:'+i),
      visible:[],archived:new Map(),tab:'all',useArchive:false,action:'delete',
    })).toThrow('browser.archive_batch_selection_limit')
  })
  it('accepts only archived items for restore or permanent deletion',()=>{
    const a=media(crypto.randomUUID()),b=media(crypto.randomUUID())
    const map=new Map<string,ArchiveEntry>([[a.key,archived(a.id)]])
    const plan=planArchiveBatch({
      selectedKeys:[a.key],visible:[a,b],archived:map,
      tab:'archive',useArchive:true,action:'restore',
    })
    expect(plan.rows[0]?.target).toEqual(map.get(a.key))
    expect(()=>planArchiveBatch({
      selectedKeys:[a.key,b.key],visible:[a,b],archived:map,
      tab:'archive',useArchive:true,action:'delete',
    })).toThrow('browser.archive_batch_requires_archived')
    expect(()=>planArchiveBatch({
      selectedKeys:[a.key,a.key],visible:[a],archived:map,
      tab:'archive',useArchive:true,action:'restore',
    })).toThrow('browser.archive_batch_selection_limit')
  })
  it('stops at first failed signed call, preserving all later keys',async()=>{
    const ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()]
    const items=ids.map(id=>media(id))
    const plan=planArchiveBatch({
      selectedKeys:items.map(x=>x.key),visible:items,archived:new Map(),
      tab:'all',useArchive:true,action:'archive',
    })
    const send=vi.fn(async(t:CatalogItem|ArchiveEntry)=>{
      const id='id' in t?t.id:t.assetId
      if(id===ids[1])throw Error('lost-ack')
      return ack(id,'archived')
    })
    const removed:string[]=[]
    const r=await executeArchiveBatch(plan,send,()=>true,key=>removed.push(key))
    expect(r.completed).toEqual([items[0]!.key])
    expect(r.failedKey).toBe(items[1]!.key)
    expect(send).toHaveBeenCalledTimes(2)
    expect(removed).toEqual([items[0]!.key])
  })
  it('blocks continuation if identity changes after an acknowledged action',async()=>{
    const items=[media(crypto.randomUUID()),media(crypto.randomUUID())]
    const plan=planArchiveBatch({
      selectedKeys:items.map(x=>x.key),visible:items,archived:new Map(),
      tab:'all',useArchive:false,action:'delete',
    })
    let active=true
    const send=vi.fn(async(t:CatalogItem|ArchiveEntry)=>{
      active=false
      return ack('id' in t?t.id:t.assetId,'deleting')
    })
    const r=await executeArchiveBatch(plan,send,()=>active,()=>{})
    expect(r.completed).toHaveLength(0)
    expect(r.failedKey).toBe(items[0]!.key)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('rejects invalid server receipts without continuing',async()=>{
    const a=media(crypto.randomUUID())
    const plan=planArchiveBatch({selectedKeys:[a.key],visible:[a],
      archived:new Map(),tab:'all',useArchive:true,action:'archive'})
    const r=await executeArchiveBatch(plan,
      async()=>ack(crypto.randomUUID(),'archived'),()=>true,()=>{})
    expect(r.completed).toHaveLength(0)
    expect(r.failedKey).toBe(a.key)
  })
})
