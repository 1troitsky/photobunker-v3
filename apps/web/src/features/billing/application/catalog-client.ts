import { jsonApi } from '../../identity/infrastructure/api'

export interface PublicPlan {
  planId:'free'|'go'|'pro'|'unlimited'|'unlimited_plus'
  monthlyPriceCents:number
  periodPricesCents:Record<string,number>
  limits:{
    assignmentCreationsPerMonth:number|null
    maxMediaFiles:number|null
    storage:{amount:number;unit:'GB'|'TB';byteCeiling:number|null;unitPolicy:string}
    retention:{days?:number;mode?:string}
    manualBackupUpdatesPerWeek:number|null
    autoBackupUpdates:{perWeek:number|null;perDay:number|null}
    graceDays:number|null
  }
  featureFlags:{
    encryptedCloudBackup:boolean
    emergencyPin:boolean
    remoteEmergency:boolean
    matrixE2eeMessages:boolean
    prioritySupport:boolean
  }
}
const names=['free','go','pro','unlimited','unlimited_plus'] as const
function integer(v:unknown):v is number {return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0}
function quota(v:unknown):v is number|null{return v===null||integer(v)}
function fail():never{throw Error('billing.catalog_unverified')}
function record(v:unknown):Record<string,unknown>{
  if(!v||typeof v!=='object'||Array.isArray(v))fail()
  return v as Record<string,unknown>
}
/** Public catalog is server-defined. Never hardcode prices or activate entitlements. */
export function parsePublicCatalog(raw:unknown):PublicPlan[]{
  const root=record(raw),items=root.plans
  if(root.schemaVersion!==1||root.currency!=='USD'||!Array.isArray(items)
    ||items.length!==names.length
    ||typeof root.catalogVersion!=='string'||typeof root.effectiveAt!=='string')fail()
  const found=new Set<string>()
  const parsed:PublicPlan[]=items.map((value:unknown)=>{
    const p=record(value),lim=record(p.limits),st=record(lim.storage)
    const prices=record(p.periodPricesCents),flags=record(p.featureFlags)
    const auto=record(lim.autoBackupUpdates),retention=record(lim.retention)
    if(typeof p.planId!=='string'||!names.includes(p.planId as PublicPlan['planId'])
      ||found.has(p.planId)||!integer(p.monthlyPriceCents)
      ||!integer(prices['1'])||prices['1']!==p.monthlyPriceCents
      ||(p.planId==='free'?(Object.keys(prices).length!==1)
        :[1,6,12].some(n=>!integer(prices[String(n)])))
      ||!quota(lim.assignmentCreationsPerMonth)
      ||!quota(lim.maxMediaFiles)||!integer(st.amount)
      ||!['GB','TB'].includes(String(st.unit))
      ||!quota(st.byteCeiling)||typeof st.unitPolicy!=='string'
      ||!quota(lim.manualBackupUpdatesPerWeek)
      ||!quota(auto.perWeek)||!quota(auto.perDay)
      ||!quota(lim.graceDays)
      ||!(integer(retention.days)||retention.mode==='while_plan_active_with_assignment_policy')
      ||typeof flags.encryptedCloudBackup!=='boolean'
      ||typeof flags.emergencyPin!=='boolean'
      ||typeof flags.remoteEmergency!=='boolean'
      ||typeof flags.matrixE2eeMessages!=='boolean'
      ||typeof flags.prioritySupport!=='boolean')fail()
    found.add(p.planId)
    return p as unknown as PublicPlan
  })
  if(names.some(x=>!found.has(x)))fail()
  return parsed
}
export async function readPublicCatalog():Promise<PublicPlan[]>{
  const response=await jsonApi<unknown>('/billing/v1/plans')
  return parsePublicCatalog(response)
}
