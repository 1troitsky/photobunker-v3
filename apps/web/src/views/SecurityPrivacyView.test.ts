// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,h,nextTick,type App} from 'vue'
import {activeSession,type Session} from '../features/identity/application/session'
const mock=vi.hoisted(()=>({api:vi.fn(),reauth:vi.fn(),logout:vi.fn()}))
vi.mock('vue-router',()=>({
  useRoute:()=>({query:{}}),
  RouterLink:{name:'RouterLink',render:()=>null},
}))
vi.mock('../features/identity/infrastructure/api',()=>({jsonApi:mock.api}))
vi.mock('../features/identity/application/session',async(importOriginal)=>{
  const real=await importOriginal<typeof import('../features/identity/application/session')>()
  return {...real,reauthenticate:mock.reauth,logout:mock.logout}
})
import SecurityPrivacyView from './SecurityPrivacyView.vue'

const A='11111111-1111-4111-8111-111111111111'
const B='22222222-2222-4222-8222-222222222222'
function session(accountId=A,online=true):Session{
  return {accountId,deviceId:'33333333-3333-4333-8333-333333333333',
    pkg:{accountSpki:'test-spki',akek:'test-akek',revision:1},online} as unknown as Session
}
function deferred<T>(){
  let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void
  const promise=new Promise<T>((res,rej)=>{resolve=res;reject=rej})
  return {promise,resolve,reject}
}
let app:App|undefined,host:HTMLElement
async function settle():Promise<void>{
  for(let i=0;i<15;i++){await Promise.resolve();await nextTick()}
}
function hasLoading():boolean{
  return host.textContent?.includes('Загружаем устройства с сервера…')??false
}
beforeEach(()=>{
  host=document.createElement('div');document.body.append(host)
  mock.api.mockReset()
  mock.reauth.mockReset().mockResolvedValue(undefined)
  mock.logout.mockReset().mockResolvedValue(undefined)
  activeSession.value=null
})
afterEach(()=>{
  app?.unmount();app=undefined
  host.remove()
  activeSession.value=null
})
function mount():void{
  app=createApp(SecurityPrivacyView)
  app.component('RouterLink',{props:['to'],render:()=>h('a')})
  app.mount(host)
}
describe('Security & Privacy 1.3 owner-scoped device list',()=>{
  it('confirms the account only after a fresh authenticated and validated server response',async()=>{
    mock.api.mockResolvedValue({devices:[]})
    activeSession.value=session(A,true)
    mount();await settle()
    expect(mock.api).toHaveBeenCalledTimes(1)
    const verify=Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(x=>x.textContent?.trim()==='Проверить сессию')!
    verify.click();await settle()
    expect(mock.api).toHaveBeenCalledTimes(2)
    expect(mock.api).toHaveBeenLastCalledWith('/identity/v2/devices')
    expect(host.textContent).toContain('Сервер подтвердил доступ к устройствам текущего аккаунта.')
    // Previously reauthenticate() was an online no-op but the UI
    // incorrectly called it independent server verification.
    expect(mock.reauth).not.toHaveBeenCalled()
  })
  it('does not show server-verified success after an unauthorized or unreachable device request',async()=>{
    mock.api.mockResolvedValueOnce({devices:[]})
    mock.api.mockRejectedValueOnce(Error('HTTP 401'))
    activeSession.value=session(A,true)
    mount();await settle()
    const verify=Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(x=>x.textContent?.trim()==='Проверить сессию')!
    verify.click();await settle()
    expect(mock.api).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('Сервер не подтвердил текущую сессию')
    expect(host.textContent).not.toContain('Сервер подтвердил доступ')
  })
  it('rejects malformed server device responses rather than faking a session ACK',async()=>{
    mock.api.mockResolvedValueOnce({devices:[]})
    mock.api.mockResolvedValueOnce({devices:'not-an-array'})
    activeSession.value=session(A,true)
    mount();await settle()
    const verify=Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(x=>x.textContent?.trim()==='Проверить сессию')!
    verify.click();await settle()
    expect(host.textContent).toContain('Сервер не подтвердил текущую сессию')
    expect(host.textContent).not.toContain('Сервер подтвердил доступ')
  })
  it('does not validate a new owner from an old owner pending authenticated request',async()=>{
    mock.api.mockResolvedValueOnce({devices:[]})
    const previous=deferred<{devices:unknown[]}>()
    mock.api.mockReturnValueOnce(previous.promise)
    activeSession.value=session(A,true)
    mount();await settle()
    const verify=Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(x=>x.textContent?.trim()==='Проверить сессию')!
    verify.click();await settle()
    activeSession.value=session(B,false)
    await settle()
    previous.resolve({devices:[{
      id:'33333333-3333-4333-8333-333333333333',
      created_at:'2026-11-16',revoked_at:null,
    }]})
    await settle()
    expect(host.textContent).not.toContain('Сервер подтвердил доступ')
    expect(host.querySelectorAll('[data-testid="account-device"]')).toHaveLength(0)
  })
  it('disables online-only session confirmation as soon as the browser is offline',async()=>{
    mock.api.mockResolvedValue({devices:[]})
    activeSession.value=session(A,true)
    mount();await settle()
    const verify=Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(x=>x.textContent?.trim()==='Проверить сессию')!
    const reload=Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(x=>x.textContent?.trim()==='Обновить устройства')!
    expect(verify.disabled).toBe(false)
    window.dispatchEvent(new Event('offline'))
    await settle()
    expect(verify.disabled).toBe(true)
    expect(reload.disabled).toBe(true)
    verify.click()
    await settle()
    expect(mock.api).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(verify.disabled).toBe(false)
    expect(mock.api).toHaveBeenCalledTimes(2)
  })

  it('invalidates an in-flight request on a real browser offline event without a session ref change',async()=>{
    const request=deferred<{devices:unknown[]}>()
    mock.api.mockReturnValueOnce(request.promise)
    activeSession.value=session(A,true)
    mount();await settle()
    expect(hasLoading()).toBe(true)
    window.dispatchEvent(new Event('offline'))
    await settle()
    expect(hasLoading()).toBe(false)
    expect(host.querySelectorAll('[data-testid="account-device"]')).toHaveLength(0)
    request.resolve({devices:[{id:'STALE_OFFLINE_DEVICE',created_at:'2026-01-01',revoked_at:null}]})
    await settle()
    expect(host.textContent).not.toContain('STALE_OFFLINE_DEVICE')
  })
  it('retries device loading when network returns but does not trust old offline responses',async()=>{
    const first=deferred<{devices:unknown[]}>()
    mock.api.mockReturnValueOnce(first.promise)
    mock.api.mockResolvedValueOnce({devices:[{
      id:'33333333-3333-4333-8333-333333333333',
      created_at:'2026-11-16',revoked_at:null,
    }]})
    activeSession.value=session(A,true)
    mount();await settle()
    window.dispatchEvent(new Event('offline'))
    await settle()
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(mock.api).toHaveBeenCalledTimes(2)
    expect(host.querySelectorAll('[data-testid="account-device"]')).toHaveLength(1)
    first.resolve({devices:[{id:'STALE_AFTER_RECONNECT',created_at:'2026-01-01',revoked_at:null}]})
    await settle()
    expect(host.textContent).not.toContain('STALE_AFTER_RECONNECT')
  })
  it('removes network event handlers when the Security screen is unmounted',async()=>{
    mock.api.mockResolvedValue({devices:[]})
    activeSession.value=session(A,true)
    mount();await settle()
    expect(mock.api).toHaveBeenCalledTimes(1)
    app?.unmount();app=undefined
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(mock.api).toHaveBeenCalledTimes(1)
  })
  it('does not keep a server spinner when an online session becomes offline mid-request',async()=>{
    const old=deferred<{devices:unknown[]}>()
    mock.api.mockReturnValueOnce(old.promise)
    activeSession.value=session(A,true)
    mount();await settle()
    expect(hasLoading()).toBe(true)
    activeSession.value=session(A,false)
    await settle()
    expect(hasLoading()).toBe(false)
    expect(host.querySelectorAll('[data-testid="account-device"]')).toHaveLength(0)
    old.resolve({devices:[{id:'OLD_ACCOUNT_DEVICE',created_at:'2026-01-01',revoked_at:null}]})
    await settle()
    expect(host.textContent).not.toContain('OLD_ACCOUNT_DEVICE')
    expect(hasLoading()).toBe(false)
  })
  it('does not leak old account devices after switching owner during a pending request',async()=>{
    const pending=deferred<{devices:unknown[]}>()
    mock.api.mockReturnValueOnce(pending.promise)
    activeSession.value=session(A,true)
    mount();await settle()
    expect(hasLoading()).toBe(true)
    activeSession.value=session(B,false)
    await settle()
    expect(hasLoading()).toBe(false)
    pending.resolve({devices:[{id:'A_SECRET_DEVICE',created_at:'2026-01-01',revoked_at:null}]})
    await settle()
    expect(host.textContent).not.toContain('A_SECRET_DEVICE')
    expect(host.querySelectorAll('[data-testid="account-device"]')).toHaveLength(0)
  })
  it('renders real authenticated devices on the next online session without stale errors',async()=>{
    const old=deferred<never>()
    mock.api.mockReturnValueOnce(old.promise)
    mock.api.mockResolvedValueOnce({devices:[{
      id:'33333333-3333-4333-8333-333333333333',
      created_at:'2026-11-16',revoked_at:null,
    }]})
    activeSession.value=session(A,true)
    mount();await settle()
    activeSession.value=session(A,false);await settle()
    activeSession.value=session(A,true);await settle()
    expect(host.querySelectorAll('[data-testid="account-device"]')).toHaveLength(1)
    expect(host.textContent).toContain('Это устройство')
    expect(hasLoading()).toBe(false)
    old.reject(Error('late failure'))
    await settle()
    expect(host.querySelectorAll('[data-testid="account-device"]')).toHaveLength(1)
    expect(host.textContent).not.toContain('late failure')
  })
})


it('clears unsubmitted PIN and Recovery Key inputs when the authenticated account changes',async()=>{
  mock.api.mockResolvedValue({devices:[]})
  activeSession.value={...session(A,true),device:{}} as Session
  mount();await settle()
  host.querySelector<HTMLButtonElement>('[data-testid="security-pin-create"]')!.click();await settle()
  for(const [id,value] of [['security-pin-new','4826'],['security-pin-repeat','4826'],['security-pin-recovery','PRIVATE-RECOVERY-INPUT']]){
    const field=host.querySelector<HTMLInputElement|HTMLTextAreaElement>('[data-testid="'+id+'"]')!
    field.value=value!;field.dispatchEvent(new Event('input',{bubbles:true}))
  }
  activeSession.value={...session(B,true),device:{}} as Session;await settle()
  expect(host.querySelector('[data-testid="security-pin-dialog"]')).toBeNull()
  host.querySelector<HTMLButtonElement>('[data-testid="security-pin-create"]')!.click();await settle()
  expect(host.querySelector<HTMLInputElement>('[data-testid="security-pin-new"]')!.value).toBe('')
  expect(host.querySelector<HTMLTextAreaElement>('[data-testid="security-pin-recovery"]')!.value).toBe('')
})
