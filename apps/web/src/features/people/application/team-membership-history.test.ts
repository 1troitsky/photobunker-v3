import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeSession } from '../../identity/application/session'
import { freshPackage, importSigner, sign } from '../../identity/infrastructure/crypto'
import { jsonApi } from '../../identity/infrastructure/api'
import { verifiedTeamMembershipHistory } from './team-invitations'

vi.mock('../../identity/infrastructure/api',()=>({jsonApi:vi.fn()}))
const api=vi.mocked(jsonApi)
let teamId:string
let ownerId:string
let peerId:string
let inviteId:string
let pkg:Awaited<ReturnType<typeof freshPackage>>['pkg']
beforeEach(async()=>{
  teamId=crypto.randomUUID()
  ownerId=crypto.randomUUID()
  peerId=crypto.randomUUID()
  inviteId=crypto.randomUUID()
  const account=await freshPackage(ownerId)
  pkg=account.pkg
  activeSession.value={
    accountId:ownerId,deviceId:crypto.randomUUID(),pkg,online:true,
  } as typeof activeSession.value & object
  Object.defineProperty(navigator,'onLine',{value:true,configurable:true})
  api.mockReset()
})
afterEach(()=>{activeSession.value=null})
async function event(role:'viewer'|'contributor'='contributor'){
  const c={
    version:1,operationId:crypto.randomUUID(),teamId,ownerAccountId:ownerId,
    inviteId,targetAccountId:peerId,action:'change_role',
    previousRole:'viewer',nextRole:role,
    fromRevision:1,toRevision:2,
  }
  const contract=JSON.stringify(c)
  const signature=await sign(await importSigner(pkg.accountPkcs8),
    'pb3.team-membership.v1\n'+contract)
  return {...c,contract,signature}
}
describe('P1-29A owner-verifiable membership audit',()=>{
  it('accepts empty signed history only at base revision one',async()=>{
    api.mockResolvedValueOnce({items:[],membershipRevision:1,
      rotationRequired:false,nextCursor:null} as never)
    await expect(verifiedTeamMembershipHistory(teamId))
      .resolves.toMatchObject({revision:1,rotationRequired:false,events:[]})
  })
  it('verifies actual signed role change and monotonically increasing revision',async()=>{
    const row=await event()
    api.mockResolvedValueOnce({items:[row],membershipRevision:2,
      rotationRequired:false,nextCursor:null} as never)
    const result=await verifiedTeamMembershipHistory(teamId)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.nextRole).toBe('contributor')
  })
  it('refuses a missing server event despite a claimed revision bump',async()=>{
    api.mockResolvedValueOnce({items:[],membershipRevision:2,
      rotationRequired:false,nextCursor:null} as never)
    await expect(verifiedTeamMembershipHistory(teamId))
      .rejects.toThrow('teams.incomplete_membership_history')
  })
  it('refuses edited role even when the envelope claims the old signature',async()=>{
    const row=await event()
    api.mockResolvedValueOnce({items:[{...row,nextRole:'curator'}],
      membershipRevision:2,rotationRequired:false,nextCursor:null} as never)
    await expect(verifiedTeamMembershipHistory(teamId))
      .rejects.toThrow('teams.untrusted_membership_history')
  })
  it('refuses a mismatched team or replayed revision',async()=>{
    const row=await event()
    api.mockResolvedValueOnce({items:[{...row,teamId:crypto.randomUUID()}],
      membershipRevision:2,rotationRequired:false,nextCursor:null} as never)
    await expect(verifiedTeamMembershipHistory(teamId))
      .rejects.toThrow('teams.untrusted_membership_history')
  })
})
