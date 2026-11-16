// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,h,nextTick,type App} from 'vue'
import {activeSession,type Session} from '../features/identity/application/session'
const mock=vi.hoisted(()=>({api:vi.fn(),reauth:vi.fn(),logout:vi.fn()}))
vi.mock('vue-router',()=>({
  useRoute:()=>({query:{}}),
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
