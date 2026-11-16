import {describe,expect,it} from 'vitest'
import {parseBackupTechnicalStatus} from './backup-technical-status'
const valid=()=>({
  schemaVersion:1,asOfAt:'2026-11-15T12:00:00Z',
  technicalGate:'clear',technicalBlocked:false,activeLeaseState:null,
  retryAfterSeconds:null,nextTechnicalStartAt:null,minimumStartIntervalSeconds:3600,
  source:'server_backup_admission_v1',
  scope:'advisory_only_not_backup_eligibility_or_verified_backup',
})
describe('Owner-device backup technical status is advisory only',()=>{
  it('accepts a verified clear technical gate, without claiming backup eligibility',()=>{
    expect(parseBackupTechnicalStatus(valid()).technicalGate).toBe('clear')
    expect(parseBackupTechnicalStatus({...valid(),technicalGate:'cooldown',
      technicalBlocked:true,retryAfterSeconds:1900,
      nextTechnicalStartAt:'2026-11-15T12:35:00Z'}).technicalBlocked).toBe(true)
  })
  it('denies inconsistent cooldowns, imaginary backups, and unknown fields',()=>{
    const invalid:unknown[]=[
      {...valid(),source:'demo'}, {...valid(),technicalBlocked:true},
      {...valid(),technicalGate:'active_lease',technicalBlocked:true},
      {...valid(),technicalGate:'cooldown',technicalBlocked:true,retryAfterSeconds:1900},
      {...valid(),minimumStartIntervalSeconds:20}, {...valid(),lastBackupStatus:'success'},
      {...valid(),asOfAt:'yesterday'}, {...valid(),schemaVersion:2},
    ]
    for(const x of invalid)expect(()=>parseBackupTechnicalStatus(x)).toThrow('backup.technical_status_unverified')
  })
})
