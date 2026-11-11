import {describe,expect,it} from 'vitest'
import {exportSpki,newSigning,sign} from '../../identity/infrastructure/crypto'
import {verifyAssignmentParticipantRoster} from './assignment-outbox'
import type {AssignmentParticipant} from './assignment-outbox'

const id=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
const assignmentId=id(1),ownerAccountId=id(2),recipientAccountId=id(3),inviteId=id(4)
async function signedRoster(state:'pending'|'accepted'|'removed'){
  const pair=await newSigning(true),ownerSpki=await exportSpki(pair.publicKey)
  const expiry=1800000000000
  const invitation=JSON.stringify({
    version:1,inviteId,assignmentId,ownerAccountId,
    recipientAccountId,recipientKeyDigest:'a'.repeat(64),
    role:'contributor',expiresAt:expiry,
    envelope:{ephemeralSpki:ownerSpki,salt:'fixture',iv:'fixture',ciphertext:'fixture'},
  })
  const removal=JSON.stringify({
    version:1,action:'remove',operationId:id(5),
    assignmentId,inviteId,ownerAccountId,recipientAccountId,
  })
  const item:AssignmentParticipant={
    inviteId,recipientAccountId,role:'contributor',state,
    expiresAt:expiry,expired:false,
    contract:invitation,signature:await sign(pair.privateKey,
      'pb3.assignment-invite.v1\n'+invitation),
    removalContract:state==='removed'?removal:null,
    removalSignature:state==='removed'?await sign(pair.privateKey,
      'pb3.assignment-member-remove.v1\n'+removal):null,
  }
  const page={items:[item],nextCursor:null,serverNowMs:expiry-10000}
  return {pair,ownerSpki,page,item,removal}
}

describe('V-24: independently authenticated member removal roster',()=>{
  it('verifies exact owner-signed revoked member evidence with original invite',async()=>{
    const {page,ownerSpki}=await signedRoster('removed')
    await expect(verifyAssignmentParticipantRoster(
      page,assignmentId,ownerAccountId,ownerSpki,
    )).resolves.toBeUndefined()
  })
  it('does not trust a server-only removed flag or an unrelated signature',async()=>{
    const {page,ownerSpki}=await signedRoster('removed')
    for(const wrong of [
      {...page.items[0]!,removalSignature:null},
      {...page.items[0]!,removalSignature:page.items[0]!.signature},
      {...page.items[0]!,removalContract:JSON.stringify({
        ...JSON.parse(page.items[0]!.removalContract!),recipientAccountId:id(100),
      })},
      {...page.items[0]!,removalContract:JSON.stringify({
        ...JSON.parse(page.items[0]!.removalContract!),extraSecret:'leak',
      })},
      {...page.items[0]!,removalContract:JSON.stringify({
        ...JSON.parse(page.items[0]!.removalContract!),inviteId:id(101),
      })},
    ]){
      await expect(verifyAssignmentParticipantRoster(
        {...page,items:[wrong]},assignmentId,ownerAccountId,ownerSpki,
      )).rejects.toThrow('assignment.roster_untrusted_removal')
    }
  })
  it('refuses forged removal evidence attached to still-accepted member',async()=>{
    const {page,ownerSpki}=await signedRoster('removed')
    await expect(verifyAssignmentParticipantRoster({
      ...page,items:[{...page.items[0]!,state:'accepted'}],
    },assignmentId,ownerAccountId,ownerSpki))
      .rejects.toThrow('assignment.roster_untrusted_removal')
    const {page:valid,ownerSpki:spki}=await signedRoster('accepted')
    await expect(verifyAssignmentParticipantRoster(
      valid,assignmentId,ownerAccountId,spki,
    )).resolves.toBeUndefined()
  })
})
