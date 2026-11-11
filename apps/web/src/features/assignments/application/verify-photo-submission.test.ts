import {beforeEach,describe,expect,it,vi} from 'vitest'
import {digest,freshPackage,hex,importSigner,sign} from '../../identity/infrastructure/crypto'
import {pinnedPeer} from '../../sharing/key-directory'
import type {SignedDirectory} from '../../sharing/key-directory'
import type {AssignmentPhotoSubmission} from './assignment-outbox'
import {inspectPhotoSubmissionReceipt,verifyPhotoSubmissionReceiptPage} from './verify-photo-submission'

vi.mock('../../sharing/key-directory',()=>({pinnedPeer:vi.fn()}))
const uuid=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
const assignmentId=uuid(1),contributorId=uuid(2)
const enc=new TextEncoder()

async function fixture(n:number):Promise<AssignmentPhotoSubmission>{
  const {pkg}=await freshPackage(contributorId)
  vi.mocked(pinnedPeer).mockResolvedValue({
    accountId:contributorId,accountSpki:pkg.accountSpki,
  } as SignedDirectory)
  const payload={
    version:1,submissionId:uuid(n),operationId:uuid(n+40),
    assignmentId,contributorAccountId:contributorId,
    photoId:uuid(n+100),photoGrantId:uuid(n+200),
    policyRevision:1,kind:'photo',
  }
  const contract=JSON.stringify(payload)
  return {
    submissionId:payload.submissionId,photoId:payload.photoId,
    photoGrantId:payload.photoGrantId,contributorAccountId:contributorId,
    contract,policyRevision:1,
    contractHash:hex(await digest(enc.encode(contract))),
    signature:await sign(await importSigner(pkg.accountPkcs8),
      'pb3.assignment-submit.v1\n'+contract),
  }
}
beforeEach(()=>vi.mocked(pinnedPeer).mockReset())

describe('P2 V-20 independent owner verification of P1 signed photo consent',()=>{
  it('accepts real signed SHA-256-bound consent using independently pinned key',async()=>{
    const entry=await fixture(3)
    expect(()=>inspectPhotoSubmissionReceipt(entry,assignmentId)).not.toThrow()
    const checked=await verifyPhotoSubmissionReceiptPage([entry],assignmentId)
    expect(checked[entry.submissionId]).toBe(true)
    expect(pinnedPeer).toHaveBeenCalledWith(contributorId)
  })
  it('marks forged signed scope, wrong hash and wrong policy revision unverified',async()=>{
    const valid=await fixture(8)
    const c=JSON.parse(valid.contract) as Record<string,unknown>
    const variants=[
      {...valid,photoGrantId:uuid(900)},
      {...valid,photoId:uuid(901)},
      {...valid,contributorAccountId:uuid(902)},
      {...valid,contractHash:'f'.repeat(64)},
      {...valid,signature:'forged'},
      {...valid,policyRevision:999},
      {...valid,contract:JSON.stringify({...c,privateGps:'secret'})},
      {...valid,contract:JSON.stringify({...c,kind:'video'})},
      {...valid,contract:JSON.stringify({...c,assignmentId:uuid(903)})},
      {...valid,contract:'{bad json'},
    ]
    for(const entry of variants){
      const res=await verifyPhotoSubmissionReceiptPage([entry],assignmentId)
      expect(res[entry.submissionId]).toBe(false)
    }
  })
  it('does not trust a server receipt without independently confirmed contributor key',async()=>{
    const entry=await fixture(9)
    vi.mocked(pinnedPeer).mockRejectedValueOnce(
      new Error('share.peer_not_confirmed'))
    const result=await verifyPhotoSubmissionReceiptPage([entry],assignmentId)
    expect(result[entry.submissionId]).toBe(false)
  })
  it('fetches only one contributor pin per page but checks each independent signature',async()=>{
    const first=await fixture(10)
    const peer=vi.mocked(pinnedPeer).getMockImplementation()
    const second=await fixture(11)
    // The two signed receipts have different contributor signing keys.
    // Recreate the second signature under the first key to exercise a valid
    // batch with one stable pinned identity.
    const same=await freshPackage(contributorId)
    const resign=async(entry:AssignmentPhotoSubmission)=>({
      ...entry,signature:await sign(await importSigner(same.pkg.accountPkcs8),
        'pb3.assignment-submit.v1\n'+entry.contract),
    })
    const batch=[await resign(first),await resign(second)]
    vi.mocked(pinnedPeer).mockResolvedValue({
      accountId:contributorId,accountSpki:same.pkg.accountSpki,
    } as SignedDirectory)
    vi.mocked(pinnedPeer).mockClear()
    const result=await verifyPhotoSubmissionReceiptPage(batch,assignmentId)
    expect(result[first.submissionId]).toBe(true)
    expect(result[second.submissionId]).toBe(true)
    expect(pinnedPeer).toHaveBeenCalledTimes(1)
    expect(peer).toBeDefined()
  })
})
