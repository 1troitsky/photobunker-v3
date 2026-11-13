import { jsonApi } from '../../identity/infrastructure/api'
import { activeSession, type Session } from '../../identity/application/session'

/**
 * Server-authoritative, read-only P3 #226 lifecycle. No local entitlement,
 * paid flag or expiry may be synthesized from the device clock or persisted.
 */
const plans=['free','go','pro','unlimited','unlimited_plus'] as const
type PlanId=typeof plans[number]
type Status='pending'|'active'|'grace'|'expired'

export interface GraceStatus {
  readonly revision:number
  readonly snapshotSha256:string
  readonly planId:PlanId
  readonly effectivePlanId:PlanId
  readonly status:Status
  readonly paidPrivilegesActive:boolean
  readonly graceDays:number|null
  readonly asOfAt:string
  readonly planEndsAt:string|null
  readonly graceEndsAt:string|null
  readonly nextDeadlineAt:string|null
  readonly graceActive:boolean
  readonly paidRightsDowngraded:boolean
}

type Row=Record<string,unknown>
const sha256=/^[a-f0-9]{64}$/
const utc=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
function fail():never{throw new Error('billing.unverified_lifecycle')}
function record(value:unknown):Row{
  if(!value||typeof value!=='object'||Array.isArray(value))fail()
  return value as Row
}
function date(value:unknown):string|null{
  if(value===null)return null
  if(typeof value!=='string'||!utc.test(value)||!Number.isFinite(Date.parse(value))
    ||new Date(value).toISOString().replace('.000Z','Z')!==value)fail()
  return value
}
function plan(value:unknown):value is PlanId{
  return typeof value==='string'&&plans.includes(value as PlanId)
}
function int(value:unknown):value is number{
  return typeof value==='number'&&Number.isSafeInteger(value)
}

/**
 * Strictly cross-check lifecycle and entitlement from the SAME HTTP answer.
 * This is defensive consistency checking, not an independent digital
 * signature. The server's authenticated session remains the authority.
 */
export function parseGraceStatus(response:unknown):GraceStatus{
  const outer=record(response), e=record(outer.entitlement), l=record(outer.lifecycle)
  if(outer.schemaVersion!==1||e.schemaVersion!==1||l.schemaVersion!==1)fail()
  if(!int(e.revision)||e.revision<1||e.revision!==l.revision
    ||typeof e.snapshotSha256!=='string'||!sha256.test(e.snapshotSha256)
    ||!plan(e.planId)||e.planId!==l.planId
    ||!plan(e.effectivePlanId)||e.effectivePlanId!==l.effectivePlanId
    ||!['active','grace','expired','pending'].includes(String(e.status))
    ||e.status!==l.status||typeof e.paidPrivilegesActive!=='boolean'
    ||e.paidPrivilegesActive!==l.paidPrivilegesActive
    ||l.planId==='free'&&l.graceDays!==null
    ||!int(l.revision)||l.revision<1)fail()
  const now=date(l.asOfAt), starts=date(e.startsAt), end=date(l.planEndsAt)
  const graceEnd=date(l.graceEndsAt), next=date(l.nextDeadlineAt)
  if(now===null||starts===null
    ||date(e.endsAt)!==end||date(e.graceEndsAt)!==graceEnd
    ||!int(l.secondsUntilNextDeadline) && l.secondsUntilNextDeadline!==null
    ||typeof l.graceActive!=='boolean'
    ||typeof l.paidRightsDowngraded!=='boolean')fail()

  const current=l.status as Status, paid=l.planId!=='free'
  const expectedStatus=Date.parse(now)<Date.parse(starts)?'pending'
    :end===null||Date.parse(now)<Date.parse(end)?'active'
      :graceEnd!==null&&Date.parse(now)<Date.parse(graceEnd)?'grace':'expired'
  if(current!==expectedStatus
    ||l.graceActive!==(current==='grace')
    ||l.paidRightsDowngraded!==(paid&&current!=='active')
    ||l.effectivePlanId!==(current==='active'?l.planId:'free')
    ||l.paidPrivilegesActive!==(paid&&current==='active'))fail()
  if(paid){
    if(!int(l.graceDays)||l.graceDays<1||l.graceDays>365||end===null
      ||graceEnd===null||Date.parse(end)<=Date.parse(starts)
      ||Date.parse(graceEnd)!==Date.parse(end)+l.graceDays*86400000)fail()
  }else if(l.graceDays!==null||end!==null||graceEnd!==null)fail()

  const expectedNext=current==='active'?end:current==='grace'?graceEnd:null
  if(next!==expectedNext||l.secondsUntilNextDeadline!==(
    expectedNext===null?null:Math.max(0,(Date.parse(expectedNext)-Date.parse(now))/1000)
  ))fail()
  if(l.newWritesPolicy!=='effective_entitlement_and_server_quotas'
    ||l.existingMediaPolicy!=='immutable_signed_ttl_and_current_acl')fail()

  return {
    revision:e.revision as number,
    snapshotSha256:e.snapshotSha256 as string,
    planId:l.planId as PlanId,
    effectivePlanId:l.effectivePlanId as PlanId,
    status:current,
    paidPrivilegesActive:l.paidPrivilegesActive as boolean,
    graceDays:l.graceDays as number|null,
    asOfAt:now,planEndsAt:end,graceEndsAt:graceEnd,nextDeadlineAt:next,
    graceActive:l.graceActive as boolean,
    paidRightsDowngraded:l.paidRightsDowngraded as boolean,
  }
}

export async function readVerifiedGraceStatus(session:Session):Promise<GraceStatus>{
  if(!session.online||activeSession.value!==session)throw Error('billing.session_unverified')
  // GET never submits a user-selected planId, expiry, revision or accountId.
  const raw=await jsonApi<unknown>('/billing/v1/me')
  if(activeSession.value!==session||!session.online)throw Error('billing.session_changed')
  return parseGraceStatus(raw)
}
