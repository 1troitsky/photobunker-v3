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
