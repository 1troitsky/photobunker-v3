import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import { freshPackage, newSigning } from '../../identity/infrastructure/crypto'
import { captureEncrypted, listLocalPhotos, readLocalPhoto } from '../../photo-sync/application/p1-photo'
import { enqueueEncryptedMedia, listLocalMedia, readLocalMedia } from './media-outbox'
import { newSignedExpiry, refreshRetentionHint } from './retention-hint'

const DAY=86400000
const hash='a'.repeat(64)
afterEach(()=>{
  activeSession.value=null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function identity(online=true):Promise<Session>{
  const accountId=crypto.randomUUID()
  const { pkg }=await freshPackage(accountId)
  const signer=await newSigning(false)
  const session={
    accountId,deviceId:crypto.randomUUID(),pkg,online,
    device:{deviceKey:signer.privateKey},
  } as Session
  activeSession.value=session
  return session
}

function reply(plan:'free'|'go'|'pro'|'unlimited'|'unlimited_plus'='go',
  overrides:Record<string,unknown>={}):unknown{
  return {
    schemaVersion:1,
    entitlement:{
      revision:2,snapshotSha256:hash,
      planId:plan,effectivePlanId:plan,
      status:'active',paidPrivilegesActive:plan!=='free',
      endsAt:new Date(Math.floor((Date.now()+DAY)/1000)*1000)
        .toISOString().replace('.000Z','Z'),
      effectiveLimits:{retention:
        plan==='go'?{days:30}:plan==='pro'?{days:90}
        :plan==='free'?{days:14}
        :{mode:'while_plan_active_with_assignment_policy'}},
      ...overrides,
    },
  }
}
function mockBilling(value:unknown):ReturnType<typeof vi.fn>{
  const mock=vi.fn(async (url:string)=>{
    if(url==='/billing/v1/me')
      return new Response(JSON.stringify(value),{
        status:200,headers:{'Content-Type':'application/json'},
      })
    // Photo/Media background flush is deliberately not part of a retention
    // hint and must never be mistaken for successful cloud admission.
    return new Response('not uploaded',{status:503})
  })
  vi.stubGlobal('fetch',mock)
  return mock
}

describe('#283 Local-First server-authenticated paid TTL hints',()=>{
  it.each([
    ['free',13],['go',29],['pro',89],
    ['unlimited',13],['unlimited_plus',13],
  ] as const)('new %s snapshot selects conservative %i signed days',async(plan,days)=>{
    const s=await identity()
    const fetch=mockBilling(reply(plan))
    await refreshRetentionHint(s)
    const createdAt=Date.now()
    expect(newSignedExpiry(createdAt,s)).toBe(createdAt+days*DAY)
    expect(fetch).toHaveBeenCalledWith('/billing/v1/me',expect.objectContaining({
      method:'GET',credentials:'same-origin',cache:'no-store',
    }))
  })

  it('never awaits a remote entitlement to persist a cold Local-First capture',async()=>{
    const s=await identity()
    let finish:(value:Response)=>void=()=>{}
    const deferred=new Promise<Response>(resolve=>{finish=resolve})
    vi.stubGlobal('fetch',vi.fn((url:string)=>url==='/billing/v1/me'
      ?deferred:Promise.resolve(new Response('unavailable',{status:503}))))
    const createdAt=Date.now()
    expect(newSignedExpiry(createdAt,s)).toBe(createdAt+13*DAY)
    // A pending billing request is not a capture blocker.
    const photo=await captureEncrypted(new Blob([
      new Uint8Array(1024).fill(7)],{type:'image/jpeg'}))
    expect(photo.expiresAt-photo.createdAt).toBe(13*DAY)
    expect(await listLocalPhotos()).toHaveLength(1)
    finish(new Response(JSON.stringify(reply('go')),{status:200}))
    await refreshRetentionHint(s)
    const now=Date.now()
    expect(newSignedExpiry(now,s)-now).toBe(29*DAY)
  })

  it('a verified Go response signs real Photo and Media AES-GCM payloads for 29 days',async()=>{
    const s=await identity()
    mockBilling(reply('go'))
    await refreshRetentionHint(s)
    const photo=await captureEncrypted(new Blob([
      new Uint8Array(1024).fill(67)],{type:'image/jpeg'}))
    const mediaId=await enqueueEncryptedMedia(new File([
      new Uint8Array(1024).fill(11)],'secret.wav',{type:'audio/wav'}))
    const [row]=await listLocalMedia()
    expect(row?.mediaId).toBe(mediaId)
    expect(photo.expiresAt-photo.createdAt).toBe(29*DAY)
    expect(row!.expiresAt-row!.createdAt).toBe(29*DAY)
    expect(row!.contract.expiresAt).toBe(row!.expiresAt)
    for(const asset of photo.assets)
      expect(asset.manifest.expiresAt).toBe(photo.expiresAt)
    expect((await readLocalPhoto(photo.photoId)).size).toBe(1024)
    const opened=await readLocalMedia(mediaId)
    expect(opened.blob.size).toBe(1024)
    expect(opened.metadata.fileName).toBe('secret.wav')
  })

  it('a verified Pro response chooses 89d for both new encrypted formats',async()=>{
    const s=await identity()
    mockBilling(reply('pro'))
    await refreshRetentionHint(s)
    const photo=await captureEncrypted(new Blob([
      new Uint8Array(1024)],{type:'image/jpeg'}))
    const id=await enqueueEncryptedMedia(new File([
      new Uint8Array(512)],'long.wav',{type:'audio/wav'}))
    const row=(await listLocalMedia()).find(x=>x.mediaId===id)
    expect(photo.expiresAt-photo.createdAt).toBe(89*DAY)
    expect(row!.expiresAt-row!.createdAt).toBe(89*DAY)
    expect(row!.contract.expiresAt).toBe(row!.expiresAt)
    expect((await readLocalPhoto(photo.photoId)).size).toBe(1024)
  })

  it.each([
    ['grace',{status:'grace'}],
    ['fake paid',{paidPrivilegesActive:false}],
    ['wrong plan',{planId:'free'}],
    ['wrong cap',{effectiveLimits:{retention:{days:91}}}],
    ['no snapshot hash',{snapshotSha256:undefined}],
    ['pending',{status:'pending'}],
    ['expired time',{endsAt:new Date(Date.now()-DAY).toISOString().replace('.000Z','Z')}],
    ['ambiguous time',{endsAt:'2026-11-13 01:00:00'}],
    ['bad revision',{revision:0}],
  ])('malformed or nonactive %s response fails back to 13d',async(_label,overrides)=>{
    const s=await identity()
    mockBilling(reply('pro',overrides))
    await refreshRetentionHint(s)
    const now=Date.now()
    expect(newSignedExpiry(now,s)).toBe(now+13*DAY)
  })

  it('a failed network request, offline session, and absent snapshot retain 13d',async()=>{
    const online=await identity()
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('down',{status:503})))
    await refreshRetentionHint(online)
    const now=Date.now()
    expect(newSignedExpiry(now,online)).toBe(now+13*DAY)
    const offline=await identity(false)
    expect(newSignedExpiry(now,offline)).toBe(now+13*DAY)
  })

  it('never accepts a late response from a previous session, even same account',async()=>{
    const old=await identity()
    let release:(value:Response)=>void=()=>{}
    const pending=new Promise<Response>(resolve=>{release=resolve})
    vi.stubGlobal('fetch',vi.fn((url:string)=>url==='/billing/v1/me'
      ?pending:Promise.resolve(new Response('',{status:503}))))
    const blocked=refreshRetentionHint(old)
    const changed={...old} as Session // reauthenticated object, same accountId
    activeSession.value=changed
    const now=Date.now()
    expect(newSignedExpiry(now,changed)).toBe(now+13*DAY)
    release(new Response(JSON.stringify(reply('pro')),{status:200}))
    await blocked
    expect(newSignedExpiry(now,changed)).toBe(now+13*DAY)
  })

  it('expires an in-memory paid hint after 60 seconds with no network wait',async()=>{
    const s=await identity()
    mockBilling(reply('go'))
    await refreshRetentionHint(s)
    vi.useFakeTimers()
    const now=Date.now()
    expect(newSignedExpiry(now,s)).toBe(now+29*DAY)
    vi.setSystemTime(now+60001)
    expect(newSignedExpiry(now+60001,s)).toBe(now+60001+13*DAY)
  })
})
