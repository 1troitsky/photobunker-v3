// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,h,nextTick,type App} from 'vue'
import {activeSession,type Session} from '../identity/application/session'
const mocks=vi.hoisted(()=>({
  ensure:vi.fn(),inspect:vi.fn(),confirm:vi.fn(),
  queue:vi.fn(),flush:vi.fn(),outgoing:vi.fn(),received:vi.fn(),
  read:vi.fn(),revoke:vi.fn(),
}))
vi.mock('./key-directory',()=>({
  ensureOwnExchangeKey:mocks.ensure,inspectPeer:mocks.inspect,
  confirmPeer:mocks.confirm,
}))
vi.mock('./grant-flow',()=>({
  queueRecipientGrant:mocks.queue,flushRecipientGrants:mocks.flush,
  listOutgoingGrants:mocks.outgoing,listReceivedGrants:mocks.received,
  readReceivedPhoto:mocks.read,revokeOutgoingGrant:mocks.revoke,
}))
import SharePanel from './SharePanel.vue'
const A='11111111-1111-4111-8111-111111111111'
const B='33333333-3333-4333-8333-333333333333'
const PHOTO='44444444-4444-4444-8444-444444444444'
const PEER='55555555-5555-4555-8555-555555555555'
let app:App|undefined,host:HTMLDivElement
function session(accountId:string,online=true):Session{
  return {accountId,deviceId:'22222222-2222-4222-8222-222222222222',
    pkg:{accountSpki:'spki-'+accountId,revision:1},online} as unknown as Session
}
function grant(accountId:string){
  return {id:'grant-'+accountId,ownerAccountId:accountId,
    recipientAccountId:PEER,photoId:PHOTO,state:'sent',contract:'',signature:''}
}
async function settle():Promise<void>{
  for(let i=0;i<12;i++){await Promise.resolve();await nextTick()}
}
function deferred<T>(){
  let resolve!:(value:T)=>void
  const promise=new Promise<T>(r=>{resolve=r})
  return {promise,resolve}
}
async function mount():Promise<void>{
  app=createApp({render:()=>h(SharePanel,{localPhotos:[]})})
  app.mount(host);await settle()
}
beforeEach(()=>{
  host=document.createElement('div');document.body.append(host)
  mocks.ensure.mockReset().mockResolvedValue(undefined)
  mocks.inspect.mockReset().mockResolvedValue({
    directory:{safetyFingerprint:'fingerprint-A'},confirmed:true,
  })
  mocks.confirm.mockReset().mockResolvedValue(undefined)
  mocks.queue.mockReset().mockResolvedValue('grant-1')
  mocks.flush.mockReset().mockResolvedValue(undefined)
  mocks.outgoing.mockReset().mockImplementation(async()=>[grant(activeSession.value!.accountId)])
  mocks.received.mockReset().mockResolvedValue([])
  mocks.read.mockReset().mockResolvedValue(new Blob(['test']))
  mocks.revoke.mockReset().mockResolvedValue(undefined)
  activeSession.value=session(A)
})
afterEach(()=>{
  app?.unmount();app=undefined;host.remove();activeSession.value=null
})
describe('Photo E2EE grant panel account isolation',()=>{
  it('clears old outgoing grants and unsent recipient on account switch',async()=>{
    await mount()
    expect(host.textContent).toContain('grant-11 · sent')
    const recipient=host.querySelector<HTMLInputElement>('#recipient-account-id')!
    recipient.value=PEER
    recipient.dispatchEvent(new Event('input',{bubbles:true}))
    await settle()
    activeSession.value=session(B,false)
    await settle()
    expect(recipient.value).toBe('')
    expect(host.textContent).not.toContain('grant-11 · sent')
    expect(mocks.received).toHaveBeenCalledTimes(1)
    expect(host.textContent).not.toContain('Ключ обмена подготовлен')
  })
  it('ignores delayed old-account grant responses after logout/recovery',async()=>{
    const pending=deferred<ReturnType<typeof grant>[]>()
    mocks.outgoing.mockImplementation(()=>pending.promise)
    await mount()
    expect(mocks.outgoing).toHaveBeenCalledTimes(1)
    activeSession.value=session(B,false)
    await settle()
    pending.resolve([grant(A)])
    await settle()
    expect(host.textContent).not.toContain('grant-11 · sent')
    expect(host.textContent).not.toContain('Ключ обмена подготовлен')
  })
  it('discards a stale independent-fingerprint response after account switch',async()=>{
    await mount()
    const pending=deferred<{directory:{safetyFingerprint:string};confirmed:boolean}>()
    mocks.inspect.mockImplementationOnce(()=>pending.promise)
    const recipient=host.querySelector<HTMLInputElement>('#recipient-account-id')!
    recipient.value=PEER
    recipient.dispatchEvent(new Event('input',{bubbles:true}))
    await settle()
    const check=Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(node=>node.textContent?.includes('Проверить ключ'))!
    check.click();await settle()
    activeSession.value=session(B,false)
    await settle()
    pending.resolve({directory:{safetyFingerprint:'SECRET-OLD-FINGERPRINT'},confirmed:false})
    await settle()
    expect(host.textContent).not.toContain('SECRET-OLD-FINGERPRINT')
    expect(host.textContent).not.toContain('grant-11 · sent')
  })
})
