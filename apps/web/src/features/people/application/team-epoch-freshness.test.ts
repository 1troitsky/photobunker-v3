import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {beforeEach,afterEach,describe,it,expect} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage} from '../../identity/infrastructure/crypto'
import {
  cacheVerifiedJoinedTeam,assertVerifiedTeamEpochNotOlder,
  listCachedJoinedTeams,
} from './team-invitations'
import type {JoinedTeam} from './team-invitations'

let teamId:string,ownerId:string,accountId:string,session:Session
let view:JoinedTeam
beforeEach(async()=>{
  teamId=crypto.randomUUID();ownerId=crypto.randomUUID()
  accountId=crypto.randomUUID()
  const {pkg}=await freshPackage(accountId)
  session={
    accountId,deviceId:crypto.randomUUID(),pkg,online:true,
  } as Session
  activeSession.value=session
  view={
    teamId,ownerAccountId:ownerId,name:'PRIVATE EPOCH TWO',
    description:'do not roll back',role:'viewer',verifiedOnline:true,
  }
})
afterEach(()=>{activeSession.value=null})
const epoch2=()=>({
  keyEpoch:2,contractHash:'b'.repeat(64),membershipRevision:3,
})
async function rawLocal(){
  const db=new Dexie('pb3-encrypted-team-members-v1')
  db.version(1).stores({operations:'&key,ownerScope',joined:'&key,ownerScope'})
  db.version(2).stores({
    operations:'&key,ownerScope',joined:'&key,ownerScope',
    freshness:'&key,ownerScope',
  })
  const rows=await db.table('freshness').toArray()
  db.close()
  return rows
}
describe('T29B-02: AEAD-sealed Team verified epoch high water mark',()=>{
  it('rejects a genuine old epoch and retains the encrypted last verified snapshot',async()=>{
    await cacheVerifiedJoinedTeam(view,accountId,epoch2())
    await expect(assertVerifiedTeamEpochNotOlder(teamId,ownerId,{
      keyEpoch:1,contractHash:'a'.repeat(64),membershipRevision:1,
    })).rejects.toThrow('teams.verified_epoch_rollback')
    await expect(cacheVerifiedJoinedTeam(
      {...view,name:'OLD EPOCH ONE'},
      accountId,{keyEpoch:1,contractHash:'a'.repeat(64),membershipRevision:1},
    )).rejects.toThrow('teams.verified_epoch_rollback')
    const cached=await listCachedJoinedTeams()
    expect(cached).toHaveLength(1)
    expect(cached[0]?.name).toBe('PRIVATE EPOCH TWO')
    expect(cached[0]?.verifiedOnline).toBe(false)
    const local=JSON.stringify(await rawLocal())
    expect(local).not.toContain('PRIVATE EPOCH TWO')
    expect(local).not.toContain(accountId)
    expect(local).not.toContain(teamId)
    expect(local).not.toContain(ownerId)
    expect(local).not.toContain('"contractHash"')
  })
  it('rejects same-epoch contract hash forks and membership revision rollback',async()=>{
    await cacheVerifiedJoinedTeam(view,accountId,epoch2())
    await expect(cacheVerifiedJoinedTeam(view,accountId,{
      keyEpoch:2,contractHash:'c'.repeat(64),membershipRevision:3,
    })).rejects.toThrow('teams.verified_epoch_fork')
    await expect(assertVerifiedTeamEpochNotOlder(teamId,ownerId,{
      keyEpoch:2,contractHash:'b'.repeat(64),membershipRevision:2,
    })).rejects.toThrow('teams.verified_revision_rollback')
    await expect(cacheVerifiedJoinedTeam(view,accountId,{
      keyEpoch:3,contractHash:'c'.repeat(64),membershipRevision:2,
    })).rejects.toThrow('teams.verified_revision_rollback')
  })
  it('atomically advances to newer epochs and refuses a swapped team owner',async()=>{
    await cacheVerifiedJoinedTeam(view,accountId,epoch2())
    await cacheVerifiedJoinedTeam({...view,name:'EPOCH THREE'},accountId,{
      keyEpoch:3,contractHash:'c'.repeat(64),membershipRevision:4,
    })
    await expect(cacheVerifiedJoinedTeam({...view,ownerAccountId:crypto.randomUUID()},
      accountId,{keyEpoch:3,contractHash:'c'.repeat(64),membershipRevision:4},
    )).rejects.toThrow('teams.verified_epoch_owner_changed')
    await expect(assertVerifiedTeamEpochNotOlder(teamId,ownerId,epoch2()))
      .rejects.toThrow('teams.verified_epoch_rollback')
    const cached=await listCachedJoinedTeams()
    expect(cached[0]?.name).toBe('EPOCH THREE')
  })
  it('serializes concurrent epoch changes without overwriting the highest one',async()=>{
    const [older,newer]=await Promise.allSettled([
      cacheVerifiedJoinedTeam({...view,name:'TWO'},accountId,epoch2()),
      cacheVerifiedJoinedTeam({...view,name:'THREE'},accountId,{
        keyEpoch:3,contractHash:'c'.repeat(64),membershipRevision:4,
      }),
    ])
    expect(newer.status).toBe('fulfilled')
    expect(['fulfilled','rejected']).toContain(older.status)
    await expect(assertVerifiedTeamEpochNotOlder(teamId,ownerId,epoch2()))
      .rejects.toThrow('teams.verified_epoch_rollback')
    expect((await listCachedJoinedTeams())[0]?.name).toBe('THREE')
  })
  it('does not share another account’s local freshness state',async()=>{
    await cacheVerifiedJoinedTeam(view,accountId,epoch2())
    const other=crypto.randomUUID(),{pkg}=await freshPackage(other)
    activeSession.value={
      accountId:other,deviceId:crypto.randomUUID(),pkg,online:true,
    } as Session
    await expect(assertVerifiedTeamEpochNotOlder(teamId,ownerId,{
      keyEpoch:1,contractHash:'a'.repeat(64),membershipRevision:1,
    })).resolves.toBeUndefined()
    expect(await listCachedJoinedTeams()).toEqual([])
  })
})
