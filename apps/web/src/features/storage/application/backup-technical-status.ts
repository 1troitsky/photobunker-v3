import {jsonApi} from '../../identity/infrastructure/api'

export type BackupTechnicalGate='clear'|'cooldown'|'active_lease'
export type BackupTechnicalStatus={
  schemaVersion:1
  asOfAt:string
  technicalGate:BackupTechnicalGate
  technicalBlocked:boolean
  activeLeaseState:'reserved'|'started'|null
  retryAfterSeconds:number|null
  nextTechnicalStartAt:string|null
  minimumStartIntervalSeconds:number
  source:'server_backup_admission_v1'
  scope:'advisory_only_not_backup_eligibility_or_verified_backup'
}
const utc=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/
function validTimestamp(s:unknown):s is string{
  return typeof s==='string'&&utc.test(s)&&!Number.isNaN(Date.parse(s))
}
function fail():never{throw Error('backup.technical_status_unverified')}
/**
 * GET /backup/v1/limits is owner-device authenticated, and is ONLY advisory.
 * NEVER turn its "clear" state into a "backup enabled" action; an atomic
 * POST admission and a durable encrypted backup worker are still missing.
 */
export function parseBackupTechnicalStatus(raw:unknown):BackupTechnicalStatus{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail()
  const p=raw as Record<string,unknown>
  const keys=['schemaVersion','asOfAt','technicalGate','technicalBlocked',
    'activeLeaseState','retryAfterSeconds','nextTechnicalStartAt',
    'minimumStartIntervalSeconds','source','scope']
  if(Object.keys(p).sort().join('|')!==keys.sort().join('|'))fail()
  const gate=p.technicalGate
  if(p.schemaVersion!==1
    ||!validTimestamp(p.asOfAt)
    ||(gate!=='clear'&&gate!=='cooldown'&&gate!=='active_lease')
    ||typeof p.technicalBlocked!=='boolean'
    ||p.technicalBlocked!==(gate!=='clear')
    ||(p.activeLeaseState!==null&&p.activeLeaseState!=='reserved'&&p.activeLeaseState!=='started')
    ||(gate==='active_lease')!==(p.activeLeaseState!==null)
    ||(p.retryAfterSeconds!==null&&(!Number.isSafeInteger(p.retryAfterSeconds)||Number(p.retryAfterSeconds)<1))
    ||(gate==='clear'&&p.retryAfterSeconds!==null)
    ||(gate!=='clear'&&p.retryAfterSeconds===null)
    ||(p.nextTechnicalStartAt!==null&&!validTimestamp(p.nextTechnicalStartAt))
    ||(gate==='clear'&&p.nextTechnicalStartAt!==null)
    ||(gate!=='clear'&&p.nextTechnicalStartAt===null)
    ||!Number.isSafeInteger(p.minimumStartIntervalSeconds)
    ||Number(p.minimumStartIntervalSeconds)<3600
    ||p.source!=='server_backup_admission_v1'
    ||p.scope!=='advisory_only_not_backup_eligibility_or_verified_backup')fail()
  return p as BackupTechnicalStatus
}
export async function readBackupTechnicalStatus():Promise<BackupTechnicalStatus>{
  return parseBackupTechnicalStatus(await jsonApi<unknown>('/backup/v1/limits'))
}
