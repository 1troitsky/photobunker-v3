import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeSession, type Session } from '../../identity/application/session'
import { jsonApi } from '../../identity/infrastructure/api'
import { parseGraceStatus, readVerifiedGraceStatus } from './grace-client'

vi.mock('../../identity/infrastructure/api', () => ({jsonApi:vi.fn()}))
function session(accountId='account-a',deviceId='device-a',online=true):Session{
  return {accountId,deviceId,online,pkg:{} as Session['pkg'],device:{} as Session['device']}
}
function fixture(){
  return {
    schemaVersion:1,
    entitlement:{
      schemaVersion:1,revision:2,snapshotSha256:'a'.repeat(64),
      planId:'go',effectivePlanId:'free',status:'grace',
      paidPrivilegesActive:false,
      startsAt:'2026-10-10T12:00:00Z',
      endsAt:'2026-11-13T12:00:00Z',
      graceEndsAt:'2026-11-28T12:00:00Z',
    },
    lifecycle:{
      schemaVersion:1,revision:2,planId:'go',
      status:'grace',effectivePlanId:'free',paidPrivilegesActive:false,
      graceDays:15,asOfAt:'2026-11-14T12:00:00Z',
      planEndsAt:'2026-11-13T12:00:00Z',
      graceEndsAt:'2026-11-28T12:00:00Z',
      nextDeadlineAt:'2026-11-28T12:00:00Z',
      secondsUntilNextDeadline:14*86400,
      graceActive:true,paidRightsDowngraded:true,
      newWritesPolicy:'effective_entitlement_and_server_quotas',
      existingMediaPolicy:'immutable_signed_ttl_and_current_acl',
    },
  }
}
function clone(){return structuredClone(fixture())}
const http=vi.mocked(jsonApi)
beforeEach(()=>{activeSession.value=null;vi.resetAllMocks()})
afterEach(()=>{activeSession.value=null})

describe('#226 verified read-only subscription status',()=>{
  it('accepts server-authenticated grace without promoting paid privileges',()=>{
    const x=parseGraceStatus(fixture())
    expect(x).toMatchObject({planId:'go',effectivePlanId:'free',
      graceDays:15,graceActive:true,paidPrivilegesActive:false})
    expect(x.graceEndsAt).toBe('2026-11-28T12:00:00Z')
  })
  it('accepts authenticated Free with no invented payment deadline',()=>{
    const x=clone()
    Object.assign(x.entitlement,{
      revision:1,planId:'free',effectivePlanId:'free',status:'active',
      paidPrivilegesActive:false,startsAt:'2026-11-14T10:00:00Z',
      endsAt:null,graceEndsAt:null,
    })
    Object.assign(x.lifecycle,{
      revision:1,planId:'free',effectivePlanId:'free',status:'active',
      paidPrivilegesActive:false,graceDays:null,planEndsAt:null,graceEndsAt:null,
      nextDeadlineAt:null,secondsUntilNextDeadline:null,graceActive:false,
      paidRightsDowngraded:false,
    })
    expect(parseGraceStatus(x)).toMatchObject({planId:'free',graceDays:null,
      nextDeadlineAt:null,paidPrivilegesActive:false})
  })
  it('accepts paid active only before the exact plan expiry',()=>{
    const x=clone()
    Object.assign(x.entitlement,{
      effectivePlanId:'go',status:'active',paidPrivilegesActive:true,
      endsAt:'2026-11-16T12:00:00Z',
      graceEndsAt:'2026-12-01T12:00:00Z',
    })
    Object.assign(x.lifecycle,{
      effectivePlanId:'go',status:'active',paidPrivilegesActive:true,
      planEndsAt:'2026-11-16T12:00:00Z',
      graceEndsAt:'2026-12-01T12:00:00Z',
      nextDeadlineAt:'2026-11-16T12:00:00Z',
      secondsUntilNextDeadline:2*86400,
      graceActive:false,paidRightsDowngraded:false,
    })
    expect(parseGraceStatus(x).paidPrivilegesActive).toBe(true)
    x.lifecycle.asOfAt='2026-11-16T12:00:00Z'
    expect(()=>parseGraceStatus(x)).toThrow('billing.unverified_lifecycle')
  })
  it('accepts expiry with no future payment deadline or paid writes',()=>{
    const x=clone()
    x.lifecycle.asOfAt='2026-11-28T12:00:00Z'
    Object.assign(x.entitlement,{status:'expired'})
    Object.assign(x.lifecycle,{status:'expired',graceActive:false,
      nextDeadlineAt:null,secondsUntilNextDeadline:null})
    expect(parseGraceStatus(x)).toMatchObject({
      status:'expired',nextDeadlineAt:null,paidRightsDowngraded:true,
    })
  })
  it.each([
    [{lifecycle:{planId:'pro'}},'mismatched plans'],
    [{lifecycle:{revision:1}},'stale revision'],
    [{entitlement:{status:'active'}},'inconsistent effective status'],
    [{lifecycle:{paidPrivilegesActive:true}},'faked paid privileges'],
    [{lifecycle:{effectivePlanId:'go'}},'faked paid effective plan'],
    [{lifecycle:{graceActive:false}},'faked grace active flag'],
    [{lifecycle:{graceEndsAt:'2099-01-01T00:00:00Z'}},'tampered grace deadline'],
    [{lifecycle:{graceEndsAt:'2026-02-30T00:00:00Z'}},'impossible UTC date'],
    [{lifecycle:{nextDeadlineAt:null}},'missing next deadline'],
    [{lifecycle:{secondsUntilNextDeadline:-1}},'negative deadline'],
    [{lifecycle:{secondsUntilNextDeadline:15*86400}},'forged remaining seconds'],
    [{lifecycle:{graceDays:90}},'inflated grace days'],
    [{lifecycle:{asOfAt:'2026-11-28T12:00:00Z'}},'expired not yet reported'],
    [{entitlement:{snapshotSha256:'bad'}},'bad snapshot marker'],
    [{lifecycle:{existingMediaPolicy:'retroactive_free_ttl'}},'implicit expiry rewrite'],
    [{lifecycle:{newWritesPolicy:'paid_unlimited'}},'faked paid writes'],
  ])('rejects %s (%s)',(patch)=>{
    const x=clone() as unknown as Record<string,Record<string,unknown>>
    for(const [group,fields] of Object.entries(patch))
      Object.assign(x[group]!,fields)
    expect(()=>parseGraceStatus(x)).toThrow('billing.unverified_lifecycle')
  })
  it('rejects offline sessions without network request or cached Free guess',async()=>{
    const offline=session('account-a','device-a',false)
    activeSession.value=offline
    await expect(readVerifiedGraceStatus(offline)).rejects.toThrow('billing.session_unverified')
    expect(http).not.toHaveBeenCalled()
  })
  it('requests only own read-only billing endpoint and returns valid response',async()=>{
    const current=session();activeSession.value=current
    http.mockResolvedValue(fixture())
    const result=await readVerifiedGraceStatus(current)
    expect(http).toHaveBeenCalledWith('/billing/v1/me')
    expect(result.status).toBe('grace')
  })
  it('discards HTTP response when device/account changes in flight',async()=>{
    let resolve!:(value:unknown)=>void
    const request=new Promise<unknown>(yes=>{resolve=yes})
    http.mockReturnValue(request)
    const first=session(),other=session('account-b','device-b')
    activeSession.value=first
    const pending=readVerifiedGraceStatus(first)
    activeSession.value=other
    resolve(fixture())
    await expect(pending).rejects.toThrow('billing.session_changed')
  })
  it('discards response after logout rather than publishing prior account plan',async()=>{
    let resolve!:(value:unknown)=>void
    http.mockReturnValue(new Promise(yes=>{resolve=yes}))
    const first=session();activeSession.value=first
    const pending=readVerifiedGraceStatus(first)
    activeSession.value=null;resolve(fixture())
    await expect(pending).rejects.toThrow('billing.session_changed')
  })
  it('treats HTTP network failure as unknown not Free or active paid',async()=>{
    const current=session();activeSession.value=current
    http.mockRejectedValue(new Error('api.http_401'))
    await expect(readVerifiedGraceStatus(current)).rejects.toThrow('api.http_401')
  })
})
