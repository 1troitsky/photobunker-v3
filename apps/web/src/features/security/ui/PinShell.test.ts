// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,nextTick,type App} from 'vue'

const session=vi.hoisted(()=>({
  unlockPinnedDevice:vi.fn(),
  restoreAccount:vi.fn(),
}))
// Actual Vue refs are essential here: SFC template auto-unwrapping must
// observe the same reactive state as the production Identity module.
vi.mock('../../identity/application/session',async()=>{
  const {shallowRef}=await import('vue')
  return {
    pendingPinUnlock:shallowRef(null),
    identityBootstrapError:shallowRef(null),
    unlockPinnedDevice:session.unlockPinnedDevice,
    restoreAccount:session.restoreAccount,
  }
})
import {
  pendingPinUnlock,identityBootstrapError,
} from '../../identity/application/session'
import PinShell from './PinShell.vue'

let app:App|undefined
let root:HTMLDivElement
async function settle(){
  for(let n=0;n<8;n++){await Promise.resolve();await nextTick()}
}
async function mount(){
  root=document.createElement('div')
  document.body.append(root)
  app=createApp(PinShell)
  app.mount(root)
  await settle()
}
function key(label:string):HTMLButtonElement{
  const button=[...root.querySelectorAll('button')].find(
    el=>el.getAttribute('aria-label')===label,
  ) as HTMLButtonElement|undefined
  if(!button)throw Error('Missing keypad button: '+label)
  return button
}
async function typeDigits(digits:string){
  for(const d of digits){
    key('Цифра '+d).click()
    await settle()
  }
}
beforeEach(()=>{
  vi.clearAllMocks()
  pendingPinUnlock.value={
    accountId:'00000000-0000-4000-8000-000000000001',
    deviceId:'00000000-0000-4000-8000-000000000002',
    packageRevision:1,sessionNonce:'00000000-0000-4000-8000-000000000003',
    pinLength:4,
  }
  identityBootstrapError.value=null
  session.unlockPinnedDevice.mockResolvedValue({status:'invalid',attemptsRemaining:4})
  session.restoreAccount.mockResolvedValue(undefined)
})
afterEach(()=>{
  app?.unmount()
  root?.remove()
  app=undefined
})

describe('P3 owner-accepted full-screen PIN Shell 1.1',()=>{
  it('renders compact 4-digit keypad, no plaintext input or header/dock',async()=>{
    await mount()
    expect(root.querySelector('h1')?.textContent).toBe('Введите PIN')
    expect(root.querySelectorAll('.pin-indicators span')).toHaveLength(4)
    expect(root.querySelector('.keypad')).not.toBeNull()
    expect(root.querySelector('.shell-header')).toBeNull()
    expect(root.querySelector('.shell-dock')).toBeNull()
    expect(root.querySelector('input[type=password]')).toBeNull()
    await typeDigits('482')
    expect(root.querySelectorAll('.pin-indicators .filled')).toHaveLength(3)
    expect(root.textContent).not.toContain('482')
    expect(session.unlockPinnedDevice).not.toHaveBeenCalled()
    key('Удалить последнюю цифру').click()
    await settle()
    expect(root.querySelectorAll('.pin-indicators .filled')).toHaveLength(2)
  })

  it('submits only at enrolled length, never persists typed digits in DOM',async()=>{
    await mount()
    await typeDigits('4826')
    expect(session.unlockPinnedDevice).toHaveBeenCalledOnce()
    expect(session.unlockPinnedDevice).toHaveBeenCalledWith('4826')
    expect(root.querySelectorAll('.pin-indicators .filled')).toHaveLength(0)
    expect(root.textContent).not.toContain('4826')
  })

  it('does not submit early for an enrolled eight-digit PIN',async()=>{
    pendingPinUnlock.value={...pendingPinUnlock.value!,pinLength:8}
    await mount()
    expect(root.querySelectorAll('.pin-indicators span')).toHaveLength(8)
    await typeDigits('1234567')
    expect(session.unlockPinnedDevice).not.toHaveBeenCalled()
    await typeDigits('8')
    expect(session.unlockPinnedDevice).toHaveBeenCalledWith('12345678')
    expect(root.querySelectorAll('.pin-indicators .filled')).toHaveLength(0)
  })

  it('clears partial PIN digits when background changes the admission nonce',async()=>{
    await mount()
    await typeDigits('482')
    expect(root.querySelectorAll('.pin-indicators .filled')).toHaveLength(3)
    pendingPinUnlock.value={
      ...pendingPinUnlock.value!,sessionNonce:'changed-after-browser-hidden',
    }
    await settle()
    expect(root.querySelectorAll('.pin-indicators .filled')).toHaveLength(0)
    expect(session.unlockPinnedDevice).not.toHaveBeenCalled()
    await typeDigits('4826')
    expect(session.unlockPinnedDevice).toHaveBeenCalledWith('4826')
  })

  it('does not show an obsolete PIN failure from an older background incarnation',async()=>{
    let rejectOld!:(reason:Error)=>void
    session.unlockPinnedDevice.mockImplementationOnce(
      ()=>new Promise((_resolve,reject)=>{rejectOld=reject}),
    )
    await mount()
    await typeDigits('4826')
    expect(session.unlockPinnedDevice).toHaveBeenCalledOnce()
    pendingPinUnlock.value={
      ...pendingPinUnlock.value!,sessionNonce:'another-incarnation',
    }
    rejectOld(new Error('identity.pin_session_changed'))
    await settle()
    expect(root.textContent).not.toContain('Проверка недоступна')
    expect(root.querySelectorAll('.pin-indicators .filled')).toHaveLength(0)
  })

  it('uses the SAME keypad for emergency PIN and never claims delete/wipe',async()=>{
    session.unlockPinnedDevice.mockResolvedValue({status:'emergency-intent'})
    await mount()
    await typeDigits('6284')
    expect(session.unlockPinnedDevice).toHaveBeenCalledWith('6284')
    expect(root.textContent).toContain('Доступ не предоставлен')
    expect(root.textContent).not.toMatch(/удалено|уничтожено/i)
    expect(session.restoreAccount).not.toHaveBeenCalled()
  })

  it('allows hardware digit input and Escape clearing without exposing PIN',async()=>{
    await mount()
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'4'}))
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'8'}))
    await settle()
    expect(root.querySelectorAll('.pin-indicators .filled')).toHaveLength(2)
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))
    await settle()
    expect(root.querySelectorAll('.pin-indicators .filled')).toHaveLength(0)
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'4'}))
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'8'}))
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'2'}))
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'6'}))
    await settle()
    expect(session.unlockPinnedDevice).toHaveBeenCalledWith('4826')
  })

  it('switches to Recovery Key after lost PIN, uses no secret persistence',async()=>{
    await mount()
    const toggle=[...root.querySelectorAll('button')].find(
      el=>el.textContent?.includes('Восстановить через Recovery Key'),
    ) as HTMLButtonElement
    toggle.click()
    await settle()
    expect(root.querySelector('.keypad')).toBeNull()
    const textarea=root.querySelector('textarea')!
    textarea.value='PB2.fake-recovery-test'
    textarea.dispatchEvent(new Event('input',{bubbles:true}))
    await settle()
    const button=[...root.querySelectorAll('button')].find(
      el=>el.textContent?.includes('Восстановить аккаунт'),
    ) as HTMLButtonElement
    button.click()
    await settle()
    expect(session.restoreAccount).toHaveBeenCalledWith('PB2.fake-recovery-test')
    expect(textarea.value).toBe('')
  })

  it('does not display the keypad when boot found corrupt or mixed Identity state',async()=>{
    identityBootstrapError.value='identity.mixed_sealed_devices'
    await mount()
    expect(root.querySelector('.keypad')).toBeNull()
    expect(root.textContent).toContain('Доступен только Recovery Key')
    expect(session.unlockPinnedDevice).not.toHaveBeenCalled()
  })
})
