import { activeSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import { jsonApi } from '../../identity/infrastructure/api'

/**
 * #283 PWA policy hint ONLY, not a billing entitlement or reservation grant.
 *
 * We never block Camera/Browser or postpone encrypted local persistence while
 * fetching an entitlement. The backend always rechecks the signed expiry
 * against its own verified immutable ledger inside the reservation lock.
 */
const DAY_MS=86400000
const FRESH_MS=60000
const EXPIRING_PAID_MS=5*60000
const DEFAULT_DAYS=13

type VerifiedHint={
  session:Session
  receivedAt:number
  expiresAt:number
  days:29|89
}
let verified:VerifiedHint|null=null
let pending:{session:Session;task:Promise<void>}|null=null

function record(value:unknown):value is Record<string,unknown>{
  return typeof value==='object'&&value!==null&&!Array.isArray(value)
}

/**
 * Only a newly received response to the authenticated OWN-account endpoint
 * can establish a short-lived paid *hint*. We do not cache this on disk.
 * Any unknown/mismatched shape, revision or deadline is a Free fallback.
 */
function validatedPaidHint(payload:unknown,now:number):{
  days:29|89;expiresAt:number
}|null{
  if(!record(payload)||payload.schemaVersion!==1
    ||!record(payload.entitlement))return null
  const e=payload.entitlement
  if(e.status!=='active'||e.paidPrivilegesActive!==true
    ||!Number.isSafeInteger(e.revision)||Number(e.revision)<2
    ||typeof e.snapshotSha256!=='string'
    ||!/^[a-f0-9]{64}$/.test(e.snapshotSha256))return null
  const plan=e.effectivePlanId
  if((plan!=='go'&&plan!=='pro')||e.planId!==plan
    ||!record(e.effectiveLimits)||!record(e.effectiveLimits.retention))
    return null
  const days=plan==='go'?29:89
  if(e.effectiveLimits.retention.days!==days+1
    ||Object.prototype.hasOwnProperty.call(e.effectiveLimits.retention,'mode'))
    return null

  // No permissive Date.parse() of local/ambiguous time strings. Billing
  // serializes explicit UTC timestamps; an almost-expired paid entitlement
  // cannot authorize a new long-lived signed capture after the next click.
  if(typeof e.endsAt!=='string'
    ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(e.endsAt))
    return null
  const endsAt=Date.parse(e.endsAt)
  if(!Number.isSafeInteger(endsAt)||endsAt<=now+EXPIRING_PAID_MS)return null
  return {days,expiresAt:endsAt}
}

function connected(s:Session):boolean{
  return activeSession.value===s&&s.online
    &&(typeof navigator==='undefined'||navigator.onLine)
}

/** Background refresh, deduplicated per currently authenticated session. */
export function refreshRetentionHint(session:Session):Promise<void>{
  if(!connected(session)){
    if(verified?.session===session)verified=null
    return Promise.resolve()
  }
  if(pending?.session===session)return pending.task
  const task=(async()=>{
    try{
      const payload=await jsonApi<unknown>('/billing/v1/me')
      // A delayed reply from a logged-out/recovered account must never
      // influence another session, even if the two share the same accountId.
      if(!connected(session))return
      const now=Date.now()
      const accepted=validatedPaidHint(payload,now)
      verified=accepted?{
        session,receivedAt:now,
        expiresAt:accepted.expiresAt,days:accepted.days,
      }:null
    }catch{
      // A failed lookup is NOT a claim of paid entitlement. Keep Local-First
      // capture working with the existing signed 13-day baseline.
      if(activeSession.value===session)verified=null
    }
  })()
  pending={session,task}
  void task.finally(()=>{
    if(pending?.task===task)pending=null
  })
  return task
}

/**
 * Purely synchronous, never a network gate. Pick an immutable deadline BEFORE
 * AES-GCM key wrapping. On a cold/offline/stale session the original 13-day
 * conservative contract remains durable and can be uploaded after reconnect.
 */
export function newSignedExpiry(createdAt:number,session:Session):number{
  const now=Date.now()
  const fresh=connected(session)&&verified?.session===session
    &&verified.receivedAt<=now
    &&now-verified.receivedAt<=FRESH_MS
    &&verified.expiresAt>now+EXPIRING_PAID_MS
  if(!fresh&&connected(session))void refreshRetentionHint(session)
  const days=fresh?verified!.days:DEFAULT_DAYS
  return createdAt+days*DAY_MS
}
