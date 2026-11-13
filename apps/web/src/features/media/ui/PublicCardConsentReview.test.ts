// @vitest-environment jsdom
import {Blob as NodeBlob} from 'node:buffer'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,h,nextTick,shallowReactive,type App} from 'vue'
import {activeSession,type Session} from '../../identity/application/session'
import {digest,hex} from '../../identity/infrastructure/crypto'
import type {PreparedSafePublicJpeg} from '../application/public-card-safe-jpeg'
import type {ConsentBinding} from '../application/public-card-consent-outbox'
import PublicCardConsentReview from './PublicCardConsentReview.vue'

const ops=vi.hoisted(()=>({
  prepare:vi.fn(),list:vi.fn(),withdraw:vi.fn(),
}))
vi.mock('../application/public-card-consent-outbox',()=>({
  prepareReviewedContributorConsent:ops.prepare,
  listPreparedContributorConsents:ops.list,
  withdrawPreparedContributorConsent:ops.withdraw,
}))
const bytes=()=>new Uint8Array([
  0xff,0xd8,
  0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0,
  0xff,0xdb,0,4,0,1,
  0xff,0xc4,0,4,0,0,
  0xff,0xc0,0,11,8,0,2,0,3,1,1,0x11,0,
  0xff,0xda,0,8,1,1,0,0,63,0,
  0x35,0x46,0xff,0,0x67,0xff,0xd9,
])
const id=(x:string)=>x.repeat(8)+'-'+x.repeat(4)+'-4'+x.repeat(3)
  +'-8'+x.repeat(3)+'-'+x.repeat(12)
const binding=():ConsentBinding=>({
  assignmentId:id('2'),submissionId:id('3'),
  submissionContractHash:'a'.repeat(64),
  sourceMediaId:id('4'),sourceContractHash:'b'.repeat(64),
  safeMediaId:id('5'),sourceExpiresAt:Date.now()+900_000,
  safeExpiresAt:Date.now()+900_000,assignmentExpiresAt:Date.now()+900_000,
})
async function safe():Promise<PreparedSafePublicJpeg>{
  const data=bytes()
  return {
    blob:new NodeBlob([data],{type:'image/jpeg'}) as unknown as Blob,
    width:3,height:2,sha256:hex(await digest(data)),
    published:false,humanReviewRequired:true,
  }
}
async function session():Promise<Session>{
  // The real signature/AKEK is exercised by application outbox tests.
  // This isolated jsdom DOM test needs only an identity sentinel; jsdom and
  // Node WebCrypto ArrayBuffer realms cannot create an exportable P256 key
  // through the production package serializer.
  const accountId=crypto.randomUUID()
  return {
    accountId,deviceId:crypto.randomUUID(),
    pkg:{
      v:2,accountId,accountSpki:'fixture-identity-spki',
      accountPkcs8:'fixture-private-key',akek:'fixture-akek',
      signingKeyId:'fixture-signer',wrappingKeyId:'fixture-wrapper',
      revision:1,
    },online:false,
  } as unknown as Session
}
async function settle():Promise<void>{
  for(let i=0;i<14;i++){await Promise.resolve();await nextTick()}
}
const button=(host:HTMLElement,testid:string)=>host.querySelector<HTMLButtonElement>(
  '[data-testid="'+testid+'"]'
)!
const checkbox=(host:HTMLElement,testid:string)=>host.querySelector<HTMLInputElement>(
  '[data-testid="'+testid+'"]'
)!
let app:App|undefined
let host:HTMLDivElement
let props:{prepared:PreparedSafePublicJpeg|null;binding:ConsentBinding|null}
let preparedEvent:ReturnType<typeof vi.fn>
let withdrawnEvent:ReturnType<typeof vi.fn>
let createObjectURL:ReturnType<typeof vi.fn>
let revokeObjectURL:ReturnType<typeof vi.fn>
let originalCreate:PropertyDescriptor|undefined
let originalRevoke:PropertyDescriptor|undefined
let serial=0
async function mount():Promise<void>{
  activeSession.value=await session()
  props=shallowReactive({prepared:await safe(),binding:binding()})
  host=document.createElement('div')
  document.body.append(host)
  preparedEvent=vi.fn();withdrawnEvent=vi.fn()
  app=createApp({
    render:()=>h(PublicCardConsentReview,{
      prepared:props.prepared,binding:props.binding,
      onPrepared:preparedEvent,onWithdrawn:withdrawnEvent,
    }),
  })
  app.mount(host)
  await settle()
}
async function load():Promise<void>{
  const img=host.querySelector<HTMLImageElement>(
    '[data-testid="public-card-review-image"'
      +']'
  )
  expect(img).not.toBeNull()
  img!.dispatchEvent(new Event('load'))
  await settle()
}
async function check():Promise<void>{
  const input=checkbox(host,'public-card-review-confirm')
  input.checked=true
  input.dispatchEvent(new Event('change',{bubbles:true}))
  await settle()
}

beforeEach(()=>{
  vi.clearAllMocks()
  ops.list.mockResolvedValue([])
  ops.prepare.mockResolvedValue(id('a'))
  ops.withdraw.mockResolvedValue({
    withdrawn:true,localOnly:true,publicGrantRevoked:false,
  })
  createObjectURL=vi.fn(()=> 'blob:http://localhost/public-card-'+(++serial))
  revokeObjectURL=vi.fn()
  originalCreate=Object.getOwnPropertyDescriptor(URL,'createObjectURL')
  originalRevoke=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL')
  Object.defineProperty(URL,'createObjectURL',{
    configurable:true,value:createObjectURL,
  })
  Object.defineProperty(URL,'revokeObjectURL',{
    configurable:true,value:revokeObjectURL,
  })
  vi.stubGlobal('createImageBitmap',async()=>({
    width:3,height:2,close:vi.fn(),
  }))
})
afterEach(()=>{
  if(app){app.unmount();app=undefined}
  host?.remove()
  activeSession.value=null
  if(originalCreate)Object.defineProperty(URL,'createObjectURL',originalCreate)
  else Reflect.deleteProperty(URL,'createObjectURL')
  if(originalRevoke)Object.defineProperty(URL,'revokeObjectURL',originalRevoke)
  else Reflect.deleteProperty(URL,'revokeObjectURL')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('#211 contributor reviewed-safe-JPEG isolated UI (no publication)',()=>{
  it('never prepares consent automatically or without decoded image load and checkbox',async()=>{
    await mount()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(button(host,'public-card-review-prepare').disabled).toBe(true)
    expect(ops.prepare).not.toHaveBeenCalled()
    await load()
    expect(button(host,'public-card-review-prepare').disabled).toBe(true)
    await check()
    expect(button(host,'public-card-review-prepare').disabled).toBe(false)
    expect(host.textContent).toContain('Ничего не опубликовано')
    expect(ops.prepare).not.toHaveBeenCalled()
  })
  it('signs an explicitly reviewed exact JPEG using owner-private offline journal only',async()=>{
    await mount();await load();await check()
    button(host,'public-card-review-prepare').click()
    await settle()
    expect(ops.prepare).toHaveBeenCalledTimes(1)
    const args=ops.prepare.mock.calls[0]!
    expect(args[0].submissionId).toEqual(props.binding!.submissionId)
    expect(args[1]).toBe(props.prepared)
    expect(args[2]).toEqual({
      visiblePixelsReviewed:true,
      reviewedSha256:props.prepared!.sha256,
    })
    expect(args[3]).toEqual({
      description:false,capturedAt:false,updatedAt:false,
      tags:false,authorTeam:false,gps:false,metadata:false,
    })
    expect(args[4]).toBeGreaterThan(Date.now())
    expect(args[4]).toBeLessThanOrEqual(props.binding!.safeExpiresAt)
    expect(typeof args[5]).toBe('function')
    expect(preparedEvent).toHaveBeenCalledWith(id('a'))
    expect(host.textContent).toContain('Публикация выключена')
    expect(button(host,'public-card-review-prepare').disabled).toBe(true)
  })
  it('invalid JPEG digest blocks the preview itself and prevents consent',async()=>{
    await mount()
    const wrong={...props.prepared!,sha256:'f'.repeat(64)}
    props.prepared=wrong
    await settle()
    expect(host.querySelector('[data-testid="public-card-review-image"]')).toBeNull()
    expect(button(host,'public-card-review-prepare').disabled).toBe(true)
    expect(host.querySelector('[role="alert"]')?.textContent)
      .toContain('public_card.review_mismatched_bytes')
    expect(ops.prepare).not.toHaveBeenCalled()
  })
  it('switching selected safe image destroys old preview URL and checkbox state',async()=>{
    await mount();await load();await check()
    const first=host.querySelector<HTMLImageElement>(
      '[data-testid="public-card-review-image"]'
    )!.src
    props.prepared=await safe()
    await settle()
    expect(revokeObjectURL).toHaveBeenCalledWith(first)
    expect(button(host,'public-card-review-prepare').disabled).toBe(true)
    await load()
    expect(button(host,'public-card-review-prepare').disabled).toBe(true)
    expect(ops.prepare).not.toHaveBeenCalled()
  })
  it('switching session while image displayed revokes it, prevents signing',async()=>{
    await mount();await load();await check()
    const first=host.querySelector<HTMLImageElement>(
      '[data-testid="public-card-review-image"]'
    )!.src
    activeSession.value=await session()
    await settle()
    expect(revokeObjectURL).toHaveBeenCalledWith(first)
    expect(button(host,'public-card-review-prepare').disabled).toBe(true)
    expect(ops.prepare).not.toHaveBeenCalled()
  })
  it('changing binding during awaited cryptographic write makes commit callback refuse stale selection',async()=>{
    let resolve!: (value:string)=>void
    ops.prepare.mockImplementation((_a,_b,_c,_d,_e,guard:()=>void)=>{
      guard()
      return new Promise<string>(yes=>{resolve=yes})
    })
    await mount();await load();await check()
    button(host,'public-card-review-prepare').click()
    await settle()
    expect(ops.prepare).toHaveBeenCalledTimes(1)
    const guard=ops.prepare.mock.calls[0]![5] as ()=>void
    expect(guard).not.toThrow()
    props.binding={...props.binding!,submissionId:id('6')}
    await settle()
    expect(guard).toThrow('public_card.review_changed')
    resolve(id('a'))
    await settle()
    expect(preparedEvent).not.toHaveBeenCalled()
    expect(button(host,'public-card-review-prepare').disabled).toBe(true)
  })
  it('change in disclosure fields clears the exact-review acknowledgement',async()=>{
    await mount();await load();await check()
    const option=checkbox(host,'public-card-review-description')
    option.checked=true;option.dispatchEvent(new Event('change',{bubbles:true}))
    await settle()
    expect(button(host,'public-card-review-prepare').disabled).toBe(true)
    await check()
    button(host,'public-card-review-prepare').click()
    await settle()
    expect(ops.prepare.mock.calls[0]![3].description).toBe(true)
    expect(ops.prepare.mock.calls[0]![3].gps).toBe(false)
  })
  it('existing local prepared draft enables local withdrawal, not a server revoke',async()=>{
    ops.list.mockImplementation(async()=>{
      return [{
        contract:{submissionId:id('3')},
        state:'prepared',published:false,publicAuthorized:false,
      }]
    })
    await mount();await load()
    expect(button(host,'public-card-review-prepare').disabled).toBe(true)
    expect(button(host,'public-card-review-withdraw').disabled).toBe(false)
    button(host,'public-card-review-withdraw').click()
    await settle()
    expect(ops.withdraw).toHaveBeenCalledWith(id('3'))
    expect(withdrawnEvent).toHaveBeenCalledWith(id('3'))
    expect(host.textContent).toContain('Серверных разрешений это не изменяет')
    expect(button(host,'public-card-review-prepare').disabled).toBe(true)
    expect(ops.prepare).not.toHaveBeenCalled()
  })
  it('corrupt locally encrypted records fail closed instead of enabling a new signature',async()=>{
    ops.list.mockRejectedValue(Error('public_card.consent_ciphertext_unreadable'))
    await mount()
    expect(host.querySelector('[role="alert"]')?.textContent)
      .toContain('public_card.consent_ciphertext_unreadable')
    expect(button(host,'public-card-review-prepare').disabled).toBe(true)
  })
  it('unmount revokes object URL and never persists safe JPEG itself',async()=>{
    await mount();await load()
    expect(ops.prepare).not.toHaveBeenCalled()
    const first=host.querySelector<HTMLImageElement>(
      '[data-testid="public-card-review-image"]'
    )!.src
    app!.unmount();app=undefined
    expect(revokeObjectURL).toHaveBeenCalledWith(first)
    expect(ops.prepare).not.toHaveBeenCalled()
  })
})
