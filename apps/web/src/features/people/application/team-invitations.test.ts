import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { activeSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import { freshPackage, b64, hex, digest, random } from '../../identity/infrastructure/crypto'
import { jsonApi } from '../../identity/infrastructure/api'
import { queueTeamInvitation, syncTeamMemberOperations, listIncomingTeamInvites } from './team-invitations'

const recipientId='22222222-2222-4222-8222-222222222222'
let exchangeSpki=''
let accountId=''
vi.mock('../../identity/infrastructure/api',()=>({jsonApi:vi.fn()}))
vi.mock('../../sharing/key-directory',()=>({
  pinnedPeer:vi.fn(async()=>({
    exchangeSpki,descriptorHash:'a'.repeat(64),accountSpki:'unused',
  })),
  ensureOwnExchangeKey:vi.fn(),
}))
vi.mock('./contact-book',()=>({
  listConfirmedContacts:vi.fn(async()=>[
    {version:1,peerAccountId:recipientId,alias:'Trusted',safetyFingerprint:'f'.repeat(64),
      createdAt:1,updatedAt:1},
  ]),
}))
vi.mock('./team-book',()=>({
  withOwnerTeamDEK:vi.fn(async(
    _teamId:string,
    callback:(raw:Uint8Array<ArrayBuffer>,root:{contract:string;signature:string})=>Promise<unknown>,
  )=>{
    const key=random(32)
    try{return await callback(key,{contract:'{"version":1}',signature:'not-relevant'})}
    finally{key.fill(0)}
  }),
}))
const api=vi.mocked(jsonApi)
async function login(online:boolean):Promise<Session>{
  const {pkg}=await freshPackage(accountId)
  const s={accountId,deviceId:crypto.randomUUID(),pkg,online} as unknown as Session
  activeSession.value=s
  return s
}
async function storedRows(){
  const scope=hex(await digest(new TextEncoder().encode(
    'pb3.team-members-scope.v1\n'+accountId)))
  const raw=new Dexie('pb3-encrypted-team-members-v1')
  raw.version(1).stores({operations:'&key,ownerScope',joined:'&key,ownerScope'})
  const rows=await raw.table('operations').where('ownerScope').equals(scope).toArray()
  raw.close()
  return rows
}
beforeEach(async()=>{
  accountId=crypto.randomUUID()
  const exchange=await crypto.subtle.generateKey(
    {name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
  exchangeSpki=b64(await crypto.subtle.exportKey('spki',exchange.publicKey))
  Object.defineProperty(navigator,'onLine',{configurable:true,value:true})
  api.mockReset()
})
afterEach(()=>{activeSession.value=null})
describe('P1-28 signed team member outbox and confidentiality',()=>{
  it('seals offline signed invitation, not plaintext identities/role/DEK',async()=>{
    await login(false)
    const teamId=crypto.randomUUID()
    const inviteId=await queueTeamInvitation(teamId,recipientId,'viewer')
    expect(inviteId).toMatch(/^[a-f0-9-]{36}$/)
    const rows=await storedRows()
    expect(rows).toHaveLength(1)
    const serialized=JSON.stringify(rows)
    for(const forbidden of [
      accountId,teamId,recipientId,'viewer','teamContractHash',
      'recipientAccountId','ownerAccountId','signature',
    ])expect(serialized).not.toContain(forbidden)
    await syncTeamMemberOperations()
    expect(api).not.toHaveBeenCalled()
  })
  it('replays the identical signed ciphertext after a lost ACK',async()=>{
    const previous=await login(false)
    const teamId=crypto.randomUUID()
    const inviteId=await queueTeamInvitation(teamId,recipientId,'contributor')
    activeSession.value={...previous,online:true}
    const requests:string[]=[]
    api.mockImplementation(async(_url,method,payload)=>{
      expect(method).toBe('POST')
      requests.push(JSON.stringify(payload))
      if(requests.length===1)throw Error('network.lost_ack')
      return {inviteId,state:'pending',unchanged:true} as never
    })
    await expect(syncTeamMemberOperations()).rejects.toThrow('network.lost_ack')
    await syncTeamMemberOperations()
    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual(requests[1])
    const object=JSON.parse(requests[0]!) as {contract:string;signature:string}
    const c=JSON.parse(object.contract) as {fileAccess:string;role:string}
    expect(c.fileAccess).toBe('none')
    expect(c.role).toBe('contributor')
    expect(JSON.stringify(await storedRows())).not.toContain(object.contract)
  })
  it('refuses unsigned/forged inbox data before owner confirmation',async()=>{
    await login(true)
    api.mockResolvedValueOnce({items:[{
      inviteId:crypto.randomUUID(),teamId:crypto.randomUUID(),
      ownerAccountId:recipientId,ownerAccountSpki:'forged',
      recipientAccountId:accountId,role:'viewer',state:'pending',
      expiresAt:Date.now()+100000,expired:false,contract:'{}',
      signature:'forged',contractHash:'a'.repeat(64),
    }],nextCursor:null} as never)
    await expect(listIncomingTeamInvites()).rejects.toThrow()
  })
})
