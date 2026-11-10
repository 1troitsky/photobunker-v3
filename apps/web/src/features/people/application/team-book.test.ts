import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { freshPackage, digest, hex } from '../../identity/infrastructure/crypto'
import { activeSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import { jsonApi } from '../../identity/infrastructure/api'
import { listLocalTeams, queueTeam, syncQueuedTeams, refreshTeams } from './team-book'

vi.mock('../../identity/infrastructure/api',()=>({jsonApi:vi.fn()}))
const api=vi.mocked(jsonApi)
let ownerId:string
async function account(id:string,online=false):Promise<Session>{
  const {pkg}=await freshPackage(id)
  const s={accountId:id,deviceId:crypto.randomUUID(),pkg,online} as unknown as Session
  activeSession.value=s
  return s
}
beforeEach(()=>{ownerId=crypto.randomUUID();vi.resetAllMocks()})
afterEach(()=>{activeSession.value=null})
async function rawRows():Promise<unknown[]>{
  const scope=hex(await digest(new TextEncoder().encode('pb3.team-scope.v1\n'+ownerId)))
  const raw=new Dexie('pb3-encrypted-teams-v1')
  raw.version(1).stores({teams:'&key,ownerScope'})
  const rows=await raw.table('teams').where('ownerScope').equals(scope).toArray()
  raw.close()
  return rows
}
describe('P1-27 signed E2EE Teams owner outbox',()=>{
  it('keeps names, description, account ID and signed contract encrypted on disk',async()=>{
    await account(ownerId)
    const team=await queueTeam('Private team','Sensitive description')
    expect(team.delivery).toBe('queued')
    expect(team.memberCount).toBe(1)
    expect(await listLocalTeams()).toMatchObject([team])
    const rows=JSON.stringify(await rawRows())
    for(const secret of ['Private team','Sensitive description',ownerId,
      'ownerAccountId','contract','signature'])expect(rows).not.toContain(secret)
  })
  it('survives offline reload, safely isolates accounts, and syncs exact original signed payload',async()=>{
    const alice=await account(ownerId)
    const team=await queueTeam('Offline Team','Draft')
    const stranger=await account(crypto.randomUUID())
    expect(await listLocalTeams()).toEqual([])
    activeSession.value=alice
    expect((await listLocalTeams())[0]?.name).toBe('Offline Team')
    // Online proof replaces the session wrapper while preserving the same crypto identity.
    const online={...alice,online:true} as Session
    activeSession.value=online
    let signedBody:{contract:string;signature:string}|null=null
    api.mockImplementation(async (_path,method,data)=>{
      if(method!=='POST')throw Error('unexpected')
      signedBody=data as typeof signedBody
      return {teamId:team.teamId,state:'active',unchanged:false} as never
    })
    await syncQueuedTeams()
    expect(signedBody).not.toBeNull()
    expect(JSON.stringify(signedBody)).not.toContain('Offline Team')
    expect((await listLocalTeams())[0]?.delivery).toBe('synced')
    activeSession.value=stranger
    expect(await listLocalTeams()).toEqual([])
  })
  it('replays the same signed operation after a committed-but-lost ACK',async()=>{
    const offline=await account(ownerId)
    const team=await queueTeam('ACK Retry','')
    activeSession.value={...offline,online:true}
    let count=0
    const bodies:string[]=[]
    api.mockImplementation(async (_path,method,data)=>{
      if(method!=='POST')throw Error('unexpected')
      bodies.push(JSON.stringify(data))
      count++
      if(count===1)throw Error('network.lost_ack')
      return {teamId:team.teamId,state:'active',unchanged:true} as never
    })
    await expect(syncQueuedTeams()).rejects.toThrow('network.lost_ack')
    expect((await listLocalTeams())[0]?.delivery).toBe('queued')
    await syncQueuedTeams()
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toEqual(bodies[1])
    expect((await listLocalTeams())[0]?.delivery).toBe('synced')
  })
  it('rejects wrong-signature directory responses without caching plaintext or trust',async()=>{
    const offline=await account(ownerId)
    const team=await queueTeam('Valid Team','')
    activeSession.value={...offline,online:true}
    api.mockImplementation(async (path,method)=>{
      if(method==='POST')return {teamId:team.teamId,state:'active',unchanged:false} as never
      return {items:[{teamId:team.teamId,ownerAccountId:ownerId,
        contract:'{}',signature:'invalid',state:'active',memberCount:1}],
        nextCursor:null} as never
    })
    await expect(refreshTeams()).rejects.toThrow()
    expect((await listLocalTeams())[0]?.name).toBe('Valid Team')
  })
})
