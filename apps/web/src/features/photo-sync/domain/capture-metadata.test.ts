import { describe, expect, it } from 'vitest'
import {
  normalizeGPS,preparePhotoMetadata,parsePhotoMetadata,
} from './capture-metadata'

describe('P1-06 private capture metadata validation',()=>{
  it('preserves legacy v1 when no private data was supplied',()=>{
    const now=Date.now()
    const meta=preparePhotoMetadata(now)
    expect(meta).toEqual({
      version:1,type:'image/jpeg',capturedAt:now,source:'camera',
    })
    expect(parsePhotoMetadata(meta)).toEqual(meta)
  })
  it('normalizes category, description and an explicit precise location to v2',()=>{
    const now=Date.now()
    const gps={
      latitude:41.647849,longitude:41.639411,
      accuracyMeters:4.5,recordedAt:now-2000,
    }
    const meta=preparePhotoMetadata(now,undefined,{
      category:'  Репортаж  ',
      description:'  Конфиденциальное описание\nвторой строкой  ',
      gps,
    })
    expect(meta).toEqual({
      version:2,type:'image/jpeg',capturedAt:now,source:'camera',
      category:'Репортаж',description:'Конфиденциальное описание\nвторой строкой',gps,
    })
    expect(parsePhotoMetadata(meta)).toEqual(meta)
    expect(Object.keys(meta)).not.toContain('public')
  })
  it('rejects overlong, malformed or stale data before encryption',()=>{
    const now=Date.now()
    expect(()=>preparePhotoMetadata(now,undefined,{category:'X'.repeat(65)}))
      .toThrow('capture.invalid_category')
    expect(()=>preparePhotoMetadata(now,undefined,{description:'Y'.repeat(4001)}))
      .toThrow('capture.invalid_description')
    expect(()=>preparePhotoMetadata(now,undefined,{description:'private\u0001data'}))
      .toThrow('capture.invalid_description')
    const gps={
      latitude:41.65,longitude:41.64,accuracyMeters:7,recordedAt:now-4000,
    }
    expect(normalizeGPS(gps,now)).toEqual(gps)
    expect(()=>normalizeGPS({...gps,latitude:91},now))
      .toThrow('capture.invalid_or_stale_gps')
    expect(()=>normalizeGPS({...gps,longitude:181},now))
      .toThrow('capture.invalid_or_stale_gps')
    expect(()=>normalizeGPS({...gps,accuracyMeters:-1},now))
      .toThrow('capture.invalid_or_stale_gps')
    expect(()=>normalizeGPS({...gps,recordedAt:now-120001},now))
      .toThrow('capture.invalid_or_stale_gps')
    expect(()=>normalizeGPS({...gps,recordedAt:now+3000},now))
      .toThrow('capture.invalid_or_stale_gps')
    expect(()=>parsePhotoMetadata({
      ...preparePhotoMetadata(now),gps,version:2,leak:'open',
    })).toThrow('capture.invalid_metadata')
    expect(()=>parsePhotoMetadata({
      ...preparePhotoMetadata(now),version:2,
    })).toThrow('capture.invalid_metadata')
  })
  it('uses v3 only for private tags; rejects extra fields and noncanonical metadata',()=>{
    const now=Date.now()
    const valid=preparePhotoMetadata(now,undefined,{
      category:'Report',tags:[' evidence ','field'],
    })
    expect(valid).toMatchObject({
      version:3,category:'Report',tags:['evidence','field'],
    })
    expect(parsePhotoMetadata(valid)).toEqual(valid)
    expect(()=>parsePhotoMetadata({
      ...valid,tags:['evidence','evidence'],
    })).toThrow('assignment.duplicate_rule_label')
    expect(()=>parsePhotoMetadata({
      ...valid,tags:[' evidence ','field'],
    })).toThrow()
    expect(()=>parsePhotoMetadata({...valid,version:2}))
      .toThrow('capture.invalid_metadata')
    expect(()=>parsePhotoMetadata({...valid,tags:['evidence','field'],public:true}))
      .toThrow('capture.invalid_metadata')
    expect(preparePhotoMetadata(now,undefined,{category:'Report'}).version).toBe(2)
    expect(preparePhotoMetadata(now).version).toBe(1)
  })
  it('rejects metadata with a different capturedAt than the signed scope',()=>{
    const now=Date.now()
    const binding={
      assignmentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ownerAccountId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      policyRevision:2,policyHash:'a'.repeat(64),capturedAt:now,
    }
    expect(parsePhotoMetadata(preparePhotoMetadata(now,binding))
      .assignmentCapture?.policyRevision).toBe(2)
    expect(()=>parsePhotoMetadata({
      ...preparePhotoMetadata(now,binding),capturedAt:now+1,
    })).toThrow('capture.invalid_metadata')
  })
})
