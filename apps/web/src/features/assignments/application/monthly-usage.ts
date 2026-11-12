/**
 * An authenticated, read-only snapshot of the server's current UTC-month
 * Assignment creation allowance. It is NOT an offline authorization and must
 * never be used to decide whether an encrypted local draft may be created.
 */
export const ASSIGNMENT_PLAN_IDS=[
  'free','go','pro','unlimited','unlimited_plus',
] as const

export type AssignmentPlanId=(typeof ASSIGNMENT_PLAN_IDS)[number]
export type AssignmentMonthlyUsage={
  planId:AssignmentPlanId;catalogVersion:string
  periodStart:string;periodEnd:string
  limit:number|null;used:number;remaining:number|null
}

const planLabels:Record<AssignmentPlanId,string>={
  free:'Free',go:'Go',pro:'Pro',
  unlimited:'Unlimited',unlimited_plus:'Unlimited+',
}

export function assignmentMonthlyPlanLabel(id:AssignmentPlanId):string{
  return planLabels[id]
}

/**
 * Keep the frontend aligned with the versioned five-plan server contract.
 * A null limit AND null remaining means unlimited monthly product creations,
 * not unlimited traffic or storage. Grace/downgrade may have used > limit.
 */
export function parseAssignmentMonthlyUsage(value:unknown):AssignmentMonthlyUsage{
  const invalid=():never=>{throw Error('assignment.usage_invalid')}
  if(value===null||typeof value!=='object'||Array.isArray(value))return invalid()
  const data=value as Record<string,unknown>
  if(typeof data.planId!=='string'
    ||!ASSIGNMENT_PLAN_IDS.some(id=>id===data.planId)
    ||typeof data.catalogVersion!=='string'
    ||data.catalogVersion.trim().length===0
    ||data.catalogVersion.length>128
    ||!Number.isSafeInteger(data.used)
    ||(data.used as number)<0)return invalid()

  // Under the approved five-plan catalog only Unlimited tiers may use the
  // unbounded count sentinel. A forged Free/Go/Pro null must fail closed.
  const unlimited=data.planId==='unlimited'||data.planId==='unlimited_plus'
  const bounded=data.limit!==null
  if(unlimited===bounded)return invalid()
  if(bounded){
    if(!Number.isSafeInteger(data.limit)||(data.limit as number)<0
      ||!Number.isSafeInteger(data.remaining)
      ||(data.remaining as number)<0
      ||data.remaining!==Math.max(0,(data.limit as number)-(data.used as number)))
      return invalid()
  }else if(data.remaining!==null){
    return invalid()
  }

  if(typeof data.periodStart!=='string'||typeof data.periodEnd!=='string'
    ||data.periodStart.length>64||data.periodEnd.length>64)
    return invalid()
  const start=Date.parse(data.periodStart),end=Date.parse(data.periodEnd)
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return invalid()
  const first=new Date(start)
  // A UTC calendar month, never a client-selected rolling billing window.
  if(start!==Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),1)
    ||end!==Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,1))
    return invalid()

  return {
    planId:data.planId as AssignmentPlanId,
    catalogVersion:data.catalogVersion as string,
    periodStart:data.periodStart as string,
    periodEnd:data.periodEnd as string,
    limit:data.limit as number|null,
    used:data.used as number,
    remaining:data.remaining as number|null,
  }
}
