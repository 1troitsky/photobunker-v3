// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,nextTick,shallowRef,type App} from 'vue'
const mock=vi.hoisted(()=>({
  route:{path:'/welcome/create'},
  routerReplace:vi.fn(),
  pending:vi.fn(),begin:vi.fn(),finish:vi.fn(),restore:vi.fn(),
}))
vi.mock('vue-router',()=>({
  useRoute:()=>mock.route,
  useRouter:()=>({replace:mock.routerReplace}),
  onBeforeRouteLeave:vi.fn(),
}))
vi.mock('../features/identity/application/session',()=>({
  activeSession:shallowRef(null),
  sessionBootstrapPending:shallowRef(false),
  beginRegistration:mock.begin,finishRegistration:mock.finish,
  restoreAccount:mock.restore,
}))
vi.mock('../features/identity/infrastructure/storage',()=>({
  getPending:mock.pending,
}))
import {activeSession} from '../features/identity/application/session'
import WelcomeView from './WelcomeView.vue'
let host:HTMLElement,app:App|undefined
async function settle():Promise<void>{
  for(let i=0;i<14;i++){await Promise.resolve();await nextTick()}
}
beforeEach(()=>{
  host=document.createElement('div');document.body.append(host)
  activeSession.value=null
  mock.route.path='/welcome/create'
  mock.pending.mockReset().mockResolvedValue(undefined)
  mock.begin.mockReset().mockResolvedValue('TEST_GENERATED_KEY')
  mock.finish.mockReset().mockResolvedValue(undefined)
  mock.restore.mockReset().mockResolvedValue(undefined)
  mock.routerReplace.mockReset().mockResolvedValue(undefined)
})
afterEach(()=>{
  app?.unmount();app=undefined
  host.remove();activeSession.value=null
})
function mount():void{
  app=createApp(WelcomeView)
  app.component('RouterLink',{props:['to'],template:'<a><slot /></a>'})
  app.mount(host)
}
function createButton():HTMLButtonElement{
  const button=Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find(x=>x.textContent?.trim()==='Создать Recovery Key')
  if(!button)throw Error('create button not found')
  return button
}
describe('Welcome 1.4 interrupted key-only registration',()=>{
  it('prevents a second key if the local device has a pending registration',async()=>{
    mock.pending.mockResolvedValue({operationId:'PENDING'})
    mount();await settle()
    expect(createButton().disabled).toBe(true)
    expect(host.querySelector('[data-testid="welcome-pending-registration"]'))
      .not.toBeNull()
    createButton().click()
    expect(mock.begin).not.toHaveBeenCalled()
  })
  it('finishes only with the original manually supplied saved Recovery Key',async()=>{
    mock.pending.mockResolvedValue({operationId:'PENDING'})
    mount();await settle()
    const input=host.querySelector<HTMLTextAreaElement>('[data-testid="welcome-pending-key"]')!
    input.value='ORIGINAL_SAVED_KEY'
    input.dispatchEvent(new Event('input',{bubbles:true}))
    await settle()
    host.querySelector<HTMLButtonElement>('[data-testid="welcome-resume-registration"]')!.click()
    await settle()
    expect(mock.finish).toHaveBeenCalledWith('ORIGINAL_SAVED_KEY')
    expect(host.querySelector('[data-testid="welcome-pending-registration"]')).toBeNull()
    expect(mock.routerReplace).toHaveBeenCalledOnce()
  })
  it('does not clear pending registration when supplied key fails',async()=>{
    mock.pending.mockResolvedValue({operationId:'PENDING'})
    mock.finish.mockRejectedValue(Error('identity.pending_key_mismatch'))
    mount();await settle()
    const input=host.querySelector<HTMLTextAreaElement>('[data-testid="welcome-pending-key"]')!
    input.value='WRONG_KEY'
    input.dispatchEvent(new Event('input',{bubbles:true}))
    await settle()
    host.querySelector<HTMLButtonElement>('[data-testid="welcome-resume-registration"]')!.click()
    await settle()
    expect(host.querySelector('[data-testid="welcome-pending-registration"]')).not.toBeNull()
    expect(host.textContent).toContain('identity.pending_key_mismatch')
    expect(mock.routerReplace).not.toHaveBeenCalled()
  })
  it('permits ordinary key generation when no pending reservation exists',async()=>{
    mount();await settle()
    expect(createButton().disabled).toBe(false)
    createButton().click();await settle()
    expect(mock.begin).toHaveBeenCalledOnce()
    expect(host.querySelector<HTMLTextAreaElement>('[data-testid="welcome-generated-key"]')?.value)
      .toBe('TEST_GENERATED_KEY')
  })
})
