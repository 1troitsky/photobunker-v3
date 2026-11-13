// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { activeSession, type Session } from '../features/identity/application/session'

const mocks=vi.hoisted(()=>({
  rows:[] as Array<{id:string;kind:string;targetId:string|null;
    occurredAt:number;readAt:number|null;origin:'local';version:1}>,
  sync:vi.fn(),resolve:vi.fn(),push:vi.fn(),
  local:vi.fn(),mark:vi.fn(),markAll:vi.fn(),
  preferences:vi.fn(),
}))
vi.mock('vue-router',()=>({
  useRouter:()=>({push:mocks.push}),
  RouterLink:{template:'<a><slot /></a>'},
}))
vi.mock('../features/notifications/application/local-inbox',()=>({
  listLocalNotifications:mocks.local,
  defaultNotificationPreferences:{version:1,invitations:true,deadlines:true,expiry:true,system:true,badges:true},
  readNotificationPreferences:mocks.preferences,
  notificationIsVisible:(kind:string,prefs:{invitations:boolean;deadlines:boolean;expiry:boolean;system:boolean})=>
    kind==='security'||(kind==='team-invite'||kind==='assignment-invite'
      ?prefs.invitations:kind==='file-expiry'?prefs.expiry
        :kind==='assignment-deadline'?prefs.deadlines:prefs.system),
  markNotificationRead:mocks.mark,
  markAllLocalNotificationsRead:mocks.markAll,
  previewNotification:(row:{id:string;kind:string;occurredAt:number;readAt:number|null})=>({
    id:row.id,kind:row.kind,occurredAt:row.occurredAt,
    read:row.readAt!==null,title:row.kind==='team-invite'?'Приглашение в команду':'Новые материалы',
    description:'Проверить доступ.',
  }),
}))
vi.mock('../features/notifications/application/server-event-sync',()=>({
  syncServerNotifications:mocks.sync,
  resolveNotificationTarget:mocks.resolve,
}))
import NotificationsView from './NotificationsView.vue'

const ID='44444444-4444-4444-8444-444444444444'
const TARGET='55555555-5555-4555-8555-555555555555'
const moment=1_780_000_000_000
let app:App|undefined
let host:HTMLElement
function identity(online:boolean):Session{
  return {accountId:'11111111-1111-4111-8111-111111111111',
    deviceId:'22222222-2222-4222-8222-222222222222',
    pkg:{akek:'test-key',accountSpki:'test-spki',revision:1},
    online} as unknown as Session
}
async function settle():Promise<void>{
  for(let n=0;n<8;n++){await Promise.resolve();await nextTick()}
}
function el(testId:string):HTMLElement{
  const node=host.querySelector<HTMLElement>('[data-testid="'+testId+'"]')
  if(!node)throw Error('missing '+testId)
  return node
}
async function mount():Promise<void>{
  app=createApp(NotificationsView)
  app.mount(host)
  await settle()
}
beforeEach(()=>{
  host=document.createElement('div')
  document.body.appendChild(host)
  mocks.rows=[{id:ID,kind:'new-file',targetId:TARGET,occurredAt:moment,
    readAt:null,origin:'local',version:1}]
  mocks.local.mockReset().mockImplementation(async()=>mocks.rows.map(x=>({...x})))
  mocks.preferences.mockReset().mockResolvedValue({version:1,invitations:true,deadlines:true,expiry:true,system:true,badges:true})
  mocks.mark.mockReset().mockImplementation(async(id:string)=>{
    mocks.rows=mocks.rows.map(x=>x.id===id?{...x,readAt:moment+1}:x)
    return mocks.rows.find(x=>x.id===id)??null
  })
  mocks.markAll.mockReset().mockImplementation(async()=>{
    const unread=mocks.rows.filter(x=>x.readAt===null).length
    mocks.rows=mocks.rows.map(x=>({...x,readAt:moment+1}))
    return unread
  })
  mocks.sync.mockReset().mockResolvedValue({saved:0,pages:1})
  mocks.resolve.mockReset().mockResolvedValue({kind:'new-file',targetId:TARGET})
  mocks.push.mockReset().mockResolvedValue(undefined)
  activeSession.value=identity(false)
})
afterEach(()=>{
  app?.unmount();app=undefined
  host.remove()
  activeSession.value=null
})
describe('Notifications 1.5 encrypted inbox UI',()=>{
  it('renders cached rows offline, filters unread and persists local read before showing it read',async()=>{
    await mount()
    expect(el('notifications-list').textContent).toContain('Новые материалы')
    expect(mocks.sync).not.toHaveBeenCalled()
    el('notifications-unread').click()
    expect(el('notifications-list').textContent).toContain('Новые материалы')
    el('notification-'+ID).querySelector('button')!.click()
    await settle()
    expect(mocks.mark).toHaveBeenCalledWith(ID)
    expect(el('notifications-empty').textContent).toContain('Непрочитанных')
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
  })
  it('still renders encrypted security events when preference ciphertext is unreadable',async()=>{
    mocks.rows=[{...mocks.rows[0]!,kind:'security',targetId:null}]
    mocks.preferences.mockRejectedValueOnce(Error('notifications.encrypted_preferences_unreadable'))
    await mount()
    expect(el('notifications-list').textContent).toContain('Новые материалы')
    expect(host.textContent).toContain('Настройки отображения повреждены')
    expect(mocks.markAll).not.toHaveBeenCalled()
  })
  it('mark all passes only visible unread IDs, never hidden categories',async()=>{
    mocks.rows=[
      {...mocks.rows[0]!,id:ID},
      {...mocks.rows[0]!,id:'66666666-6666-4666-8666-666666666666',
        kind:'team-invite'},
    ]
    mocks.preferences.mockResolvedValueOnce({
      version:1,invitations:false,deadlines:true,expiry:true,system:true,badges:true,
    })
    await mount()
    el('notifications-mark-all').click()
    await settle()
    expect(mocks.markAll).toHaveBeenCalledWith(expect.any(Number),[ID])
  })
  it('marks all locally without falsely acknowledging a server read',async()=>{
    await mount()
    el('notifications-mark-all').click()
    await settle()
    expect(mocks.markAll).toHaveBeenCalledOnce()
    expect(el('notifications-mark-all').hasAttribute('disabled')).toBe(true)
    expect(mocks.sync).not.toHaveBeenCalled()
  })
  it('uses fresh server event ACL for file navigation and never the cached target',async()=>{
    activeSession.value=identity(true)
    await mount()
    el('notification-'+ID).querySelector('button')!.click()
    await settle()
    el('notification-open').click()
    await settle()
    expect(mocks.resolve).toHaveBeenCalledWith(ID)
    expect(mocks.push).toHaveBeenCalledWith('/browser/file/media/'+TARGET)
    expect(mocks.push).not.toHaveBeenCalledWith(expect.stringContaining('test-key'))
  })
  it('keeps a stale encrypted notification but never navigates after server revocation',async()=>{
    activeSession.value=identity(true)
    mocks.resolve.mockRejectedValueOnce(new Error('api.http_404'))
    await mount()
    el('notification-'+ID).querySelector('button')!.click()
    await settle()
    el('notification-open').click()
    await settle()
    expect(mocks.resolve).toHaveBeenCalledWith(ID)
    expect(mocks.push).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Доступ к событию больше не подтверждён')
    expect(host.textContent).not.toContain(TARGET)
    expect(el('notifications-list').textContent).toContain('Новые материалы')
  })
  it('prevents redirect if account changes during an in-flight target ACL check',async()=>{
    activeSession.value=identity(true)
    let done:((x:{kind:'new-file';targetId:string})=>void)|undefined
    mocks.resolve.mockImplementationOnce(()=>new Promise(resolve=>{done=resolve}))
    await mount()
    el('notification-'+ID).querySelector('button')!.click()
    await settle()
    el('notification-open').click()
    await settle()
    activeSession.value={...identity(true),
      accountId:'33333333-3333-4333-8333-333333333333'}
    done?.({kind:'new-file',targetId:TARGET})
    await settle()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain(TARGET)
  })
  it('does not lose new-account refresh while old sync is still in flight',async()=>{
    activeSession.value=identity(true)
    let finishOld:(()=>void)|undefined
    mocks.sync.mockImplementationOnce(()=>new Promise<void>(resolve=>{finishOld=resolve}))
    await mount()
    expect(mocks.sync).toHaveBeenCalledTimes(1)
    activeSession.value={...identity(true),
      accountId:'33333333-3333-4333-8333-333333333333'}
    await settle()
    expect(mocks.sync).toHaveBeenCalledTimes(1)
    mocks.sync.mockResolvedValueOnce({saved:0,pages:1})
    finishOld?.()
    await settle()
    expect(mocks.sync).toHaveBeenCalledTimes(2)
    expect(el('notifications-list').textContent).toContain('Новые материалы')
  })
  it('filters only display categories but always shows security and retains encrypted records',async()=>{
    mocks.rows=[
      {...mocks.rows[0]!,kind:'team-invite'},
      {...mocks.rows[0]!,id:'66666666-6666-4666-8666-666666666666',
        kind:'security',targetId:null},
    ]
    mocks.preferences.mockResolvedValueOnce({
      version:1,invitations:false,deadlines:false,expiry:false,system:false,badges:false,
    })
    await mount()
    expect(el('notifications-list').textContent).not.toContain('Приглашение в команду')
    expect(el('notifications-list').textContent).toContain('Новые материалы')
    expect(host.querySelectorAll('.notification-dot.isread')).toHaveLength(1)
    expect(mocks.rows).toHaveLength(2)
    expect(mocks.markAll).not.toHaveBeenCalled()
  })
  it('opens a real notification display settings route',async()=>{
    await mount()
    el('notifications-settings').click()
    await settle()
    expect(mocks.push).toHaveBeenCalledWith('/notifications/settings')
  })
  it('does not offer a target action for a generic expired retention notification',async()=>{
    mocks.rows=[{...mocks.rows[0]!,kind:'file-expiry',targetId:null}]
    activeSession.value=identity(true)
    await mount()
    el('notification-'+ID).querySelector('button')!.click()
    await settle()
    expect(host.querySelector('[data-testid="notification-open"]')).toBeNull()
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
})
