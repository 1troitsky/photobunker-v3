// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, shallowRef, type App } from 'vue'
import { activeSession, type Session } from '../../identity/application/session'
import { readVerifiedGraceStatus, type GraceStatus } from '../application/grace-client'
import GraceStatusPanel from './GraceStatusPanel.vue'

vi.mock('../application/grace-client', () => ({readVerifiedGraceStatus:vi.fn()}))
const load=vi.mocked(readVerifiedGraceStatus)
function session(accountId='alice',online=true):Session{
  return {accountId,deviceId:'device-'+accountId,online,
    device:{} as Session['device'],pkg:{} as Session['pkg']}
}
function confirmed(values:Partial<GraceStatus>={}):GraceStatus{
  return {
    revision:2,snapshotSha256:'a'.repeat(64),planId:'go',effectivePlanId:'free',
    status:'grace',paidPrivilegesActive:false,graceDays:15,
    asOfAt:'2026-11-14T12:00:00Z',planEndsAt:'2026-11-13T12:00:00Z',
    graceEndsAt:'2026-11-28T12:00:00Z',nextDeadlineAt:'2026-11-28T12:00:00Z',
    graceActive:true,paidRightsDowngraded:true,...values,
  }
}
function deferred<T>(){
  let resolve!:(value:T)=>void,reject!:(error:Error)=>void
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no})
  return {promise,resolve,reject}
}
let host:HTMLDivElement,app:App|undefined
let presented=shallowRef<Session>(session())
async function settle():Promise<void>{
  for(let i=0;i<6;i++){await Promise.resolve();await nextTick()}
}
async function mount(s:Session):Promise<void>{
  presented=shallowRef(s)
  activeSession.value=s
  host=document.createElement('div')
  document.body.append(host)
  const Wrapper=defineComponent({
    setup(){return ()=>h(GraceStatusPanel,{session:presented.value})},
  })
  app=createApp(Wrapper)
  app.mount(host)
  await settle()
}
function element(testid:string):Element|null{
  return host.querySelector('[data-testid="'+testid+'"]')
}
beforeEach(()=>{vi.resetAllMocks();activeSession.value=null})
afterEach(async()=>{
  app?.unmount();app=undefined;host?.remove()
  activeSession.value=null;await settle()
})

describe('#226 authenticated settings grace status',()=>{
  it('renders verified paid grace, Free new writes and unchanged signed TTL warning',async()=>{
    load.mockResolvedValue(confirmed())
    await mount(session())
    expect(load).toHaveBeenCalledTimes(1)
    expect(element('billing-grace-verified')?.textContent).toContain('go')
    expect(element('billing-grace-verified')?.textContent).toContain('2026-11-28T12:00:00Z')
    expect(element('billing-grace-free-policy')?.textContent).toContain('Free')
    expect(element('billing-grace-free-policy')?.textContent).toContain('подписанному TTL')
    expect(element('billing-grace-as-of')?.textContent).toContain('2026-11-14T12:00:00Z')
  })
  it('does not claim a paid plan or contact the server for offline identity',async()=>{
    await mount(session('alice',false))
    expect(load).not.toHaveBeenCalled()
    expect(element('billing-grace-unverified')?.textContent).toContain('не проверены')
    expect((element('billing-grace-refresh') as HTMLButtonElement).disabled).toBe(true)
  })
  it('shows authenticated Free without a made-up payment deadline',async()=>{
    load.mockResolvedValue(confirmed({
      planId:'free',effectivePlanId:'free',status:'active',
      graceDays:null,planEndsAt:null,graceEndsAt:null,nextDeadlineAt:null,
      graceActive:false,paidRightsDowngraded:false,
    }))
    await mount(session())
    expect(element('billing-grace-verified')?.textContent).toContain('Бесплатный тариф')
    expect(element('billing-grace-verified')?.textContent).not.toContain('Окончание оплаты')
    expect(element('billing-grace-free-policy')).toBeNull()
  })
  it('never exposes a late prior-account HTTP response after identity switch',async()=>{
    const first=deferred<GraceStatus>(),second=deferred<GraceStatus>()
    load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await mount(session('alice'))
    expect(element('billing-grace-loading')).toBeTruthy()
    const bob=session('bob')
    activeSession.value=bob
    presented.value=bob
    await settle()
    expect(load).toHaveBeenCalledTimes(2)
    first.resolve(confirmed({planId:'unlimited_plus',effectivePlanId:'unlimited_plus',
      status:'active',paidPrivilegesActive:true,graceActive:false,
      paidRightsDowngraded:false}))
    await settle()
    expect(element('billing-grace-verified')).toBeNull()
    second.resolve(confirmed({planId:'free',effectivePlanId:'free',
      status:'active',graceDays:null,planEndsAt:null,graceEndsAt:null,
      nextDeadlineAt:null,graceActive:false,paidRightsDowngraded:false}))
    await settle()
    expect(element('billing-grace-verified')?.textContent).toContain('free')
    expect(element('billing-grace-verified')?.textContent).not.toContain('unlimited_plus')
  })
  it('drops verified paid status immediately when session goes offline',async()=>{
    load.mockResolvedValue(confirmed({status:'active',planId:'pro',
      effectivePlanId:'pro',paidPrivilegesActive:true,
      graceActive:false,paidRightsDowngraded:false}))
    await mount(session())
    expect(element('billing-grace-verified')?.textContent).toContain('pro')
    const offline=session('alice',false)
    activeSession.value=offline
    presented.value=offline
    await settle()
    expect(element('billing-grace-verified')).toBeNull()
    expect(element('billing-grace-unverified')).toBeTruthy()
  })
  it('does not publish a late result after logout/unmount',async()=>{
    const first=deferred<GraceStatus>()
    load.mockReturnValue(first.promise)
    await mount(session())
    app?.unmount();app=undefined;activeSession.value=null
    first.resolve(confirmed())
    await settle()
    expect(element('billing-grace-verified')).toBeNull()
  })
  it('refetches on explicit user retry and hides stale state on HTTP failure',async()=>{
    load.mockResolvedValueOnce(confirmed()).mockRejectedValueOnce(Error('api.http_401'))
      .mockResolvedValueOnce(confirmed({status:'expired',nextDeadlineAt:null,
        graceActive:false,paidRightsDowngraded:true}))
    await mount(session())
    expect(element('billing-grace-verified')).toBeTruthy()
    ;(element('billing-grace-refresh') as HTMLButtonElement).click()
    await settle()
    expect(element('billing-grace-verified')).toBeNull()
    expect(element('billing-grace-error')?.textContent).toContain('Не удалось подтвердить')
    ;(element('billing-grace-refresh') as HTMLButtonElement).click()
    await settle()
    expect(element('billing-grace-verified')?.textContent).toContain('Льготный срок завершён')
  })
})
