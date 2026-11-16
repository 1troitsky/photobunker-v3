// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,h,nextTick,type App} from 'vue'
import {activeSession,type Session} from '../features/identity/application/session'

const mock=vi.hoisted(()=>({
  inspect:vi.fn(),confirm:vi.fn(),
  contacts:vi.fn(),save:vi.fn(),remove:vi.fn(),
  blocks:vi.fn(),block:vi.fn(),unblock:vi.fn(),
  teams:vi.fn(),refreshTeams:vi.fn(),queueTeam:vi.fn(),
}))
vi.mock('../features/sharing/key-directory',()=>({
  inspectPeer:mock.inspect,confirmPeer:mock.confirm,
}))
vi.mock('../features/people/application/contact-book',()=>({
  listConfirmedContacts:mock.contacts,
  saveConfirmedContact:mock.save,
  removeConfirmedContact:mock.remove,
}))
vi.mock('../features/people/application/contact-blocklist',()=>({
  listLocallyBlockedPeers:mock.blocks,
  locallyBlockPeer:mock.block,
  locallyUnblockPeer:mock.unblock,
  excludeLocallyBlockedContacts:(contacts:unknown[])=>contacts,
}))
vi.mock('../features/people/application/team-book',()=>({
  listLocalTeams:mock.teams,
  refreshTeams:mock.refreshTeams,
  queueTeam:mock.queueTeam,
}))
vi.mock('./TeamMembershipPanel.vue',()=>({
  default:{render:()=>null},
}))
import ContactsTeamsView from './ContactsTeamsView.vue'

const A='11111111-1111-4111-8111-111111111111'
const B='33333333-3333-4333-8333-333333333333'
const PEER='55555555-5555-4555-8555-555555555555'
const TEAM='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SERVER_TEAM={
  teamId:TEAM,name:'Encrypted team',description:'Real local owner data',
  memberCount:2,delivery:'synced' as const,
}
let app:App|undefined,host:HTMLDivElement
function session(accountId=A):Session{
  return {accountId,deviceId:'22222222-2222-4222-8222-222222222222',
    pkg:{accountSpki:'spki-'+accountId,akek:'akek-'+accountId,revision:1},
    online:true} as unknown as Session
}
async function settle():Promise<void>{
  for(let i=0;i<14;i++){await Promise.resolve();await nextTick()}
}
function deferred<T>(){
  let resolve!:(value:T)=>void
  return {promise:new Promise<T>(r=>{resolve=r}),resolve:(v:T)=>resolve(v)}
}
async function mount():Promise<void>{
  app=createApp(ContactsTeamsView)
  app.component('RouterLink',{props:['to'],render:()=>h('a')})
  app.mount(host)
  await settle()
}
function input():HTMLInputElement{
  const item=host.querySelector<HTMLInputElement>('[data-testid="contacts-lookup-id"]')
  if(!item)throw Error('contact lookup missing')
  return item
}
function searchPeer():void{
  const item=input()
  item.value=PEER
  item.dispatchEvent(new Event('input',{bubbles:true}))
}
function click(text:string):void{
  const target=Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find(node=>node.textContent?.trim()===text)
  if(!target)throw Error('missing button: '+text)
  target.click()
}
beforeEach(()=>{
  host=document.createElement('div');document.body.append(host)
  mock.inspect.mockReset().mockResolvedValue({
    directory:{safetyFingerprint:'CURRENT-PIN'},confirmed:false,
  })
  mock.confirm.mockReset().mockResolvedValue(undefined)
  mock.contacts.mockReset().mockResolvedValue([])
  mock.save.mockReset().mockResolvedValue(undefined)
  mock.remove.mockReset().mockResolvedValue(undefined)
  mock.blocks.mockReset().mockResolvedValue([])
  mock.block.mockReset().mockResolvedValue(undefined)
  mock.unblock.mockReset().mockResolvedValue(undefined)
  mock.teams.mockReset().mockResolvedValue([])
  mock.refreshTeams.mockReset().mockResolvedValue([])
  mock.queueTeam.mockReset().mockResolvedValue(undefined)
  activeSession.value=session()
})
afterEach(()=>{
  app?.unmount();app=undefined;host.remove()
  activeSession.value=null
})
describe('Approved local-first Team navigation',()=>{
  it('keeps an encrypted Team row during same-account local refresh',async()=>{
    mock.teams.mockResolvedValue([SERVER_TEAM])
    mock.refreshTeams.mockResolvedValue([SERVER_TEAM])
    await mount()
    click('Команды (1)');await settle()
    expect(host.querySelector('[data-testid="team-row-'+TEAM+'"]')).not.toBeNull()
    const pending=deferred<typeof SERVER_TEAM[]>()
    mock.teams.mockImplementationOnce(()=>pending.promise)
    click('Обновить');await settle()
    expect(host.querySelector('[data-testid="team-row-'+TEAM+'"]')).not.toBeNull()
    pending.resolve([SERVER_TEAM]);await settle()
    expect(host.querySelector('[data-testid="team-row-'+TEAM+'"]')).not.toBeNull()
  })
  it('never grants queued Team access to remote-only settings',async()=>{
    const queued={...SERVER_TEAM,delivery:'queued' as const}
    mock.teams.mockResolvedValue([queued])
    mock.refreshTeams.mockResolvedValue([queued])
    await mount()
    click('Команды (1)');await settle()
    host.querySelector<HTMLButtonElement>(
      '[data-testid="team-actions-toggle-'+TEAM+'"]')!.click()
    await settle()
    const menu=host.querySelector('[data-testid="team-actions-menu"]')!
    expect(menu.querySelector('[data-testid="team-actions-open"]')).not.toBeNull()
    expect(menu.querySelector('[data-testid="team-actions-settings"]')).toBeNull()
    menu.querySelector<HTMLButtonElement>(
      '[data-testid="team-actions-open"]')!.click()
    await settle()
    expect(host.querySelector('[data-testid="team-profile"]')).not.toBeNull()
    expect(host.querySelector<HTMLButtonElement>(
      '[data-testid="team-profile-settings"]')?.disabled).toBe(true)
    expect(mock.queueTeam).not.toHaveBeenCalled()
  })
  it('opens verified Team settings from its contextual menu',async()=>{
    mock.teams.mockResolvedValue([SERVER_TEAM])
    mock.refreshTeams.mockResolvedValue([SERVER_TEAM])
    await mount()
    click('Команды (1)');await settle()
    host.querySelector<HTMLButtonElement>(
      '[data-testid="team-actions-toggle-'+TEAM+'"]')!.click()
    await settle()
    host.querySelector<HTMLButtonElement>(
      '[data-testid="team-actions-settings"]')!.click()
    await settle()
    expect(host.querySelector('[data-testid="team-profile"]')).not.toBeNull()
    expect(host.querySelector<HTMLButtonElement>(
      '[data-testid="team-profile-settings"]')?.getAttribute('aria-expanded'))
      .toBe('true')
    expect(host.querySelector('[data-testid="team-actions-menu"]')).toBeNull()
    expect(mock.queueTeam).not.toHaveBeenCalled()
  })
})
describe('Contacts crypto identity and asynchronous peer verification',()=>{
  it('discards delayed key-directory fingerprints from the previous account',async()=>{
    const pending=deferred<{directory:{safetyFingerprint:string};confirmed:boolean}>()
    mock.inspect.mockImplementationOnce(()=>pending.promise)
    await mount()
    searchPeer();await settle()
    click('Проверить ключ');await settle()
    expect(mock.inspect).toHaveBeenCalledWith(PEER)
    activeSession.value=session(B)
    await settle()
    pending.resolve({directory:{safetyFingerprint:'OLD-SECRET-PIN'},confirmed:false})
    await settle()
    expect(host.querySelector('[data-testid="contacts-fingerprint"]')).toBeNull()
    expect(host.textContent).not.toContain('OLD-SECRET-PIN')
    expect(input().value).toBe('')
  })
  it('does not show an old peer result after the same user edits search input',async()=>{
    const pending=deferred<{directory:{safetyFingerprint:string};confirmed:boolean}>()
    mock.inspect.mockImplementationOnce(()=>pending.promise)
    await mount()
    searchPeer();await settle()
    click('Проверить ключ');await settle()
    const item=input()
    item.value=A
    item.dispatchEvent(new Event('input',{bubbles:true}))
    await settle()
    pending.resolve({directory:{safetyFingerprint:'OLD-SEARCH-PIN'},confirmed:false})
    await settle()
    expect(host.querySelector('[data-testid="contacts-fingerprint"]')).toBeNull()
    expect(host.textContent).not.toContain('OLD-SEARCH-PIN')
  })
  it('never marks an old-account peer confirmed after delayed explicit approval',async()=>{
    await mount()
    searchPeer();await settle()
    click('Проверить ключ');await settle()
    expect(host.querySelector('[data-testid="contacts-fingerprint"]')).not.toBeNull()
    const ack=host.querySelector<HTMLInputElement>('[data-testid="contacts-fingerprint-ack"]')!
    ack.checked=true;ack.dispatchEvent(new Event('change',{bubbles:true}))
    await settle()
    const pending=deferred<void>()
    mock.confirm.mockImplementationOnce(()=>pending.promise)
    click('Подтвердить отпечаток');await settle()
    expect(mock.confirm).toHaveBeenCalledWith(PEER,'CURRENT-PIN')
    activeSession.value=session(B)
    await settle()
    pending.resolve(undefined)
    await settle()
    expect(host.querySelector('[data-testid="contacts-fingerprint"]')).toBeNull()
    expect(host.textContent).not.toContain('Ключ подтверждён на этом устройстве.')
  })
})
