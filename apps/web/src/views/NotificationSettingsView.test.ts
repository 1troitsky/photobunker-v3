// @vitest-environment jsdom
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { createApp,nextTick,type App } from 'vue'
import { activeSession,type Session } from '../features/identity/application/session'
const mock=vi.hoisted(()=>({
  load:vi.fn(),save:vi.fn(),push:vi.fn(),
  defaults:{version:1 as const,invitations:true,deadlines:true,
    expiry:true,system:true,badges:true},
}))
const defaults=mock.defaults
vi.mock('vue-router',()=>({useRouter:()=>({push:mock.push})}))
vi.mock('../features/notifications/application/local-inbox',()=>({
  defaultNotificationPreferences:mock.defaults,
  readNotificationPreferences:mock.load,
  saveNotificationPreferences:mock.save,
}))
import NotificationSettingsView from './NotificationSettingsView.vue'
let app:App|undefined,host:HTMLElement
function session(accountId='11111111-1111-4111-8111-111111111111'):Session{
  return {accountId,deviceId:'22222222-2222-4222-8222-222222222222',
    pkg:{akek:'test-key',revision:1},online:false} as unknown as Session
}
async function settle():Promise<void>{
  for(let i=0;i<8;i++){await Promise.resolve();await nextTick()}
}
async function mount():Promise<void>{
  app=createApp(NotificationSettingsView);app.mount(host);await settle()
}
function el(id:string):HTMLInputElement{
  const item=host.querySelector<HTMLInputElement>('[data-testid="'+id+'"]')
  if(!item)throw Error('missing '+id)
  return item
}
beforeEach(()=>{
  host=document.createElement('div');document.body.appendChild(host)
  mock.load.mockReset().mockResolvedValue({...defaults})
  mock.save.mockReset().mockResolvedValue(undefined)
  mock.push.mockReset().mockResolvedValue(undefined)
  activeSession.value=session()
})
afterEach(()=>{app?.unmount();app=undefined;host.remove();activeSession.value=null})
describe('Encrypted device-local notification display settings',()=>{
  it('saves local categories, never exposes push or security opt out',async()=>{
    await mount()
    expect(el('notification-setting-push').disabled).toBe(true)
    expect(host.textContent).toContain('Всегда включены')
    expect(el('notification-settings-save').disabled).toBe(true)
    const toggle=el('notification-setting-invitations')
    toggle.checked=false
    toggle.dispatchEvent(new Event('change',{bubbles:true}))
    await settle()
    expect(el('notification-settings-save').disabled).toBe(false)
    el('notification-settings-save').click()
    await settle()
    expect(mock.save).toHaveBeenCalledWith({...defaults,invitations:false})
    expect(host.textContent).toContain('Сохранено в зашифрованном')
  })
  it('does not claim save on storage failure and retains a dirty draft',async()=>{
    mock.save.mockRejectedValueOnce(new Error('quota'))
    await mount()
    const toggle=el('notification-setting-expiry')
    toggle.checked=false;toggle.dispatchEvent(new Event('change',{bubbles:true}))
    await settle() // Vue must update the Save button's disabled state.
    el('notification-settings-save').click()
    await settle()
    expect(host.textContent).toContain('Не удалось сохранить')
    expect(el('notification-settings-save').disabled).toBe(false)
  })
  it('never applies encrypted preferences loaded for the previous account after switch',async()=>{
    let finish:((v:typeof defaults)=>void)|undefined
    mock.load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    await mount()
    activeSession.value=session('33333333-3333-4333-8333-333333333333')
    finish?.({...defaults,invitations:false})
    await settle()
    expect(el('notification-setting-invitations').checked).toBe(true)
    expect(mock.save).not.toHaveBeenCalled()
  })
})
