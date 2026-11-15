import { describe, expect, it } from 'vitest'
import { parsePublicCatalog } from './catalog-client'
const valid=()=>({
 schemaVersion:1,currency:'USD',catalogVersion:'pb3-2026-11-12',effectiveAt:'2026-11-12T00:00:00Z',
 plans:['free','go','pro','unlimited','unlimited_plus'].map((planId,i)=>({
  planId,monthlyPriceCents:i*100,periodPricesCents:i===0?{'1':0}:{'1':i*100,'6':i*550,'12':i*1000},
  limits:{assignmentCreationsPerMonth:i+1,maxMediaFiles:i*5,storage:{amount:10,unit:'GB',byteCeiling:10000000000,unitPolicy:'DECIMAL_GB_TB_V1'},
   retention:{days:30},manualBackupUpdatesPerWeek:1,autoBackupUpdates:{perWeek:1,perDay:null},graceDays:i===0?null:15},
  featureFlags:{encryptedCloudBackup:true,emergencyPin:true,remoteEmergency:true,matrixE2eeMessages:true,prioritySupport:false},
 }))
})
describe('PB3 server-owned public tariff catalog',()=>{
 it('reads 5 server plans with their original amounts and exact periods',()=>{
  const plans=parsePublicCatalog(valid())
  expect(plans.map(x=>x.planId)).toEqual(['free','go','pro','unlimited','unlimited_plus'])
  expect(plans[3]?.periodPricesCents['6']).toBe(1650)
 })
 it('rejects fake, duplicate or malformed price lists',()=>{
  const a=valid();a.plans[1]!.planId='free'
  expect(()=>parsePublicCatalog(a)).toThrow('billing.catalog_unverified')
  const b=valid();b.plans[2]!.periodPricesCents['1']=999
  expect(()=>parsePublicCatalog(b)).toThrow('billing.catalog_unverified')
  const c=valid();c.currency='EUR'
  expect(()=>parsePublicCatalog(c)).toThrow('billing.catalog_unverified')
 })
})
