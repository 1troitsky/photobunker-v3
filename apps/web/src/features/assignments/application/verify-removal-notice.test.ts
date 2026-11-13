import {beforeEach,describe,expect,it,vi} from 'vitest'
import {exportSpki,newSigning,sign} from '../../identity/infrastructure/crypto'
import {pinnedPeer} from '../../sharing/key-directory'
import type {SignedDirectory} from '../../sharing/key-directory'
import {
  inspectAssignmentRemovalNotices,verifyAssignmentRemovalNotice,
} from './verify-removal-notice'
import type {AssignmentRemovalNotice} from './verify-removal-notice'

vi.mock('../../sharing/key-directory',()=>({pinnedPeer:vi.fn()}))
const id=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
const assignmentId=id(1),ownerId=id(2),recipientId=id(3),inviteId=id(4)
async function fixture(){
  const pair=await newSigning(true)
  const spki=await exportSpki(pair.publicKey)
  const invite=JSON.stringify({
    version:1,inviteId,assignmentId,ownerAccountId:ownerId,
    recipientAccountId:recipientId,recipientKeyDigest:'a'.repeat(64),
    role:'contributor',expiresAt:1800000000000,
    envelope:{ephemeralSpki:spki,salt:'fixture',iv:'fixture',ciphertext:'fixture'},
  })
  const removal=JSON.stringify({
    version:1,action:'remove',operationId:id(5),assignmentId,
    inviteId,ownerAccountId:ownerId,recipientAccountId:recipientId,
  })
  const notice:AssignmentRemovalNotice={
    inviteId,assignmentId,ownerAccountId:ownerId,recipientAccountId:recipientId,
    ownerAccountSpki:spki,invitationContract:invite,
    invitationSignature:await sign(pair.privateKey,'pb3.assignment-invite.v1\n'+invite),
    removalContract:removal,
    removalSignature:await sign(pair.privateKey,'pb3.assignment-member-remove.v1\n'+removal),
  }
  const peer={accountId:ownerId,accountSpki:spki} as SignedDirectory
  return {notice,peer}
}

beforeEach(()=>vi.mocked(pinnedPeer).mockReset())
describe('P2 V-25: contributor independently verifies owner-signed removal',()=>{
  it('accepts real owner P-256 signatures on BOTH original invite and removal',async()=>{
    const {notice,peer}=await fixture()
    await expect(verifyAssignmentRemovalNotice(notice,recipientId,peer))
      .resolves.toBeUndefined()
    vi.mocked(pinnedPeer).mockResolvedValue(peer)
    const found=await inspectAssignmentRemovalNotices([notice],recipientId)
    expect(found).toEqual([{notice,verified:true}])
    expect(pinnedPeer).toHaveBeenCalledWith(ownerId)
  })
  it('refuses forged signature and any changed removal/invite identity or extra keys',async()=>{
    const {notice,peer}=await fixture()
    const removal=JSON.parse(notice.removalContract) as Record<string,unknown>
    const invitation=JSON.parse(notice.invitationContract) as Record<string,unknown>
    const changed:AssignmentRemovalNotice[]=[
      {...notice,removalSignature:notice.invitationSignature},
      {...notice,invitationSignature:notice.removalSignature},
      {...notice,recipientAccountId:id(15)},
      {...notice,ownerAccountSpki:'forged'},
      {...notice,inviteId:id(16)},
      {...notice,assignmentId:id(17)},
      {...notice,removalContract:JSON.stringify({...removal,recipientAccountId:id(18)})},
      {...notice,removalContract:JSON.stringify({...removal,inviteId:id(19)})},
      {...notice,removalContract:JSON.stringify({...removal,privateGPS:'forbidden'})},
      {...notice,removalContract:JSON.stringify({...removal,action:'accept'})},
      {...notice,invitationContract:JSON.stringify({...invitation,role:'owner'})},
      {...notice,invitationContract:JSON.stringify({...invitation,secret:'forbidden'})},
    ]
    for(const forged of changed){
      await expect(verifyAssignmentRemovalNotice(forged,recipientId,peer))
        .rejects.toThrow('assignment.removal_notice_unverified')
    }
  })
  it('never treats an unpinned server notice as proof of removal',async()=>{
    const {notice,peer}=await fixture()
    vi.mocked(pinnedPeer).mockRejectedValueOnce(
      new Error('share.peer_not_confirmed'))
    const result=await inspectAssignmentRemovalNotices([notice],recipientId)
    expect(result).toEqual([{notice,verified:false}])
    await expect(verifyAssignmentRemovalNotice(notice,recipientId,{
      ...peer,accountSpki:'different-key',
    })).rejects.toThrow('assignment.removal_notice_unverified')
  })
  it('deduplicates owner fingerprint lookup but verifies each notice separately',async()=>{
    const {notice,peer}=await fixture()
    vi.mocked(pinnedPeer).mockResolvedValue(peer)
    const second={...notice,inviteId:id(9)}
    const result=await inspectAssignmentRemovalNotices([notice,second],recipientId)
    expect(result.map(x=>x.verified)).toEqual([true,false])
    expect(pinnedPeer).toHaveBeenCalledTimes(1)
  })
})
