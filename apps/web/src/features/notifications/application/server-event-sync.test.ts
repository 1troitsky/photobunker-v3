import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeSession, type Session } from '../../identity/application/session'
import { freshPackage } from '../../identity/infrastructure/crypto'
import { listLocalNotifications, markNotificationRead } from './local-inbox'

const mockApi=vi.hoisted(()=>({jsonApi:vi.fn()}))
vi.mock('../../identity/infrastructure/api',()=>mockApi)
import { syncServerNotifications, resolveNotificationTarget } from './server-event-sync'

const EVENT='44444444-4444-4444-8444-444444444444'
let session:Session
beforeEach(async()=>{
  mockApi.jsonApi.mockReset()
  const accountId=crypto.randomUUID()
  const {pkg}=await freshPackage(accountId)
  session={accountId,deviceId:crypto.randomUUID(),pkg,online:true} as Session
  activeSession.value=session
})
afterEach(()=>{activeSession.value=null})

describe('#198 trusted event replay → encrypted IndexedDB',()=>{
  it('persists before advancing, dedupes reload and preserves read state',async()=>{
    const item={id:EVENT,kind:'security',targetId:null,occurredAt:1800000000000}
    mockApi.jsonApi
      .mockResolvedValueOnce({schemaVersion:1,items:[item],nextCursor:'1',hasMore:true})
      .mockResolvedValueOnce({schemaVersion:1,acknowledgedCursor:'1',advanced:true})
      .mockResolvedValueOnce({schemaVersion:1,items:[],nextCursor:'2',hasMore:false})
      .mockResolvedValueOnce({schemaVersion:1,acknowledgedCursor:'2',advanced:true})
    expect(await syncServerNotifications()).toEqual({saved:1,pages:2})
    expect(mockApi.jsonApi.mock.calls.map(c=>c[0]))
      .toEqual(['/notifications/v1/events?after=0','/notifications/v1/ack',
        '/notifications/v1/events?after=1','/notifications/v1/ack'])
    expect((await listLocalNotifications())[0]).toMatchObject(item)
    await markNotificationRead(EVENT,1800000000001)
    mockApi.jsonApi
      .mockResolvedValueOnce({schemaVersion:1,items:[item],nextCursor:'1',hasMore:false})
      .mockResolvedValueOnce({schemaVersion:1,acknowledgedCursor:'2',advanced:false})
    await syncServerNotifications() // replay from 0, encrypted dedupe
    expect((await listLocalNotifications())[0]?.readAt).toBe(1800000000001)
    expect((await listLocalNotifications())).toHaveLength(1)
  })
  it('does not fetch the next page after corrupt/forged local event',async()=>{
    mockApi.jsonApi.mockResolvedValueOnce({
      schemaVersion:1,
      items:[{id:EVENT,kind:'security',targetId:null,
        occurredAt:1800000000000,filename:'PRIVATE'}],
      nextCursor:'1',hasMore:true,
    })
    await expect(syncServerNotifications()).rejects.toThrow('notifications.invalid_event')
    expect(mockApi.jsonApi).toHaveBeenCalledTimes(1)
    expect(await listLocalNotifications()).toEqual([])
  })
  it('sends no server ACK before encrypted persistence and retries after lost ACK',async()=>{
    const item={id:EVENT,kind:'security',targetId:null,occurredAt:1800000000000}
    mockApi.jsonApi
      .mockResolvedValueOnce({schemaVersion:1,items:[item],nextCursor:'1',hasMore:false})
      .mockRejectedValueOnce(new Error('api.http_503'))
    await expect(syncServerNotifications()).rejects.toThrow('api.http_503')
    expect(mockApi.jsonApi.mock.calls.map(c=>c[0])).toEqual([
      '/notifications/v1/events?after=0','/notifications/v1/ack',
    ])
    expect((await listLocalNotifications())).toHaveLength(1)
    mockApi.jsonApi
      .mockResolvedValueOnce({schemaVersion:1,items:[item],nextCursor:'1',hasMore:false})
      .mockResolvedValueOnce({schemaVersion:1,acknowledgedCursor:'1',advanced:true})
    await expect(syncServerNotifications()).resolves.toEqual({saved:1,pages:1})
    expect((await listLocalNotifications())).toHaveLength(1)
    const calls=mockApi.jsonApi.mock.calls
    expect(calls.at(-1)).toEqual(['/notifications/v1/ack','POST',{cursor:'1'}])
  })
  it('rejects forged or regressed ACK response',async()=>{
    mockApi.jsonApi
      .mockResolvedValueOnce({schemaVersion:1,items:[],nextCursor:'2',hasMore:false})
      .mockResolvedValueOnce({schemaVersion:1,acknowledgedCursor:'1',advanced:true})
    await expect(syncServerNotifications()).rejects.toThrow('notifications.invalid_ack')
  })
  it('refuses cursor rollback, missing keys and frozen pagination',async()=>{
    for(const bad of [
      {schemaVersion:1,items:[],nextCursor:'0',hasMore:true},
      {schemaVersion:1,items:[],nextCursor:'01',hasMore:false},
      {schemaVersion:1,items:[],nextCursor:'9007199254740992',hasMore:false},
      {schemaVersion:1,items:[],nextCursor:'0',hasMore:false,private:'leak'},
    ]){
      mockApi.jsonApi.mockResolvedValueOnce(bad)
      await expect(syncServerNotifications()).rejects.toThrow()
    }
  })
  it('rejects device/account switch before writing server payload',async()=>{
    mockApi.jsonApi.mockImplementationOnce(async()=>{
      activeSession.value={...session,deviceId:crypto.randomUUID()}
      return {schemaVersion:1,items:[{
        id:EVENT,kind:'security',targetId:null,occurredAt:1800000000000,
      }],nextCursor:'1',hasMore:false}
    })
    await expect(syncServerNotifications()).rejects.toThrow('notifications.session_changed')
    activeSession.value=session
    expect(await listLocalNotifications()).toEqual([])
  })
  it('resolves a target only through fresh server ACL and exact envelope',async()=>{
    const targetId='55555555-5555-4555-8555-555555555555'
    mockApi.jsonApi.mockResolvedValueOnce({
      schemaVersion:1,kind:'new-file',targetId,
    })
    await expect(resolveNotificationTarget(EVENT)).resolves
      .toEqual({kind:'new-file',targetId})
    expect(mockApi.jsonApi).toHaveBeenCalledWith(
      '/notifications/v1/events/'+EVENT+'/target',
    )
    mockApi.jsonApi.mockResolvedValueOnce({
      schemaVersion:1,kind:'new-file',targetId,caption:'SECRET',
    })
    await expect(resolveNotificationTarget(EVENT)).rejects
      .toThrow('notifications.invalid_target')
    await expect(resolveNotificationTarget('invalid')).rejects
      .toThrow('notifications.invalid_target')
  })
  it('rejects stale notification target after session switch',async()=>{
    mockApi.jsonApi.mockImplementationOnce(async()=>{
      activeSession.value={...session,deviceId:crypto.randomUUID()}
      return {schemaVersion:1,kind:'new-file',
        targetId:'55555555-5555-4555-8555-555555555555'}
    })
    await expect(resolveNotificationTarget(EVENT)).rejects
      .toThrow('notifications.session_changed')
  })
  it('never tries network when session is offline',async()=>{
    activeSession.value={...session,online:false}
    await expect(syncServerNotifications()).rejects.toThrow('notifications.offline')
    expect(mockApi.jsonApi).not.toHaveBeenCalled()
  })
})
