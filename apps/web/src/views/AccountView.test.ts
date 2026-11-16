// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,h,nextTick,shallowRef,type App} from 'vue'
const mock=vi.hoisted(()=>({
  getPending:vi.fn(),begin:vi.fn(),finish:vi.fn(),restore:vi.fn(),
  logout:vi.fn(),reauth:vi.fn(),
  guard:null as null|(()=>boolean),
}))
vi.mock('vue-router',()=>({
  useRouter:()=>({replace:vi.fn()}),
  onBeforeRouteLeave:(guard:()=>boolean)=>{mock.guard=guard},
}))
vi.mock('../features/identity/infrastructure/storage',()=>({
  getPending:mock.getPending,
}))
vi.mock('../features/identity/application/session',()=>({
  activeSession:shallowRef(null),
  beginRegistration:mock.begin,finishRegistration:mock.finish,
  restoreAccount:mock.restore,logout:mock.logout,reauthenticate:mock.reauth,
}))
vi.mock('../ui/fieldwork/SettingsHub.vue',()=>({default:{render:()=>null}}))
vi.mock('../features/billing/ui/GraceStatusPanel.vue',()=>({default:{render:()=>null}}))
import {activeSession} from '../features/identity/application/session'
import AccountView from './AccountView.vue'
let app:App|undefined,host:HTMLElement
async function settle():Promise<void>{
  for(let i=0;i<15;i++){await Promise.resolve();await nextTick()}
}
function hasPending():boolean{
  return host.querySelector('[data-testid="account-pending-registration"]')!==null
}
function hardExitPrevented():boolean{
  const event=new Event('beforeunload',{cancelable:true})
  window.dispatchEvent(event)
  return event.defaultPrevented
}
beforeEach(()=>{
  mock.guard=null
  mock.getPending.mockReset().mockResolvedValue(undefined)
  mock.begin.mockReset().mockResolvedValue('TEST_RECOVERY_KEY')
  mock.finish.mockReset().mockResolvedValue(undefined)
  mock.restore.mockReset().mockResolvedValue(undefined)
  mock.logout.mockReset().mockResolvedValue(undefined)
  mock.reauth.mockReset().mockResolvedValue(undefined)
  activeSession.value=null
  host=document.createElement('div')
  document.body.append(host)
})
afterEach(()=>{
  app?.unmount();app=undefined
  host.remove()
  activeSession.value=null
  vi.restoreAllMocks()
})
function mount():void{
  app=createApp(AccountView)
  app.component('RouterLink',{props:['to'],render:()=>h('a')})
  app.mount(host)
}
describe('Settings anonymous Recovery Key continuity',()=>{
  it('does not offer a replacement key when a pending identity reservation exists',async()=>{
    mock.getPending.mockResolvedValue({operationId:'PENDING'})
    mount();await settle()
    expect(hasPending()).toBe(true)
    const button=Array.from(host.querySelectorAll('button'))
      .find(b=>b.textContent?.includes('Создать ключ'))!
    expect(button.disabled).toBe(true)
    button.click()
    expect(mock.begin).not.toHaveBeenCalled()
  })
  it('resumes only with the user-supplied saved key and keeps it volatile',async()=>{
    mock.getPending.mockResolvedValue({operationId:'PENDING'})
    mount();await settle()
    const input=host.querySelector<HTMLTextAreaElement>('#pending-registration-key')!
    input.value='SAVED_KEY'
    input.dispatchEvent(new Event('input',{bubbles:true}))
    await settle()
    host.querySelector<HTMLButtonElement>('[data-testid="account-resume-registration"]')!.click()
    await settle()
    expect(mock.finish).toHaveBeenCalledWith('SAVED_KEY')
    expect(hasPending()).toBe(false)
    expect(host.querySelector('#pending-registration-key')).toBeNull()
  })
  it('does not drop pending data or claim success if a supplied key is incorrect',async()=>{
    mock.getPending.mockResolvedValue({operationId:'PENDING'})
    mock.finish.mockRejectedValue(Error('identity.pending_key_mismatch'))
    mount();await settle()
    const input=host.querySelector<HTMLTextAreaElement>('#pending-registration-key')!
    input.value='WRONG_KEY'
    input.dispatchEvent(new Event('input',{bubbles:true}))
    await settle()
    host.querySelector<HTMLButtonElement>('[data-testid="account-resume-registration"]')!.click()
    await settle()
    expect(hasPending()).toBe(true)
    expect(input.value).toBe('WRONG_KEY')
    expect(host.textContent).toContain('identity.pending_key_mismatch')
  })
  it('guards in-progress generated keys on SPA exit and browser reload',async()=>{
    mount();await settle()
    const button=Array.from(host.querySelectorAll('button'))
      .find(b=>b.textContent?.includes('Создать ключ'))!
    button.click();await settle()
    expect(hasPending()).toBe(false)
    expect(host.querySelector<HTMLTextAreaElement>('#generated-key')?.value)
      .toBe('TEST_RECOVERY_KEY')
    expect(hardExitPrevented()).toBe(true)
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
    expect(mock.guard?.()).toBe(false)
    expect(confirm).toHaveBeenCalledOnce()
    confirm.mockReturnValue(true)
    expect(mock.guard?.()).toBe(true)
    app?.unmount();app=undefined
    expect(hardExitPrevented()).toBe(false)
  })
})
