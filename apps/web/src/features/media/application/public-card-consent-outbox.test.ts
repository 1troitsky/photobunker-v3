import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {
  activeSession,
} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {
  freshPackage,digest,hex,importSpki,verify,
} from '../../identity/infrastructure/crypto'
import {
  prepareReviewedContributorConsent,listPreparedContributorConsents,
  withdrawPreparedContributorConsent,
} from './public-card-consent-outbox'
import type {ConsentBinding,ConsentFields} from './public-card-consent-outbox'
import type {PreparedSafePublicJpeg} from './public-card-safe-jpeg'

const jpegBytes=():Uint8Array<ArrayBuffer>=>new Uint8Array([
  0xff,0xd8,
  0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0,
  0xff,0xdb,0,4,0,1,
  0xff,0xc4,0,4,0,0,
  0xff,0xc0,0,11,8,0,2,0,3,1,1,0x11,0,
  0xff,0xda,0,8,1,1,0,0,63,0,
  0x35,0x46,0xff,0,0x67,0xff,0xd9,
])
const img=async():Promise<PreparedSafePublicJpeg>=>{
  const data=jpegBytes()
  return {
    blob:new Blob([data],{type:'image/jpeg'}),
    width:3,height:2,sha256:hex(await digest(data)),
    published:false,humanReviewRequired:true,
  }
}
const u=(digit:string)=>digit.repeat(8)+'-'+digit.repeat(4)
  +'-4'+digit.repeat(3)+'-8'+digit.repeat(3)+'-'+digit.repeat(12)
const fields=():ConsentFields=>({
  description:true,capturedAt:false,
  updatedAt:false,tags:false,authorTeam:false,gps:false,metadata:false,
})
const binding=(now=Date.now(),submissionId=u('3')):ConsentBinding=>({
  assignmentId:u('2'),submissionId,
  submissionContractHash:'a'.repeat(64),
  sourceMediaId:u('4'),sourceContractHash:'b'.repeat(64),
  safeMediaId:u('5'),
  sourceExpiresAt:now+1_800_000,
  safeExpiresAt:now+1_800_000,
  assignmentExpiresAt:now+1_800_000,
})
const review=(prepared:PreparedSafePublicJpeg)=>({
  visiblePixelsReviewed:true as const,
  reviewedSha256:prepared.sha256,
})
const makeSession=async(accountId:string):Promise<Session>=>{
  const {pkg}=await freshPackage(accountId)
  return {
    accountId,
    deviceId:u('9'),
    pkg,online:false,
  } as unknown as Session
}
const rawDb=():Dexie=>{
  const raw=new Dexie('pb3-public-card-prepared-consent-v1')
  raw.version(1).stores({
    prepared:'&key,ownerScope',
    withdrawals:'&key,ownerScope',
  })
  return raw
}
type RawCipher={key:string;ownerScope:string;iv:string;ciphertext:string}
type RawTomb={key:string;ownerScope:string;withdrawnAt:number}
async function accountScope():Promise<string>{
  return hex(await digest(new TextEncoder().encode(
    'pb3.public-card-prepared-consent-index.v1\n'+alice.accountId
  )))
}
async function rawRows():Promise<RawCipher[]>{
  const db=rawDb()
  try{
    return await db.table<RawCipher>('prepared')
      .where('ownerScope').equals(await accountScope()).toArray()
  }finally{db.close()}
}
const stamp=()=>Date.now()+900_000
let alice:Session
let origin:ConsentBinding
beforeEach(async()=>{
  alice=await makeSession(crypto.randomUUID())
  activeSession.value=alice
  origin=binding()
  vi.stubGlobal('createImageBitmap',async()=>({
    width:3,height:2,close:vi.fn(),
  }))
})
afterEach(()=>{
  activeSession.value=null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('#211 encrypted owner-private prepared review consent journal',()=>{
  it('prepares offline P-256 signed exact JPEG SHA256 with NO public grant',async()=>{
    const prepared=await img()
    const id=await prepareReviewedContributorConsent(
      origin,prepared,review(prepared),fields(),stamp(),
    )
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const items=await listPreparedContributorConsents()
    expect(items).toHaveLength(1)
    const r=items[0]!
    expect(r.state).toBe('prepared')
    expect(r.published).toBe(false)
    expect(r.publicAuthorized).toBe(false)
    expect(r.imageBytesStored).toBe(false)
    expect(r.localWithdrawalOnly).toBe(true)
    expect(r.contract.safeDerivativeSha256).toBe(prepared.sha256)
    expect(r.contract.submissionId).toBe(origin.submissionId)
    expect(r.contract.action).toBe('prepare-consent')
    expect(r.contract.contributorAccountId).toBe(alice.accountId)
    const raw=JSON.stringify(r.contract)
    expect(await verify(await importSpki(alice.pkg.accountSpki),
      'pb3.public-card-contributor-consent-preflight.v1\n'+raw,r.signature)).toBe(true)
    expect(await verify(await importSpki(alice.pkg.accountSpki),
      'pb3.public-card-publication-intent.v1\n'+raw,r.signature)).toBe(false)
    for(const token of ['publicUrl','bearer','download','original','DEK']){
      expect(JSON.stringify(r)).not.toContain('"'+token+'"')
    }
  })
  it('persists only AES-GCM ciphertext and opaque account/submission indexes',async()=>{
    const prepared=await img()
    await prepareReviewedContributorConsent(origin,prepared,review(prepared),
      fields(),stamp())
    const rows=await rawRows()
    expect(rows).toHaveLength(1)
    const serialized=JSON.stringify(rows)
    for(const secret of [
      alice.accountId,origin.submissionId,origin.assignmentId,
      origin.sourceMediaId,origin.safeMediaId,origin.sourceContractHash,
      prepared.sha256,alice.pkg.akek,'reviewed-exact-safe-jpeg-sha256',
    ])expect(serialized).not.toContain(secret)
    expect(rows[0]!.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(rows[0]!.iv).toMatch(/^[A-Za-z0-9_-]+$/)
  })
  it('survives offline same-key session reload without generating network requests',async()=>{
    const prepared=await img()
    const spy=vi.fn()
    vi.stubGlobal('fetch',spy)
    await prepareReviewedContributorConsent(origin,prepared,review(prepared),
      fields(),stamp())
    activeSession.value={
      ...alice,online:true,
    } as Session
    expect(await listPreparedContributorConsents()).toHaveLength(1)
    expect(spy).not.toHaveBeenCalled()
    activeSession.value=alice
  })
  it('separates accounts and fails closed after wrong recovery AKEK for same account',async()=>{
    const prepared=await img()
    await prepareReviewedContributorConsent(origin,prepared,review(prepared),
      fields(),stamp())
    const other=await makeSession(crypto.randomUUID())
    activeSession.value=other
    expect(await listPreparedContributorConsents()).toEqual([])
    const newKeys=await makeSession(alice.accountId)
    activeSession.value=newKeys
    await expect(listPreparedContributorConsents())
      .rejects.toThrow('public_card.consent_ciphertext_unreadable')
    activeSession.value=alice
    expect(await listPreparedContributorConsents()).toHaveLength(1)
  })
  it('requires explicit exact SHA review, valid JPEG and restrictive view fields',async()=>{
    const prepared=await img()
    await expect(prepareReviewedContributorConsent(
      origin,prepared,{visiblePixelsReviewed:true,
        reviewedSha256:'f'.repeat(64)},fields(),stamp()
    )).rejects.toThrow('public_card.consent_unverified_jpeg')
    await expect(prepareReviewedContributorConsent(
      origin,prepared,{visiblePixelsReviewed:false as true,
        reviewedSha256:prepared.sha256},fields(),stamp()
    )).rejects.toThrow('public_card.consent_review_required')
    await expect(prepareReviewedContributorConsent(
      origin,prepared,review(prepared),{...fields(),gps:true},stamp()
    )).rejects.toThrow('public_card.consent_invalid')
    const unsafe=new Blob([new Uint8Array([
      0xff,0xd8,0xff,0xe1,0,6,1,2,3,4,
      ...jpegBytes().slice(2),
    ])],{type:'image/jpeg'})
    const unsafePrepared={...prepared,blob:unsafe}
    await expect(prepareReviewedContributorConsent(
      origin,unsafePrepared,review(prepared),fields(),stamp()
    )).rejects.toThrow('public_card.unsafe_jpeg')
    expect(await listPreparedContributorConsents()).toEqual([])
  })
  it('rejects digest-preserving substitution and forged dimensions',async()=>{
    const prepared=await img()
    const forged={...prepared,width:4}
    await expect(prepareReviewedContributorConsent(
      origin,forged,review(prepared),fields(),stamp()
    )).rejects.toThrow('public_card.consent_jpeg_changed')
    const changed=new Uint8Array(await prepared.blob.arrayBuffer())
    changed[changed.length-3]=0x63
    const alter={...prepared,
      blob:new Blob([new Uint8Array(changed)],{type:'image/jpeg'}),
    }
    await expect(prepareReviewedContributorConsent(
      origin,alter,review(prepared),fields(),stamp()
    )).rejects.toThrow('public_card.consent_jpeg_changed')
  })
  it('rejects stale media retention, expired consent and >24h future consent',async()=>{
    const prepared=await img()
    await expect(prepareReviewedContributorConsent(
      origin,prepared,review(prepared),fields(),Date.now()-1
    )).rejects.toThrow('public_card.consent_expired')
    await expect(prepareReviewedContributorConsent(
      origin,prepared,review(prepared),fields(),Date.now()+86_400_001
    )).rejects.toThrow('public_card.consent_expired')
    await expect(prepareReviewedContributorConsent(
      {...origin,safeExpiresAt:Date.now()-1},
      prepared,review(prepared),fields(),stamp(),
    )).rejects.toThrow('public_card.consent_expired_binding')
    await prepareReviewedContributorConsent(
      origin,prepared,review(prepared),fields(),stamp(),
    )
    const first=(await listPreparedContributorConsents())[0]!
    vi.spyOn(Date,'now').mockReturnValue(first.contract.expiresAt+1)
    const expired=(await listPreparedContributorConsents())[0]!
    expect(expired.state).toBe('expired')
    expect(expired.published).toBe(false)
    expect(expired.publicAuthorized).toBe(false)
  })
  it('atomically withdraws local consent, persists tombstone and blocks resurrection',async()=>{
    const prepared=await img()
    await prepareReviewedContributorConsent(origin,prepared,review(prepared),
      fields(),stamp())
    expect(await withdrawPreparedContributorConsent(origin.submissionId)).toEqual({
      withdrawn:true,localOnly:true,publicGrantRevoked:false,
    })
    expect(await listPreparedContributorConsents()).toEqual([])
    expect(await withdrawPreparedContributorConsent(origin.submissionId)).toEqual({
      withdrawn:true,localOnly:true,publicGrantRevoked:false,
    })
    const db=rawDb()
    const tombs=await db.table<RawTomb>('withdrawals')
      .where('ownerScope').equals(await accountScope()).toArray()
    expect(tombs).toHaveLength(1)
    expect(JSON.stringify(tombs)).not.toContain(alice.accountId)
    expect(JSON.stringify(tombs)).not.toContain(origin.submissionId)
    db.close()
    await expect(prepareReviewedContributorConsent(
      origin,prepared,review(prepared),fields(),stamp()
    )).rejects.toThrow('public_card.consent_withdrawn')
  })
  it('concurrent signing cannot create two consents for one submitted photo',async()=>{
    const prepared=await img()
    const [first,second]=await Promise.allSettled([
      prepareReviewedContributorConsent(origin,prepared,review(prepared),
        fields(),stamp()),
      prepareReviewedContributorConsent(origin,prepared,review(prepared),
        fields(),stamp()),
    ])
    const results=[first,second]
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1)
    expect(await listPreparedContributorConsents()).toHaveLength(1)
  })
  it('rejects a different account taking over mid-JPEG-byte read before signing',async()=>{
    const prepared=await img()
    const next=await makeSession(crypto.randomUUID())
    const oldBytes=prepared.blob.arrayBuffer.bind(prepared.blob)
    vi.spyOn(prepared.blob,'arrayBuffer').mockImplementation(async()=>{
      activeSession.value=next
      return oldBytes()
    })
    await expect(prepareReviewedContributorConsent(
      origin,prepared,review(prepared),fields(),stamp()
    )).rejects.toThrow('public_card.consent_identity_changed')
    activeSession.value=alice
    expect(await listPreparedContributorConsents()).toEqual([])
  })
  it('rejects swapped ciphertext and tampered IV without exposing a record',async()=>{
    const prepared=await img()
    await prepareReviewedContributorConsent(origin,prepared,review(prepared),
      fields(),stamp())
    const db=rawDb()
    const row=(await rawRows())[0]!
    await db.table('prepared').put({...row,iv:'AA'})
    await expect(listPreparedContributorConsents())
      .rejects.toThrow('public_card.consent_ciphertext_unreadable')
    await db.table('prepared').put(row)
    expect(await listPreparedContributorConsents()).toHaveLength(1)
    await db.table('prepared').put({...row,key:'f'.repeat(64)})
    await expect(listPreparedContributorConsents())
      .rejects.toThrow('public_card.consent_ciphertext_unreadable')
    db.close()
  })
  it('withdrawal for unprepared submission cannot silently create a false revocation',async()=>{
    await expect(withdrawPreparedContributorConsent(origin.submissionId))
      .rejects.toThrow('public_card.consent_not_prepared')
    const db=rawDb()
    expect(await db.table('withdrawals').where('ownerScope')
      .equals(await accountScope()).count()).toBe(0)
    db.close()
  })
})
