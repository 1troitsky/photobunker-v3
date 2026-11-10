import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { freshPackage, importSigner, sign } from '../../identity/infrastructure/crypto'
import { verifyAssignmentParticipantRoster } from './assignment-outbox'

const ownerId='11111111-1111-4111-8111-111111111111'
const recipientId='22222222-2222-4222-8222-222222222222'
const assignmentId='33333333-3333-4333-8333-333333333333'
const inviteId='44444444-4444-4444-8444-444444444444'

describe('P1-23 fail-closed signed invitation roster',()=>{
  async function fixture(){
    const {pkg}=await freshPackage(ownerId)
    const expiresAt=Date.now()+86_400_000
    const contract=JSON.stringify({
      version:1,inviteId,assignmentId,ownerAccountId:ownerId,
      recipientAccountId:recipientId,recipientKeyDigest:'f'.repeat(64),
      role:'contributor',expiresAt,
      envelope:{ephemeralSpki:'opaque',salt:'opaque',iv:'opaque',ciphertext:'opaque'},
    })
    const signature=await sign(await importSigner(pkg.accountPkcs8),
      'pb3.assignment-invite.v1\n'+contract)
    const item={
      inviteId,recipientAccountId:recipientId,role:'contributor' as const,
      state:'pending' as const,expiresAt,expired:false,contract,signature,
    }
    const page={items:[item],nextCursor:null,serverNowMs:Date.now()}
    return {pkg,item,page}
  }
  it('accepts owner signed identity/role and server-confirmed accepted status',async()=>{
    const {pkg,item,page}=await fixture()
    await expect(verifyAssignmentParticipantRoster(page,assignmentId,
      ownerId,pkg.accountSpki)).resolves.toBeUndefined()
    await expect(verifyAssignmentParticipantRoster({
      ...page,items:[{...item,state:'accepted',expired:false}],
    },assignmentId,ownerId,pkg.accountSpki)).resolves.toBeUndefined()
  })
  it('refuses recipient substitution, unsigned status corruption and false expiry',async()=>{
    const {pkg,item,page}=await fixture()
    for(const broken of [
      {...item,recipientAccountId:ownerId},
      {...item,role:'observer' as typeof item.role},
      {...item,expiresAt:item.expiresAt+1},
      {...item,signature:item.signature.slice(0,-4)+'AAAA'},
      {...item,expired:true},
      {...item,state:'forged' as typeof item.state},
    ]){
      await expect(verifyAssignmentParticipantRoster({...page,items:[broken]},
        assignmentId,ownerId,pkg.accountSpki)).rejects.toThrow()
    }
    await expect(verifyAssignmentParticipantRoster(page,inviteId,
      ownerId,pkg.accountSpki)).rejects.toThrow()
    await expect(verifyAssignmentParticipantRoster(page,assignmentId,
      recipientId,pkg.accountSpki)).rejects.toThrow()
  })
  it('rejects duplicated entries, pagination equivocation and over-limit response',async()=>{
    const {pkg,item,page}=await fixture()
    for(const altered of [
      {...page,items:[item,item]},
      {...page,nextCursor:inviteId},
      {...page,serverNowMs:-1},
      {...page,items:Array.from({length:51},()=>item)},
    ]){
      await expect(verifyAssignmentParticipantRoster(altered,assignmentId,
        ownerId,pkg.accountSpki)).rejects.toThrow()
    }
  })
})
