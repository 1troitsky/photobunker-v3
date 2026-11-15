// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,nextTick,type App} from 'vue'
import {activeSession,sessionBootstrapPending} from '../features/identity/application/session'
vi.mock('vue-router',()=>({
  useRoute:()=>({path:'/welcome'}),
  useRouter:()=>({replace:vi.fn()}),
  onBeforeRouteLeave:vi.fn(),
}))
import WelcomeView from './WelcomeView.vue'
let app:App|undefined,host:HTMLElement
async function settle(){await nextTick();await Promise.resolve();await nextTick()}
beforeEach(()=>{
  activeSession.value=null
  sessionBootstrapPending.value=true
  host=document.createElement('div')
  document.body.append(host)
})
afterEach(()=>{
  app?.unmount();app=undefined
  host.remove()
  sessionBootstrapPending.value=false
  activeSession.value=null
})
describe('owner-approved Welcome Loader 1.6',()=>{
  it('replaces BOTH auth links in one stable slot and keeps all six slides',async()=>{
    app=createApp(WelcomeView)
    app.component('RouterLink',{props:['to'],template:'<a><slot /></a>'})
    app.mount(host)
    await settle()
    expect(host.querySelector('[data-testid="welcome-bootstrap-loading"]')).not.toBeNull()
    expect(host.textContent).toContain('Входим в приложение...')
    expect(host.querySelectorAll('.welcome-link')).toHaveLength(0)
    expect(host.querySelectorAll('.carousel-dot')).toHaveLength(6)
    expect(host.querySelector('.welcome-auth-slot')).not.toBeNull()
    sessionBootstrapPending.value=false
    await settle()
    expect(host.querySelector('[data-testid="welcome-bootstrap-loading"]')).toBeNull()
    expect(host.querySelectorAll('.welcome-link')).toHaveLength(2)
    expect(host.querySelectorAll('.carousel-dot')).toHaveLength(6)
    sessionBootstrapPending.value=true
    await settle()
    expect(host.querySelectorAll('.welcome-link')).toHaveLength(0)
    expect(host.querySelectorAll('.welcome-bootstrap-loading')).toHaveLength(1)
  })
})
