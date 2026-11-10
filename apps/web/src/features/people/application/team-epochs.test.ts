import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import {
  freshPackage, b64, random, hex, digest, importSigner, sign,
} from '../../identity/infrastructure/crypto'
import { jsonApi } from '../../identity/infrastructure/api'
import { pinnedPeer } from '../../sharing/key-directory'
import { listLocalTeams } from './team-book'
import {
  listOwnerTeamRoster, verifiedTeamMembershipHistory,
} from './team-invitations'
import { queueTeamKeyRotation, syncTeamKeyRotations } from './team-epochs'

vi.mock('../../identity/infrastructure/api',()=>({jsonApi:vi.fn()}))
vi.mock('../../sharing/key-directory',()=>({
  pinnedPeer:vi.fn(),ensureOwnExchangeKey:vi.fn(),
}))
vi.mock('./team-book',()=>({listLocalTeams:vi.fn()}))
vi.mock('./team-invitations',()=>({
  listOwnerTeamRoster:vi.fn(),
  verifiedTeamMembershipHistory:vi.fn(),
  openJoinedTeam:vi.fn(),
  cacheVerifiedJoinedTeam:vi.fn(),
}))
const api=vi.mocked(jsonApi)
const pinned=vi.mocked(pinnedPeer)
const roster=vi.mocked(listOwnerTeamRoster)
const history=vi.mocked(verifiedTeamMembershipHistory)
const teams=vi.mocked(listLocalTeams)
let ownerId:string
let teamId:string
let recipientId:string
let session:Session
let root:{contract:string;signature:string;contractHash:string}
let sent:string[]
async function hash(s:string):Promise<string>{
  return hex(await digest(new TextEncoder().encode(s)))
}
beforeEach(async()=>{
  ownerId=crypto.randomUUID()
  recipientId=crypto.randomUUID()
  teamId=crypto.randomUUID()
  const {pkg}=await freshPackage(ownerId)
  session={
    accountId:ownerId,deviceId:crypto.randomUUID(),pkg,online:false,
  } as Session
  activeSession.value=session
  Object.defineProperty(navigator,'onLine',{configurable:true,value:true})
  const rootContract=JSON.stringify({
    version:1,teamId,operationId:crypto.randomUUID(),ownerAccountId:ownerId,
    privateEnvelope:{version:1,iv:b64(random(12)),
      ciphertext:b64(random(130)),wrappedKey:{
        iv:b64(random(12)),ciphertext:b64(random(48)),
      }},
  })
  root={
    contract:rootContract,
    signature:await sign(await importSigner(pkg.accountPkcs8),
      'pb3.team-create.v1\n'+rootContract),
    contractHash:await hash(rootContract),
  }
  const exchange=await crypto.subtle.generateKey(
    {name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
  pinned.mockReset()
  pinned.mockResolvedValue({
    accountId:recipientId,accountSpki:'pin',
    descriptorHash:'a'.repeat(64),
    exchangeSpki:b64(await crypto.subtle.exportKey('spki',exchange.publicKey)),
  } as Awaited<ReturnType<typeof pinnedPeer>>)
  teams.mockReset()
  teams.mockResolvedValue([{
    teamId,name:'E2EE TEAM SECRET',description:'PRIVATE NOTES',
    memberCount:2,delivery:'synced',
  }])
  roster.mockReset()
  roster.mockResolvedValue([{
    inviteId:crypto.randomUUID(),recipientAccountId:recipientId,
    role:'viewer',state:'accepted',expiresAt:Date.now()+100000,
  }])
  history.mockReset()
  history.mockResolvedValue({
    events:[],revision:2,rotationRequired:true,
  })
  api.mockReset()
  sent=[]
  api.mockImplementation(async(path,method,payload)=>{
    if(method==='POST'){
      sent.push(JSON.stringify(payload))
      if(sent.length===1)throw Error('network.lost_ack')
      return {teamId,keyEpoch:2,unchanged:true} as never
    }
    if(path.endsWith('/epoch/owner'))return {
      teamId,ownerAccountId:ownerId,membershipRevision:2,
      keyEpoch:1,rotationRequired:true,
      ...root,domain:'pb3.team-create.v1',
    } as never
    if(path.endsWith('/epoch/history'))return {
      teamId,ownerAccountId:ownerId,membershipRevision:2,
      keyEpoch:1,rotationRequired:true,
      root,items:[],nextCursor:null,
    } as never
    throw Error('unexpected request '+path)
  })
})
afterEach(()=>{activeSession.value=null})
async function rawStored(){
  const ownerScope=await hash('pb3.team-epoch-scope.v1\n'+ownerId)
  const db=new Dexie('pb3-encrypted-team-epochs-v1')
  db.version(1).stores({operations:'&key,ownerScope'})
  const rows=await db.table('operations').where('ownerScope').equals(ownerScope).toArray()
  db.close()
  return rows
}
describe('P1-29B encrypted owner Team key epoch outbox',()=>{
  it('requires a live roster and never queues an unconfirmed epoch offline',async()=>{
    await expect(queueTeamKeyRotation(teamId))
      .rejects.toThrow('teams.rotation_requires_online_roster')
    expect(await rawStored()).toHaveLength(0)
  })
  it('seals random Team DEK, profile and recipient envelope before any HTTP POST',async()=>{
    activeSession.value={...session,online:true}
    await queueTeamKeyRotation(teamId)
    const local=JSON.stringify(await rawStored())
    expect(local).not.toBe('[]')
    for(const secret of [
      ownerId,recipientId,teamId,'E2EE TEAM SECRET','PRIVATE NOTES',
      'recipientKeyDigest','contract','wrappedKey',
    ])expect(local).not.toContain(secret)
    expect(sent).toHaveLength(0)
  })
  it('replays EXACT signed bytes after Lost ACK and preserves epoch AAD',async()=>{
    activeSession.value={...session,online:true}
    await queueTeamKeyRotation(teamId)
    await expect(syncTeamKeyRotations()).rejects.toThrow('network.lost_ack')
    await syncTeamKeyRotations()
    expect(sent).toHaveLength(2)
    expect(sent[0]).toEqual(sent[1])
    const command=JSON.parse(sent[0]!) as {contract:string;signature:string}
    const c=JSON.parse(command.contract) as {
      fromEpoch:number;toEpoch:number;membershipRevision:number
      previousEpochHash:string;retiredPendingInviteIds:string[]
      recipients:Array<{accountId:string;role:string;recipientKeyDigest:string
        envelope:{ephemeralSpki:string;salt:string;iv:string;ciphertext:string}}>
      privateEnvelope:{ciphertext:string}
    }
    expect(c.fromEpoch).toBe(1)
    expect(c.toEpoch).toBe(2)
    expect(c.membershipRevision).toBe(2)
    expect(c.previousEpochHash).toBe(root.contractHash)
    expect(c.retiredPendingInviteIds).toEqual([])
    expect(c.recipients).toHaveLength(1)
    expect(c.recipients[0]?.accountId).toBe(recipientId)
    expect(c.recipients[0]?.role).toBe('viewer')
    expect(c.recipients[0]?.recipientKeyDigest).toBe('a'.repeat(64))
    expect(c.privateEnvelope.ciphertext).not.toContain('E2EE TEAM SECRET')
    expect(JSON.stringify(await rawStored())).not.toContain(command.contract)
  })
})
