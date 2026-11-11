import {describe,it,expect,vi} from 'vitest'
import type {AssignmentMediaSubmission} from './assignment-outbox'
import {inspectMediaSubmissionReceipt,verifyMediaSubmissionReceipt,verifyMediaSubmissionReceiptPage} from './verify-media-submission'
import {pinnedPeer} from '../../sharing/key-directory'

vi.mock('../../sharing/key-directory',()=>({
  pinnedPeer:vi.fn(async(id:string)=>({accountId:id,accountSpki:'independently-confirmed-key'})),
}))
vi.mock('../../identity/infrastructure/crypto',()=>({
  importSpki:vi.fn(async(value:string)=>value),
  verify:vi.fn(async(_key:unknown,_message:string,signature:string)=>
    signature==='valid'),
}))
const uuid=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
const assignmentId=uuid(1),ownerAccountId=uuid(2),contributorId=uuid(3)
function fixture(version:1|2|3|4=3):AssignmentMediaSubmission{
  const kind=version===3||version===4?'photo':'video'
  const mediaId=uuid(4),mediaGrantId=uuid(5),mediaContractHash='a'.repeat(64)
  const policyHash='b'.repeat(64)
  const policyRevision=version===3||version===4?1:2
  const capture={
    version:1,assignmentId,ownerAccountId,contributorAccountId:contributorId,
    policyRevision,policyHash,mediaId,mediaContractHash,
    mediaType:kind,startedAt:1800000000000,finishedAt:1800000001000,
  }
  const c={
    version,submissionId:uuid(6),operationId:uuid(7),
    assignmentId,contributorAccountId:contributorId,
    mediaId,mediaGrantId,mediaContractHash,
    policyRevision,policyHash,kind,
    ...(version===2||version===4
      ?{captureContract:JSON.stringify(capture),captureSignature:'valid'}:{}),
  }
  return {
    submissionId:c.submissionId,mediaId,mediaGrantId,
    contributorAccountId:contributorId,mediaType:kind,
    capturedInAssignment:version===2||version===4,
    mediaContractHash,contract:JSON.stringify(c),signature:'valid',
  }
}
describe('P2 V-17 independently pinned owner receipt verification',()=>{
  it('accepts exactly bound signed v3 photo consent, not a camera attestation',async()=>{
    const e=fixture(3)
    expect(inspectMediaSubmissionReceipt(e,assignmentId,ownerAccountId))
      .toEqual({version:3})
    await expect(verifyMediaSubmissionReceipt(e,assignmentId,ownerAccountId))
      .resolves.toBeUndefined()
  })
  it('keeps legacy video receipt and separately signed capture claim distinct',async()=>{
    expect(inspectMediaSubmissionReceipt(fixture(1),assignmentId,ownerAccountId))
      .toEqual({version:1})
    const e=fixture(2)
    expect(inspectMediaSubmissionReceipt(e,assignmentId,ownerAccountId).version)
      .toBe(2)
    await expect(verifyMediaSubmissionReceipt(e,assignmentId,ownerAccountId))
      .resolves.toBeUndefined()
    const contract=JSON.parse(e.contract) as Record<string,unknown>
    contract.captureSignature='forged'
    await expect(verifyMediaSubmissionReceipt(
      {...e,contract:JSON.stringify(contract)},assignmentId,ownerAccountId,
    )).rejects.toThrow('assignment.receipt_unverified')
  })
  it('v4 photo requires BOTH contributor signatures and the exact captured photo scope',async()=>{
    const e=fixture(4)
    const parsed=inspectMediaSubmissionReceipt(e,assignmentId,ownerAccountId)
    expect(parsed.version).toBe(4)
    expect(parsed.captureContract).toContain('"mediaType":"photo"')
    await expect(verifyMediaSubmissionReceipt(e,assignmentId,ownerAccountId))
      .resolves.toBeUndefined()
    const contract=JSON.parse(e.contract) as Record<string,unknown>
    const claim=JSON.parse(contract.captureContract as string) as Record<string,unknown>
    for(const forged of [
      {...contract,captureSignature:'forged'},
      {...contract,captureContract:JSON.stringify({...claim,mediaType:'video'})},
      {...contract,captureContract:JSON.stringify({...claim,assignmentId:uuid(100)})},
      {...contract,captureContract:JSON.stringify({...claim,mediaId:uuid(101)})},
      {...contract,captureContract:JSON.stringify({...claim,policyRevision:2})},
      {...contract,captureContract:JSON.stringify({...claim,extraGPS:'not-authenticated'})},
      {...contract,captureContract:JSON.stringify({...claim,finishedAt:claim.startedAt})},
      {...contract,captureContract:JSON.stringify({...claim,
        finishedAt:Number(claim.startedAt)+190000})},
      {...contract,version:3},
    ]){
      await expect(verifyMediaSubmissionReceipt(
        {...e,contract:JSON.stringify(forged)},assignmentId,ownerAccountId,
      )).rejects.toThrow('assignment.receipt_unverified')
    }
    await expect(verifyMediaSubmissionReceipt(
      {...e,signature:'forged'},assignmentId,ownerAccountId,
    )).rejects.toThrow('assignment.receipt_unverified')
  })
  it('rejects forged scope, uncanonical fields and mismatched signed claims',()=>{
    const e=fixture()
    const c=JSON.parse(e.contract) as Record<string,unknown>
    for(const invalid of [
      {...e,mediaGrantId:uuid(22)},
      {...e,mediaType:'video' as const},
      {...e,mediaContractHash:'f'.repeat(64)},
      {...e,capturedInAssignment:true},
      {...e,contract:JSON.stringify({...c,downloadOriginal:true})},
      {...e,contract:JSON.stringify({...c,kind:'video'})},
      {...e,contract:JSON.stringify({...c,assignmentId:uuid(55)})},
      {...e,contract:'{broken'},
    ]){
      expect(()=>inspectMediaSubmissionReceipt(
        invalid,assignmentId,ownerAccountId,
      )).toThrow('assignment.receipt_unverified')
    }
  })
  it('does not promote a server row when the contributor pin or signature fails',async()=>{
    const e=fixture()
    vi.mocked(pinnedPeer).mockRejectedValueOnce(new Error('share.peer_not_confirmed'))
    await expect(verifyMediaSubmissionReceipt(e,assignmentId,ownerAccountId))
      .rejects.toThrow('share.peer_not_confirmed')
    await expect(verifyMediaSubmissionReceipt(
      {...e,signature:'forged'},assignmentId,ownerAccountId,
    )).rejects.toThrow('assignment.receipt_unverified')
  })
  it('keeps independent peer pin checks bounded per contributor per page',async()=>{
    const first=fixture(3)
    const second=fixture(3)
    const secondContract=JSON.parse(second.contract) as Record<string,unknown>
    secondContract.submissionId=uuid(60)
    secondContract.operationId=uuid(61)
    const additional={...second,submissionId:uuid(60),contract:JSON.stringify(secondContract)}
    vi.mocked(pinnedPeer).mockClear()
    const results=await verifyMediaSubmissionReceiptPage(
      [first,additional],assignmentId,ownerAccountId,
    )
    expect(results).toEqual({
      [first.submissionId]:true,[additional.submissionId]:true,
    })
    expect(vi.mocked(pinnedPeer)).toHaveBeenCalledTimes(1)
    const bad={...additional,signature:'forged'}
    vi.mocked(pinnedPeer).mockClear()
    const mixed=await verifyMediaSubmissionReceiptPage(
      [first,bad],assignmentId,ownerAccountId,
    )
    expect(mixed[first.submissionId]).toBe(true)
    expect(mixed[bad.submissionId]).toBe(false)
    expect(vi.mocked(pinnedPeer)).toHaveBeenCalledTimes(1)
  })
})
