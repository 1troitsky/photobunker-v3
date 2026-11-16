// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,nextTick,type App} from 'vue'
import {activeSession,type Session} from '../features/identity/application/session'
import type {ConfirmedContact} from '../features/people/application/contact-book'

const mocks=vi.hoisted(()=>({
  contacts:vi.fn(),drafts:vi.fn(),blocked:vi.fn(),get:vi.fn(),save:vi.fn(),
  routeGuard:null as null|(()=>Promise<boolean>),
}))
vi.mock('vue-router',()=>({
  useRoute:()=>({query:{}}),
  onBeforeRouteLeave:(guard:()=>Promise<boolean>)=>{mocks.routeGuard=guard},
}))
vi.mock('../features/people/application/contact-book',()=>({
  listConfirmedContacts:mocks.contacts,
}))
vi.mock('../features/people/application/contact-blocklist',()=>({
  listLocallyBlockedPeers:mocks.blocked,
  excludeLocallyBlockedContacts:(contacts:ConfirmedContact[])=>contacts,
}))
vi.mock('../features/messages/application/message-drafts',()=>({
  listMessageDrafts:mocks.drafts,
  getMessageDraft:mocks.get,
  saveMessageDraft:mocks.save,
  MAX_MESSAGE_DRAFT_LENGTH:4096,
}))
import MessagesView from './MessagesView.vue'

const PEER='22222222-2222-4222-8222-222222222222'
const contact:ConfirmedContact={
  version:1,peerAccountId:PEER,safetyFingerprint:'a'.repeat(64),
  alias:'Confirmed peer',createdAt:1,updatedAt:1,
}
let app:App|undefined
let host:HTMLDivElement
let shell:HTMLDivElement
function session():Session{
  return {accountId:'11111111-1111-4111-8111-111111111111',
    deviceId:'33333333-3333-4333-8333-333333333333',
    pkg:{akek:'mock-key',accountSpki:'spki',revision:1},online:false} as unknown as Session
}
async function settle():Promise<void>{
  for(let i=0;i<12;i++){await Promise.resolve();await nextTick()}
}
// Vue Transition keeps a closing Teleport in the DOM until its CSS leave
// animation finishes. Only active, non-leaving dialogs can receive input.
function thread():HTMLElement|null{
  return document.querySelector('[data-testid="messages-thread"]:not(.messages-overlay-leave-active)')
}
function editor():HTMLTextAreaElement{
  const input=thread()?.querySelector<HTMLTextAreaElement>('[data-testid="messages-editor"]')
  if(!input)throw Error('message editor absent')
  return input
}
async function mountAndOpen():Promise<void>{
  app=createApp(MessagesView)
  app.mount(host)
  await settle()
  const compose=host.querySelector<HTMLButtonElement>('[data-testid="messages-compose"]')
  if(!compose)throw Error('compose absent')
  compose.click()
  await settle()
  const peer=host.querySelector<HTMLButtonElement>('[data-testid="messages-picker-'+PEER+'"]')
  if(!peer)throw Error('confirmed contact absent')
  peer.focus()
  peer.click()
  await settle()
  expect(thread()).not.toBeNull()
}
function write(value:string):void{
  editor().value=value
  editor().dispatchEvent(new Event('input',{bubbles:true}))
}
function closeThread():void{
  const button=thread()?.querySelector<HTMLButtonElement>('[data-testid="messages-close"]')
  if(!button)throw Error('close absent')
  button.click()
}
beforeEach(()=>{
  shell=document.createElement('div')
  shell.className='shell'
  host=document.createElement('div')
  shell.append(host)
  document.body.append(shell)
  activeSession.value=session()
  mocks.routeGuard=null
  mocks.contacts.mockReset().mockResolvedValue([contact])
  mocks.drafts.mockReset().mockResolvedValue([])
  mocks.blocked.mockReset().mockResolvedValue([])
  mocks.get.mockReset().mockResolvedValue('')
  mocks.save.mockReset().mockResolvedValue(undefined)
})
afterEach(()=>{
  app?.unmount();app=undefined
  shell.remove()
  activeSession.value=null
})
describe('Messages 1.1 local-first draft safety',()=>{
  it('allows ordinary router navigation with no open draft dialog',async()=>{
    app=createApp(MessagesView)
    app.mount(host)
    await settle()
    expect(mocks.routeGuard).not.toBeNull()
    expect(await mocks.routeGuard!()).toBe(true)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('blocks router navigation after encrypted draft persistence fails, then retries',async()=>{
    mocks.save.mockRejectedValueOnce(new Error('IndexedDB quota'))
    await mountAndOpen()
    write('PRIVATE_ROUTER_GUARD_DRAFT')
    expect(await mocks.routeGuard!()).toBe(false)
    await settle()
    expect(editor().value).toBe('PRIVATE_ROUTER_GUARD_DRAFT')
    expect(thread()).not.toBeNull()
    expect(shell.hasAttribute('inert')).toBe(true)
    expect(await mocks.routeGuard!()).toBe(true)
    await settle()
    expect(thread()).toBeNull()
    expect(shell.hasAttribute('inert')).toBe(false)
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save).toHaveBeenLastCalledWith(contact,'PRIVATE_ROUTER_GUARD_DRAFT')
  })

  it('makes only the fullscreen dialog interactive, then restores Shell access',async()=>{
    await mountAndOpen()
    expect(shell.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(editor())
    expect(thread()?.getAttribute('aria-modal')).toBe('true')
    closeThread()
    await settle()
    expect(shell.hasAttribute('inert')).toBe(false)
    expect(thread()).toBeNull()
    expect(document.activeElement).toBe(
      host.querySelector('[data-testid="messages-compose"]'))
  })
  it('restores the original Shell inert state after unmount while dialog is open',async()=>{
    await mountAndOpen()
    expect(shell.hasAttribute('inert')).toBe(true)
    app?.unmount()
    app=undefined
    await settle()
    expect(shell.hasAttribute('inert')).toBe(false)
  })

  it('does not undo an existing Shell inert lock on closing its modal',async()=>{
    shell.setAttribute('inert','')
    await mountAndOpen()
    closeThread()
    await settle()
    expect(shell.hasAttribute('inert')).toBe(true)
  })
  it('keeps unsaved text and the fullscreen editor when encrypted persistence fails',async()=>{
    mocks.save.mockRejectedValueOnce(new Error('IndexedDB quota'))
    await mountAndOpen()
    write('PRIVATE_UNSAVED_DRAFT')
    closeThread()
    await settle()
    expect(thread()).not.toBeNull()
    expect(editor().value).toBe('PRIVATE_UNSAVED_DRAFT')
    expect(thread()?.querySelector('[role="alert"]')?.textContent)
      .toContain('Не удалось сохранить зашифрованный черновик')
    expect(document.activeElement).toBe(editor())
    closeThread()
    await settle()
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save).toHaveBeenLastCalledWith(contact,'PRIVATE_UNSAVED_DRAFT')
    expect(thread()).toBeNull()
    expect(host.querySelector('[data-testid="messages-draft-'+PEER+'"]')?.textContent)
      .toContain('PRIVATE_UNSAVED_DRAFT')
  })
  it('does not close over an in-flight save when editor content changes',async()=>{
    let resolveWrite:(()=>void)|undefined
    mocks.save.mockImplementationOnce(()=>new Promise<void>(resolve=>{resolveWrite=resolve}))
    await mountAndOpen()
    write('old text')
    closeThread()
    await settle()
    expect(thread()?.querySelector<HTMLButtonElement>('[data-testid="messages-close"]')?.disabled)
      .toBe(true)
    // The close request must not silently discard a later draft edit.
    write('latest text')
    resolveWrite?.()
    await settle()
    expect(thread()).not.toBeNull()
    expect(editor().value).toBe('latest text')
    closeThread()
    await settle()
    expect(thread()).toBeNull()
    expect(mocks.save).toHaveBeenLastCalledWith(contact,'latest text')
  })
  it('does not issue duplicate close-time writes for repeated close clicks',async()=>{
    let resolveWrite:(()=>void)|undefined
    mocks.save.mockImplementationOnce(()=>new Promise<void>(resolve=>{resolveWrite=resolve}))
    await mountAndOpen()
    write('one durable draft')
    closeThread()
    closeThread()
    await settle()
    expect(mocks.save).toHaveBeenCalledTimes(1)
    resolveWrite?.()
    await settle()
    expect(thread()).toBeNull()
  })
})
