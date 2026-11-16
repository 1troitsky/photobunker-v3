// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,h,nextTick,ref,type App} from 'vue'
import {activeSession,type Session} from '../features/identity/application/session'
import type {TeamView} from '../features/people/application/team-book'

const mocks=vi.hoisted(()=>({
  cached:vi.fn(),syncMembers:vi.fn(),syncInvites:vi.fn(),
  invites:vi.fn(),epochInvites:vi.fn(),ownerEpoch:vi.fn(),
  roster:vi.fn(),epochRoster:vi.fn(),history:vi.fn(),syncRotation:vi.fn(),
}))
vi.mock('../features/people/application/team-invitations',()=>({
  listCachedJoinedTeams:mocks.cached,
  listIncomingTeamInvites:mocks.invites,
  listOwnerTeamRoster:mocks.roster,
  syncTeamMemberOperations:mocks.syncMembers,
  verifiedTeamMembershipHistory:mocks.history,
}))
vi.mock('../features/people/application/team-epoch-invitations',()=>({
  listEpochInvites:mocks.epochInvites,
  listOwnerEpochRoster:mocks.epochRoster,
  syncEpochInvitationOperations:mocks.syncInvites,
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
    ownedTeams:teams.value,contacts:[],
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
})
afterEach(()=>{
  app?.unmount();app=undefined;host.remove()
  activeSession.value=null
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
