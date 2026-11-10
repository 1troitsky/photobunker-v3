import 'fake-indexeddb/auto'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {pinnedPeer,ensureOwnExchangeKey} from '../../sharing/key-directory'
import {freshPackage,random,b64,unb64,hex,digest,importSigner,sign,exchangeKey,exportECDHPublic} from '../../identity/infrastructure/crypto'
import {openAnyJoinedTeam} from './team-epochs'
import {assertVerifiedTeamEpochNotOlder,listCachedJoinedTeams} from './team-invitations'
import type {TeamInvitation} from './team-invitations'
import {openJoinedEpochInvite} from './team-epoch-invitations'
import type {EpochTeamInvite} from './team-epoch-invitations'

vi.mock('../../identity/infrastructure/api',()=>({jsonApi:vi.fn()}))
vi.mock('../../sharing/key-directory',()=>({pinnedPeer:vi.fn(),ensureOwnExchangeKey:vi.fn()}))
const enc=new TextEncoder()
const hash=async(s:string)=>hex(await digest(enc.encode(s)))
let invite:TeamInvitation,teamId:string,ownerId:string,recipientId:string
let epoch:number,revision:number,roleEvent:{contract:string;signature:string}|null
let ownerSigner:CryptoKey
let epochInvite:EpochTeamInvite
async function signed(domain:string,value:unknown){
  const contract=JSON.stringify(value)
  return {contract,signature:await sign(ownerSigner,domain+'\n'+contract)}
}
async function encrypted(raw:Uint8Array<ArrayBuffer>,aad:string,plain:Uint8Array<ArrayBuffer>){
  const iv=random(12),key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt'])
  return {iv:b64(iv),ciphertext:b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},key,plain))}
}
async function changeRole(toRevision:number,inviteId=invite.inviteId){
  roleEvent=await signed('pb3.team-membership.v1',{
    version:1,operationId:crypto.randomUUID(),teamId,ownerAccountId:ownerId,
    inviteId,targetAccountId:recipientId,action:'change_role',
    previousRole:'viewer',nextRole:'contributor',fromRevision:toRevision-1,toRevision,
  })
  revision=toRevision
}
beforeEach(async()=>{
  teamId=crypto.randomUUID();ownerId=crypto.randomUUID();recipientId=crypto.randomUUID()
  const owner=(await freshPackage(ownerId)).pkg,recipient=(await freshPackage(recipientId)).pkg
  activeSession.value={accountId:recipientId,deviceId:crypto.randomUUID(),pkg:recipient,online:true} as Session
  Object.defineProperty(navigator,'onLine',{configurable:true,value:true})
  ownerSigner=await importSigner(owner.accountPkcs8)
  const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
  const ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
  const recipientKeyDigest='a'.repeat(64)
  const directory={accountId:recipientId,descriptorHash:recipientKeyDigest}
  vi.mocked(pinnedPeer).mockResolvedValue({accountId:ownerId,accountSpki:owner.accountSpki} as Awaited<ReturnType<typeof pinnedPeer>>)
  vi.mocked(ensureOwnExchangeKey).mockResolvedValue({privateKey:pair.privateKey,directory} as Awaited<ReturnType<typeof ensureOwnExchangeKey>>)
  const raw=random(32),nextRaw=random(32),profile=enc.encode(JSON.stringify({name:'PRIVATE TEAM',description:'PRIVATE DESCRIPTION'}))
  const envelope={version:1,...await encrypted(raw,'pb3.team-profile.v1\n'+ownerId+'\n'+teamId,profile),
    wrappedKey:await encrypted(unb64(owner.akek,32),'pb3.team-owner-key.v1\n'+ownerId+'\n'+teamId,raw)}
  const root=await signed('pb3.team-create.v1',{version:1,teamId,operationId:crypto.randomUUID(),ownerAccountId:ownerId,privateEnvelope:envelope})
  const rootHash=await hash(root.contract)
  const inviteId=crypto.randomUUID(),expiresAt=Date.now()+86400000
  const info='pb3.team-recipient-dek.v1\n'+JSON.stringify({version:1,teamId,inviteId,
    ownerAccountId:ownerId,recipientAccountId:recipientId,role:'viewer',fileAccess:'none',recipientKeyDigest,teamContractHash:rootHash,expiresAt})
  async function wrap(raw:Uint8Array<ArrayBuffer>,info:string){
    const salt=random(16),iv=random(12),key=await exchangeKey(ephemeral.privateKey,await exportECDHPublic(pair.publicKey),info,salt)
    return {ephemeralSpki:await exportECDHPublic(ephemeral.publicKey),salt:b64(salt),iv:b64(iv),
      ciphertext:b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(info)},key,raw))}
  }
  const invitation=await signed('pb3.team-invite.v1',{version:1,inviteId,operationId:crypto.randomUUID(),teamId,ownerAccountId:ownerId,teamContractHash:rootHash,
    recipientAccountId:recipientId,role:'viewer',fileAccess:'none',recipientKeyDigest,expiresAt,envelope:await wrap(raw,info)})
  invite={inviteId,teamId,ownerAccountId:ownerId,ownerAccountSpki:owner.accountSpki,recipientAccountId:recipientId,
    role:'viewer',state:'accepted',expiresAt,expired:false,trustedOwner:true,...invitation,contractHash:await hash(invitation.contract)}
  const epochFrame={version:1,teamId,fromEpoch:1,toEpoch:2,ownerAccountId:ownerId,recipientAccountId:recipientId,
    role:'viewer',recipientKeyDigest,membershipRevision:3,previousEpochHash:rootHash}
  const grant={accountId:recipientId,role:'viewer',recipientKeyDigest,
    envelope:await wrap(nextRaw,'pb3.team-epoch-recipient-dek.v1\n'+JSON.stringify(epochFrame))}
  const nextEnvelope={version:1,...await encrypted(nextRaw,'pb3.team-profile-epoch.v1\n'+ownerId+'\n'+teamId+'\n2\n3\n'+rootHash,profile),
    wrappedKey:await encrypted(unb64(owner.akek,32),'pb3.team-owner-key-epoch.v1\n'+ownerId+'\n'+teamId+'\n2\n3',nextRaw)}
  const next=await signed('pb3.team-key-epoch.v1',{version:1,operationId:crypto.randomUUID(),teamId,ownerAccountId:ownerId,
    fromEpoch:1,toEpoch:2,membershipRevision:3,previousEpochHash:rootHash,privateEnvelope:nextEnvelope,recipients:[grant],retiredPendingInviteIds:[]})
  const nextHash=await hash(next.contract)
  const epochFields={version:2 as const,inviteId:crypto.randomUUID(),operationId:crypto.randomUUID(),teamId,
    ownerAccountId:ownerId,recipientAccountId:recipientId,role:'viewer' as const,fileAccess:'none' as const,
    recipientKeyDigest,rootContractHash:rootHash,keyEpoch:2,keyEpochHash:nextHash,membershipRevision:4,expiresAt}
  const epochCommand=await signed('pb3.team-invite.v2',{
    ...epochFields,envelope:await wrap(nextRaw,'pb3.team-invite-epoch-dek.v2\n'+JSON.stringify(epochFields)),
  })
  const epochHash=await hash(epochCommand.contract)
  epochInvite={version:2,inviteId:epochFields.inviteId,teamId,ownerAccountId:ownerId,ownerAccountSpki:owner.accountSpki,
    recipientAccountId:recipientId,role:'viewer',state:'accepted',expiresAt,expired:false,trustedOwner:true,
    keyEpoch:2,membershipRevision:4,...epochCommand,contractHash:epochHash}
  const consentContract=JSON.stringify({version:2,action:'accept',inviteId:epochInvite.inviteId,teamId,recipientAccountId:recipientId,
    operationId:crypto.randomUUID(),inviteHash:epochHash,keyEpoch:2,keyEpochHash:nextHash})
  const consentSignature=await sign(await importSigner(recipient.accountPkcs8),'pb3.team-accept.v2\n'+consentContract)
  epoch=1;revision=1;roleEvent=null
  vi.mocked(jsonApi).mockImplementation(async path=>{
    if(path.startsWith('/teams/v2/')&&path.endsWith('/member'))return {teamId,ownerAccountId:ownerId,ownerAccountSpki:owner.accountSpki,
      membershipRevision:revision,keyEpoch:2,keyEpochHash:nextHash,effectiveRole:roleEvent?'contributor':'viewer',latestRoleEvent:roleEvent,
      invite:{...epochCommand,contractHash:epochHash,acceptedContract:consentContract,acceptedSignature:consentSignature},
      epoch:{...next,contractHash:nextHash}} as never
    if(path.endsWith('/epoch/member'))return {teamId,keyEpoch:epoch,ownerAccountId:ownerId,membershipRevision:revision,rotationRequired:false,
      ...next,contractHash:nextHash,recipient:grant,effectiveRole:roleEvent?'contributor':'viewer',latestRoleEvent:roleEvent} as never
    if(path.endsWith('/epoch/history'))return {teamId,ownerAccountId:ownerId,membershipRevision:revision,keyEpoch:2,rotationRequired:false,
      root:{...root,contractHash:rootHash},items:[{keyEpoch:2,...next,contractHash:nextHash}],nextCursor:null} as never
    if(path.endsWith('/member'))return {teamId,ownerAccountId:ownerId,ownerAccountSpki:owner.accountSpki,...root,
      effectiveRole:roleEvent?'contributor':'viewer',latestRoleEvent:roleEvent,
      invite:{inviteId,...invitation,contractHash:invite.contractHash,role:'viewer'}} as never
    throw Error('unexpected request')
  })
})
afterEach(()=>{activeSession.value=null})
describe('signed member revisions versus live HTTP metadata',()=>{
  it('v2 preserves the later owner-signed invitation revision in the floor',async()=>{
    epoch=2;revision=4
    await openJoinedEpochInvite(epochInvite)
    await expect(assertVerifiedTeamEpochNotOlder(teamId,ownerId,{
      keyEpoch:2,contractHash:JSON.parse(epochInvite.contract).keyEpochHash,membershipRevision:3,
    })).rejects.toThrow('teams.verified_revision_rollback')
  })
  it('v2 rejects coherent HTTP metadata below its signed invitation revision',async()=>{
    epoch=2;revision=4;await openJoinedEpochInvite(epochInvite)
    revision=3
    await expect(openJoinedEpochInvite(epochInvite)).rejects.toThrow('teams.untrusted_epoch_chain')
    expect((await listCachedJoinedTeams())[0]?.name).toBe('PRIVATE TEAM')
  })
  it('v2 ignores unsigned inflation while preserving the invitation floor',async()=>{
    epoch=2;revision=1000000;await openJoinedEpochInvite(epochInvite)
    revision=4
    expect((await openJoinedEpochInvite(epochInvite)).role).toBe('viewer')
  })
  it('v2 advances from its own role receipt and refuses the old role view',async()=>{
    epoch=2;await changeRole(5,epochInvite.inviteId)
    expect((await openJoinedEpochInvite(epochInvite)).role).toBe('contributor')
    roleEvent=null;revision=4
    await expect(openJoinedEpochInvite(epochInvite)).rejects.toThrow('teams.verified_revision_rollback')
  })
  it('reopens epoch 1 repeatedly after a signed role change',async()=>{
    await changeRole(2)
    expect((await openAnyJoinedTeam(invite)).role).toBe('contributor')
    expect((await openAnyJoinedTeam(invite)).role).toBe('contributor')
  })
  it('still rejects an older signed role view at epoch 1',async()=>{
    await changeRole(2);await openAnyJoinedTeam(invite)
    roleEvent=null;revision=1
    await expect(openAnyJoinedTeam(invite)).rejects.toThrow('teams.verified_revision_rollback')
    expect((await listCachedJoinedTeams())[0]?.role).toBe('contributor')
  })
  it('does not persist an unsigned inflated revision as verified',async()=>{
    epoch=2;revision=1000000
    await openAnyJoinedTeam(invite)
    revision=3
    expect((await openAnyJoinedTeam(invite)).name).toBe('PRIVATE TEAM')
  })
  it('advances only from a signed role receipt and rejects its replay',async()=>{
    epoch=2;await changeRole(4)
    await openAnyJoinedTeam(invite)
    expect((await openAnyJoinedTeam(invite)).role).toBe('contributor')
    roleEvent=null;revision=3
    await expect(openAnyJoinedTeam(invite)).rejects.toThrow('teams.verified_revision_rollback')
  })
  it('rejects metadata below the signed epoch revision',async()=>{
    epoch=2;revision=2
    await expect(openAnyJoinedTeam(invite)).rejects.toThrow('teams.invalid_epoch_history')
    expect(await listCachedJoinedTeams()).toEqual([])
  })
  it('rejects epoch-1 replay even when its role receipt is newer',async()=>{
    epoch=2;revision=3;await openAnyJoinedTeam(invite)
    epoch=1;await changeRole(4)
    await expect(openAnyJoinedTeam(invite)).rejects.toThrow('teams.verified_epoch_rollback')
    await expect(assertVerifiedTeamEpochNotOlder(teamId,ownerId,{keyEpoch:1,contractHash:invite.contractHash}))
      .rejects.toThrow('teams.verified_epoch_rollback')
  })
})
