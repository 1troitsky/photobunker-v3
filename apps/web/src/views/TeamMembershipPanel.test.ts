// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,h,nextTick,ref,type App} from 'vue'
import {activeSession,type Session} from '../features/identity/application/session'
import type {TeamView} from '../features/people/application/team-book'
import type {ConfirmedContact} from '../features/people/application/contact-book'

const mocks=vi.hoisted(()=>({
  cached:vi.fn(),syncMembers:vi.fn(),syncInvites:vi.fn(),
  invites:vi.fn(),epochInvites:vi.fn(),ownerEpoch:vi.fn(),
  roster:vi.fn(),epochRoster:vi.fn(),history:vi.fn(),syncRotation:vi.fn(),
  change:vi.fn(),blocks:vi.fn(),queueInvite:vi.fn(),
}))
vi.mock('../features/people/application/team-invitations',()=>({
  listCachedJoinedTeams:mocks.cached,
  listIncomingTeamInvites:mocks.invites,
  listOwnerTeamRoster:mocks.roster,
  syncTeamMemberOperations:mocks.syncMembers,
  verifiedTeamMembershipHistory:mocks.history,
  queueTeamMembershipChange:mocks.change,
  queueTeamInvitation:mocks.queueInvite,
}))
vi.mock('../features/people/application/team-epoch-invitations',()=>({
  listEpochInvites:mocks.epochInvites,
  listOwnerEpochRoster:mocks.epochRoster,
  syncEpochInvitationOperations:mocks.syncInvites,
}))
vi.mock('../features/people/application/contact-blocklist',()=>({
  listLocallyBlockedPeers:mocks.blocks,
}))
vi.mock('../features/people/application/team-epochs',()=>({
  ownerEpochStatus:mocks.ownerEpoch,
  syncTeamKeyRotations:mocks.syncRotation,
}))
import TeamMembershipPanel from './TeamMembershipPanel.vue'

const ACCOUNT='11111111-1111-4111-8111-111111111111'
const TEAM_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TEAM_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PEER_A='11111111-aaaa-4111-8111-111111111111'
const PEER_B='22222222-bbbb-4222-8222-222222222222'
let app:App|undefined,host:HTMLDivElement
const teams=ref<TeamView[]>([])
const contacts=ref<ConfirmedContact[]>([])
function session(accountId=ACCOUNT):Session{
  return {
    accountId,deviceId:'22222222-2222-4222-8222-222222222222',
    pkg:{accountSpki:'spki-'+accountId,akek:'akek-'+accountId,revision:1},
    online:true,
  } as unknown as Session
}
function deferred<T>(){
  let resolve!:(value:T)=>void
  const promise=new Promise<T>(r=>{resolve=r})
  return {promise,resolve}
}
function member(id:string){
  return {inviteId:'invite-'+id,recipientAccountId:id,
    role:'contributor',state:'accepted'}
}
async function settle():Promise<void>{
  for(let i=0;i<18;i++){await Promise.resolve();await nextTick()}
}
async function mount():Promise<void>{
  app=createApp({render:()=>h(TeamMembershipPanel,{
    ownedTeams:teams.value,contacts:contacts.value,
  })})
  app.mount(host);await settle()
}
function choose(id:string):void{
  const input=host.querySelector<HTMLSelectElement>('#team-member-selector')
  if(!input)throw Error('missing team selector')
  input.value=id
  input.dispatchEvent(new Event('change',{bubbles:true}))
}
beforeEach(()=>{
  host=document.createElement('div');document.body.append(host)
  activeSession.value=session()
  teams.value=[
    {teamId:TEAM_A,name:'A',description:'',memberCount:1,delivery:'synced'},
    {teamId:TEAM_B,name:'B',description:'',memberCount:1,delivery:'synced'},
  ]
  contacts.value=[{
    version:1,peerAccountId:PEER_A,safetyFingerprint:'a'.repeat(64),
    alias:'Trusted participant',createdAt:0,updatedAt:0,
  }]
  mocks.cached.mockReset().mockResolvedValue([])
  mocks.syncMembers.mockReset().mockResolvedValue(undefined)
  mocks.syncInvites.mockReset().mockResolvedValue(undefined)
  mocks.invites.mockReset().mockResolvedValue({
    invites:[],superseded:[],suspendedTeamIds:[],revokedTeamIds:[],
  })
  mocks.epochInvites.mockReset().mockResolvedValue({
    invites:[],superseded:[],suspendedTeamIds:[],revokedTeamIds:[],
  })
  mocks.ownerEpoch.mockReset().mockResolvedValue({
    keyEpoch:1,membershipRevision:1,rotationRequired:false,
  })
  mocks.roster.mockReset().mockResolvedValue([])
  mocks.epochRoster.mockReset().mockResolvedValue([])
  mocks.history.mockReset().mockResolvedValue({
    revision:1,rotationRequired:false,
  })
  mocks.syncRotation.mockReset().mockResolvedValue(undefined)
  mocks.change.mockReset().mockResolvedValue(undefined)
  mocks.blocks.mockReset().mockResolvedValue([])
  mocks.queueInvite.mockReset().mockResolvedValue(undefined)
})
afterEach(()=>{
  app?.unmount();app=undefined;host.remove()
  activeSession.value=null
  vi.unstubAllGlobals()
})
describe('Approved Team member action sheet',()=>{
  it('shows the owner menu without offering an unsafe role or self-removal',async()=>{
    await mount()
    choose(TEAM_A);await settle()
    host.querySelector<HTMLButtonElement>(
      '[data-testid="team-owner-actions"]')!.click()
    await settle()
    const sheet=host.querySelector('[data-testid="team-member-sheet"]')!
    expect(sheet.getAttribute('aria-modal')).toBe('true')
    expect(sheet.querySelector<HTMLSelectElement>(
      '[data-testid="team-member-sheet-role"]')?.disabled).toBe(true)
    expect(sheet.textContent).toContain('Роль владельца')
    expect(sheet.querySelector('[data-testid="team-member-sheet-remove"]'))
      .toBeNull()
    expect(mocks.change).not.toHaveBeenCalled()
    sheet.querySelector<HTMLButtonElement>(
      '[data-testid="team-member-sheet-close"]')!.click()
    await settle()
    expect(host.querySelector('[data-testid="team-member-sheet"]')).toBeNull()
  })
  it('opens the contextual member sheet without changing signed membership',async()=>{
    mocks.roster.mockResolvedValue([member(PEER_A)])
    await mount()
    choose(TEAM_A);await settle()
    const row=host.querySelector('[data-testid="team-member-'+PEER_A+'"]')!
    expect(row.querySelector('[data-testid="team-member-sheet-role"]')).toBeNull()
    row.querySelector<HTMLButtonElement>(
      '[data-testid="team-member-actions"]')!.click()
    await settle()
    const sheet=host.querySelector('[data-testid="team-member-sheet"]')!
    expect(sheet.textContent).toContain(PEER_A)
    expect(sheet.querySelector<HTMLSelectElement>(
      '[data-testid="team-member-sheet-role"]')?.value)
      .toBe('contributor')
    expect(sheet.querySelector<HTMLButtonElement>(
      '[data-testid="team-member-sheet-apply"]')?.disabled).toBe(true)
    expect(mocks.change).not.toHaveBeenCalled()
    sheet.querySelector<HTMLButtonElement>(
      '[data-testid="team-member-sheet-close"]')!.click()
    await settle()
    expect(mocks.change).not.toHaveBeenCalled()
  })
})
describe('Signed Team mutation target isolation',()=>{
  it('never signs an invite for the Team selected during a delayed blocklist check',async()=>{
    const blocked=deferred<[]>()
    mocks.blocks.mockImplementationOnce(()=>blocked.promise)
    await mount()
    choose(TEAM_A);await settle()
    const add=Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(x=>x.textContent?.includes('Добавить участника'))!
    add.click();await settle()
    const peer=host.querySelector<HTMLSelectElement>('#team-invite-contact')!
    peer.value=PEER_A
    peer.dispatchEvent(new Event('change',{bubbles:true}))
    await settle()
    host.querySelector<HTMLButtonElement>(
      '[data-testid="team-invite-submit"]')!.click()
    await settle()
    choose(TEAM_B);await settle()
    blocked.resolve([])
    await settle()
    expect(mocks.queueInvite).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('Приглашение сохранено')
  })
  it('does not report another Team role change after a delayed signed write',async()=>{
    const pending=deferred<void>()
    mocks.change.mockImplementationOnce(()=>pending.promise)
    mocks.roster.mockImplementation(async(teamId:string)=>
      [member(teamId===TEAM_A?PEER_A:PEER_B)])
    vi.stubGlobal('confirm',vi.fn(()=>true))
    await mount()
    choose(TEAM_A);await settle()
    const row=host.querySelector('[data-testid="team-member-'+PEER_A+'"]')!
    row.querySelector<HTMLButtonElement>(
      '[data-testid="team-member-actions"]')!.click()
    await settle()
    const sheet=host.querySelector('[data-testid="team-member-sheet"]')!
    const role=sheet.querySelector<HTMLSelectElement>(
      '[data-testid="team-member-sheet-role"]')!
    role.value='curator'
    role.dispatchEvent(new Event('change',{bubbles:true}))
    await settle()
    sheet.querySelector<HTMLButtonElement>(
      '[data-testid="team-member-sheet-apply"]')!.click()
    await settle()
    expect(mocks.change).toHaveBeenCalledWith(
      TEAM_A,expect.objectContaining({recipientAccountId:PEER_A}),
      'change_role','curator',
    )
    choose(TEAM_B);await settle()
    pending.resolve(undefined)
    await settle()
    expect(mocks.change).toHaveBeenCalledTimes(1)
    expect(host.textContent).not.toContain('Роль изменена и подтверждена')
    expect(host.textContent).not.toContain('Изменение подписано и сохранено')
  })
})
describe('Verified Team roster / account isolation',()=>{
  it('rejects delayed previous-Team roster after switching Team and back',async()=>{
    const old=deferred<ReturnType<typeof member>[]>()
    mocks.roster.mockImplementationOnce(()=>old.promise)
      .mockImplementation(async(teamId:string)=>[
        member(teamId===TEAM_A?PEER_A:PEER_B),
      ])
    await mount()
    choose(TEAM_A);await settle()
    expect(mocks.roster).toHaveBeenCalledWith(TEAM_A)
    choose(TEAM_B);await settle()
    expect(host.querySelector('[data-testid="team-member-'+PEER_B+'"]'))
      .not.toBeNull()
    choose(TEAM_A);await settle()
    expect(host.querySelector('[data-testid="team-member-'+PEER_A+'"]'))
      .not.toBeNull()
    old.resolve([member(PEER_B)])
    await settle()
    expect(host.querySelector('[data-testid="team-member-'+PEER_A+'"]'))
      .not.toBeNull()
    expect(host.querySelector('[data-testid="team-member-'+PEER_B+'"]'))
      .toBeNull()
  })
  it('immediately removes a roster when the owned Team loses server confirmation',async()=>{
    mocks.roster.mockResolvedValue([member(PEER_A)])
    await mount()
    choose(TEAM_A);await settle()
    expect(host.querySelector('[data-testid="team-member-'+PEER_A+'"]'))
      .not.toBeNull()
    teams.value=[{...teams.value[0]!,delivery:'queued'},teams.value[1]!]
    await settle()
    expect(host.querySelector('[data-testid="team-member-'+PEER_A+'"]'))
      .toBeNull()
    expect(host.querySelector<HTMLSelectElement>('#team-member-selector')?.value)
      .toBe('')
    expect(host.textContent).not.toContain(PEER_A)
  })
  it('does not render a previous cryptographic account roster after recovery',async()=>{
    const pending=deferred<ReturnType<typeof member>[]>()
    mocks.roster.mockImplementationOnce(()=>pending.promise)
    await mount()
    choose(TEAM_A);await settle()
    activeSession.value=session('33333333-3333-4333-8333-333333333333')
    await settle()
    pending.resolve([member(PEER_A)])
    await settle()
    expect(host.querySelector('[data-testid="team-member-'+PEER_A+'"]'))
      .toBeNull()
    expect(host.querySelector<HTMLSelectElement>('#team-member-selector')?.value)
      .toBe('')
  })
})
