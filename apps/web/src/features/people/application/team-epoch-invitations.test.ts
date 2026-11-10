import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage,b64,random,hex,digest} from '../../identity/infrastructure/crypto'
import {jsonApi} from '../../identity/infrastructure/api'
import {pinnedPeer} from '../../sharing/key-directory'
import {withCurrentOwnerTeamDEK} from './team-epochs'
import {
  queueEpochInvitation,syncEpochInvitationOperations,listEpochInvites,
} from './team-epoch-invitations'

vi.mock('../../identity/infrastructure/api',()=>({jsonApi:vi.fn()}))
vi.mock('../../sharing/key-directory',()=>({
  pinnedPeer:vi.fn(),ensureOwnExchangeKey:vi.fn(),
}))
vi.mock('./contact-book',()=>({
  listConfirmedContacts:vi.fn(async()=>[
    {peerAccountId:'22222222-2222-4222-8222-222222222222',alias:'Verified peer'},
  ]),
}))
vi.mock('./team-epochs',()=>({
  withCurrentOwnerTeamDEK:vi.fn(),
  verifyEpochHistory:vi.fn(),
  profileAad:vi.fn(),
  openVerifiedCurrentEpochMember:vi.fn(),
  ownerEpochStatus:vi.fn(),
}))
vi.mock('./team-invitations',()=>({
  verifiedTeamMembershipHistory:vi.fn(),cacheVerifiedJoinedTeam:vi.fn(),
}))

const api=vi.mocked(jsonApi)
const pinned=vi.mocked(pinnedPeer)
const unwrap=vi.mocked(withCurrentOwnerTeamDEK)
const recipientId='22222222-2222-4222-8222-222222222222'
let ownerId:string
let teamId:string
let session:Session
let posted:string[]
async function hash(s:string):Promise<string>{
  return hex(await digest(new TextEncoder().encode(s)))
}
beforeEach(async()=>{
  ownerId=crypto.randomUUID()
  teamId=crypto.randomUUID()
  const {pkg}=await freshPackage(ownerId)
  session={
    accountId:ownerId,deviceId:crypto.randomUUID(),pkg,online:true,
  } as Session
  activeSession.value=session
  Object.defineProperty(navigator,'onLine',{value:true,configurable:true})
  const eph=await crypto.subtle.generateKey(
    {name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
  pinned.mockReset()
  pinned.mockResolvedValue({
    accountId:recipientId,
    exchangeSpki:b64(await crypto.subtle.exportKey('spki',eph.publicKey)),
    descriptorHash:'a'.repeat(64),
  } as Awaited<ReturnType<typeof pinnedPeer>>)
  unwrap.mockReset()
  unwrap.mockImplementation(async(_team,callback)=>{
    const raw=random(32)
    try{return await callback(raw,{
      rootContractHash:'b'.repeat(64),keyEpoch:2,
      keyEpochHash:'c'.repeat(64),membershipRevision:3,
    })}
    finally{raw.fill(0)}
  })
  api.mockReset()
  posted=[]
})
afterEach(()=>{activeSession.value=null})

async function sealedRows(){
  const scope=await hash('pb3.team-v2-scope.v1\n'+ownerId)
  const db=new Dexie('pb3-encrypted-team-invites-v2')
  db.version(1).stores({operations:'&key,scope'})
  const rows=await db.table('operations').where('scope').equals(scope).toArray()
  db.close()
  return rows
}
describe('P1-29C signed epoch-bound Teams invitation outbox',()=>{
  it('persists per-recipient epoch 2 ECDH scope with NO plaintext identifiers in IndexedDB',async()=>{
    const id=await queueEpochInvitation(teamId,recipientId,'viewer')
    expect(id).toMatch(/^[a-f0-9-]{36}$/)
    const records=JSON.stringify(await sealedRows())
    expect(records).not.toBe('[]')
    for(const secret of [
      ownerId,recipientId,teamId,'viewer',
      'recipientKeyDigest','rootContractHash',
      'keyEpochHash','privateEnvelope',
    ])expect(records).not.toContain(secret)
    expect(api).not.toHaveBeenCalled()
  })
  it('replays byte-identical owner-signed v2 invitation on Lost ACK',async()=>{
    const id=await queueEpochInvitation(teamId,recipientId,'contributor')
    api.mockImplementation(async(_url,method,body)=>{
      expect(method).toBe('POST')
      posted.push(JSON.stringify(body))
      if(posted.length===1)throw Error('network.lost_ack')
      return {inviteId:id,state:'pending',keyEpoch:2,unchanged:true} as never
    })
    await expect(syncEpochInvitationOperations()).rejects.toThrow('network.lost_ack')
    await syncEpochInvitationOperations()
    expect(posted).toHaveLength(2)
    expect(posted[0]).toBe(posted[1])
    const cmd=JSON.parse(posted[0]!) as {contract:string;signature:string}
    const c=JSON.parse(cmd.contract) as {
      version:number;rootContractHash:string;keyEpoch:number;keyEpochHash:string
      membershipRevision:number;recipientAccountId:string
      fileAccess:string;role:string;envelope:{ciphertext:string}
    }
    expect(c.version).toBe(2)
    expect(c.keyEpoch).toBe(2)
    expect(c.keyEpochHash).toBe('c'.repeat(64))
    expect(c.rootContractHash).toBe('b'.repeat(64))
    expect(c.membershipRevision).toBe(3)
    expect(c.fileAccess).toBe('none')
    expect(c.role).toBe('contributor')
    expect(c.recipientAccountId).toBe(recipientId)
    expect(c.envelope.ciphertext.length).toBeGreaterThan(25)
    expect(JSON.stringify(await sealedRows())).not.toContain(cmd.contract)
  })
  it('does not create a new invitation from an offline stale epoch',async()=>{
    activeSession.value={...session,online:false}
    await expect(queueEpochInvitation(teamId,recipientId,'viewer'))
      .rejects.toThrow('teams.epoch_invite_requires_online')
    expect(await sealedRows()).toHaveLength(0)
  })
  it('rejects unsigned/inflated epoch inbox payload',async()=>{
    api.mockResolvedValueOnce({items:[{
      inviteId:crypto.randomUUID(),teamId,ownerAccountId:ownerId,
      ownerAccountSpki:session.pkg.accountSpki,recipientAccountId:ownerId,
      role:'viewer',keyEpoch:2,membershipRevision:3,
      state:'pending',expiresAt:Date.now()+100000,expired:false,
      contract:'{}',signature:'forged',contractHash:'f'.repeat(64),
    }],nextCursor:null} as never)
    await expect(listEpochInvites()).rejects.toThrow()
  })
})
