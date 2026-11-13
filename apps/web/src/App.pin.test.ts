// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,nextTick,type App as VueApp} from 'vue'

const spies=vi.hoisted(()=>({
  unlockPinnedDevice:vi.fn(),
  restoreAccount:vi.fn(),
}))
vi.mock('./features/identity/application/session',async()=>{
  const {shallowRef}=await import('vue')
  return {
    identityBootstrapReady:shallowRef(false),
    identityBootstrapError:shallowRef(null),
    pendingPinUnlock:shallowRef(null),
    activeSession:shallowRef(null),
    unlockPinnedDevice:spies.unlockPinnedDevice,
    restoreAccount:spies.restoreAccount,
  }
})
vi.mock('vue-router',()=>({
  useRoute:()=>({path:'/browser',name:'browser'}),
  useRouter:()=>({push:vi.fn(),replace:vi.fn(),back:vi.fn()}),
}))
vi.mock('./features/browser/application/viewer-shell-actions',()=>({
  viewerShellActions:null,
}))
vi.mock('./ui/fieldwork/dock-preferences',()=>({
  displayedDock:{value:[]},
  dockDefinitions:{},
}))
import App from './App.vue'
import {
  identityBootstrapReady,identityBootstrapError,pendingPinUnlock,
} from './features/identity/application/session'

let app:VueApp|undefined
let root:HTMLDivElement
async function settle(){
  for(let i=0;i<6;i++){await Promise.resolve();await nextTick()}
}
beforeEach(()=>{
  vi.clearAllMocks()
  identityBootstrapReady.value=false
  identityBootstrapError.value=null
  pendingPinUnlock.value=null
  root=document.createElement('div')
  document.body.append(root)
  app=createApp(App)
  app.mount(root)
})
afterEach(()=>{
  app?.unmount()
  root?.remove()
})

describe('P3 #220 protected Identity application shell boundary',()=>{
  it('mounts NO RouterView, Header or Dock while identity bootstrap is unresolved',()=>{
    expect(root.querySelector('.pin-bootstrap')).not.toBeNull()
    expect(root.querySelector('.shell-header')).toBeNull()
    expect(root.querySelector('.shell-dock')).toBeNull()
    expect(root.querySelector('.shell-main')).toBeNull()
    expect(root.textContent).toContain('PhotoBunker')
  })

  it('renders a separate fullscreen keypad only AFTER sealed device discovery',async()=>{
    pendingPinUnlock.value={
      accountId:'00000000-0000-4000-8000-000000000001',
      deviceId:'00000000-0000-4000-8000-000000000002',
      packageRevision:1,
      pinLength:6,
      sessionNonce:'00000000-0000-4000-8000-000000000003',
    }
    identityBootstrapReady.value=true
    await settle()
    expect(root.querySelector('.pin-bootstrap')).toBeNull()
    expect(root.querySelector('.pin-screen')).not.toBeNull()
    expect(root.querySelectorAll('.pin-indicators span')).toHaveLength(6)
    expect(root.querySelector('.shell-header')).toBeNull()
    expect(root.querySelector('.shell-dock')).toBeNull()
    expect(root.querySelector('.shell-main')).toBeNull()
    expect(spies.unlockPinnedDevice).not.toHaveBeenCalled()
  })

  it('only offers Recovery Key if bootstrap found corrupt/mixed sealed devices',async()=>{
    identityBootstrapError.value='identity.mixed_sealed_devices'
    identityBootstrapReady.value=true
    await settle()
    expect(root.querySelector('.pin-screen')).not.toBeNull()
    expect(root.querySelector('.keypad')).toBeNull()
    expect(root.textContent).toContain('Доступен только Recovery Key')
    expect(root.querySelector('.shell-dock')).toBeNull()
    expect(root.querySelector('.shell-main')).toBeNull()
  })
})
