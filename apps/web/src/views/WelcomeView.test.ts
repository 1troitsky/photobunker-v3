// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,nextTick,type App} from 'vue'
import {activeSession,sessionBootstrapPending} from '../features/identity/application/session'
vi.mock('vue-router',()=>({
  useRoute:()=>({path:'/welcome'}),
  useRouter:()=>({replace:vi.fn()}),
  onBeforeRouteLeave:vi.fn(),
  onBeforeRouteUpdate:vi.fn(),
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
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function mountWelcome():void{
  app=createApp(WelcomeView)
  app.component('RouterLink',{props:['to'],template:'<a><slot /></a>'})
  app.mount(host)
}
function currentSlide():number{
  return Array.from(host.querySelectorAll('.carousel-dot'))
    .findIndex(dot=>dot.classList.contains('active'))
}
function touch(type:string,x:number):Event{
  const e=new Event(type,{bubbles:true})
  Object.defineProperty(e,'changedTouches',{value:[{clientX:x}]})
  return e
}
describe('Welcome 1.4 carousel: real user timings and motion preferences',()=>{
  it('restarts the complete 5.5s countdown after selecting a dot',async()=>{
    vi.useFakeTimers()
    mountWelcome();await settle()
    expect(currentSlide()).toBe(0)
    vi.advanceTimersByTime(5000);await settle()
    const dots=host.querySelectorAll<HTMLButtonElement>('.carousel-dot')
    dots[3]!.click();await settle()
    expect(currentSlide()).toBe(3)
    vi.advanceTimersByTime(5499);await settle()
    expect(currentSlide()).toBe(3)
    vi.advanceTimersByTime(1);await settle()
    expect(currentSlide()).toBe(4)
  })
  it('resets on swipe and suspends auto-advance during hover',async()=>{
    vi.useFakeTimers()
    mountWelcome();await settle()
    const carousel=host.querySelector<HTMLElement>('.carousel')!
    vi.advanceTimersByTime(5000)
    carousel.dispatchEvent(touch('touchstart',280))
    carousel.dispatchEvent(touch('touchend',100))
    await settle()
    expect(currentSlide()).toBe(1)
    vi.advanceTimersByTime(5499);await settle()
    expect(currentSlide()).toBe(1)
    carousel.dispatchEvent(new Event('mouseenter'))
    vi.advanceTimersByTime(10000);await settle()
    expect(currentSlide()).toBe(1)
    carousel.dispatchEvent(new Event('mouseleave'))
    vi.advanceTimersByTime(5500);await settle()
    expect(currentSlide()).toBe(2)
  })
  it('does not autoplay with reduced motion, and resumes only after preference change',async()=>{
    vi.useFakeTimers()
    const listeners=new Set<()=>void>()
    const preference={
      matches:true,
      addEventListener:(_type:string,fn:()=>void)=>{listeners.add(fn)},
      removeEventListener:(_type:string,fn:()=>void)=>{listeners.delete(fn)},
    }
    vi.stubGlobal('matchMedia',vi.fn(()=>preference))
    mountWelcome();await settle()
    vi.advanceTimersByTime(16500);await settle()
    expect(currentSlide()).toBe(0)
    preference.matches=false
    for(const notify of listeners)notify()
    vi.advanceTimersByTime(5499);await settle()
    expect(currentSlide()).toBe(0)
    vi.advanceTimersByTime(1);await settle()
    expect(currentSlide()).toBe(1)
  })
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
