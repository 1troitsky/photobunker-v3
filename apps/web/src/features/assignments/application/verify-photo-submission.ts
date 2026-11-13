import {digest,hex,importSpki,verify} from '../../identity/infrastructure/crypto'
import {pinnedPeer} from '../../sharing/key-directory'
import type {SignedDirectory} from '../../sharing/key-directory'
import type {AssignmentPhotoSubmission} from './assignment-outbox'

const keys=[
  'version','submissionId','operationId','assignmentId',
  'contributorAccountId','photoId','photoGrantId','policyRevision','kind',
]
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const sha256=/^[0-9a-f]{64}$/
const encoder=new TextEncoder()

/**
 * P1 owner-side signed CONSENT proof, not a hardware/photo/GPS attestation.
 * Server-issued progress and a recipient grant are not themselves evidence
 * that this contributor signed THIS immutable photo for THIS assignment.
 */
export function inspectPhotoSubmissionReceipt(
  entry:AssignmentPhotoSubmission,assignmentId:string,
):void{
  if(!entry||typeof entry.contract!=='string'
    ||entry.contract.length<64||entry.contract.length>30000
    ||typeof entry.signature!=='string'
    ||typeof entry.contractHash!=='string'
    ||!sha256.test(entry.contractHash)
    ||!Number.isSafeInteger(entry.policyRevision)
    ||entry.policyRevision<1||entry.policyRevision>1000000)
    throw Error('assignment.photo_receipt_unverified')
  let candidate:unknown
  try{candidate=JSON.parse(entry.contract)}
  catch{throw Error('assignment.photo_receipt_unverified')}
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))
    throw Error('assignment.photo_receipt_unverified')
  const c=candidate as Record<string,unknown>
  if(Object.keys(c).sort().join('|')!==keys.slice().sort().join('|')
    ||JSON.stringify(c)!==entry.contract
    ||c.version!==1||c.kind!=='photo'
    ||c.assignmentId!==assignmentId
    ||c.submissionId!==entry.submissionId
    ||c.contributorAccountId!==entry.contributorAccountId
    ||c.photoId!==entry.photoId||c.photoGrantId!==entry.photoGrantId
    ||c.policyRevision!==entry.policyRevision
    ||!([c.submissionId,c.operationId,c.assignmentId,
      c.contributorAccountId,c.photoId,c.photoGrantId].every(
      v=>typeof v==='string'&&uuid.test(v))))
    throw Error('assignment.photo_receipt_unverified')
}

async function verifyOne(
  entry:AssignmentPhotoSubmission,assignmentId:string,
  peer:SignedDirectory,
):Promise<void>{
  inspectPhotoSubmissionReceipt(entry,assignmentId)
  if(peer.accountId!==entry.contributorAccountId)
    throw Error('assignment.photo_receipt_unverified')
  const actual=hex(await digest(encoder.encode(entry.contract)))
  if(actual!==entry.contractHash)
    throw Error('assignment.photo_receipt_unverified')
  const key=await importSpki(peer.accountSpki)
  if(!await verify(key,'pb3.assignment-submit.v1\n'+entry.contract,
    entry.signature))
    throw Error('assignment.photo_receipt_unverified')
}

/** Refresh independent peer pin once per contributor per page, verify every
 * signed receipt/hash separately. Any failure stays unverified, never hides
 * a server-authoritative receipt or changes its confirmed count.
 */
export async function verifyPhotoSubmissionReceiptPage(
  entries:AssignmentPhotoSubmission[],assignmentId:string,
):Promise<Record<string,boolean>>{
  const pins=new Map<string,Promise<SignedDirectory>>()
  const results=await Promise.all(entries.map(async entry=>{
    try{
      inspectPhotoSubmissionReceipt(entry,assignmentId)
      let pin=pins.get(entry.contributorAccountId)
      if(!pin){
        pin=pinnedPeer(entry.contributorAccountId)
        pins.set(entry.contributorAccountId,pin)
      }
      await verifyOne(entry,assignmentId,await pin)
      return [entry.submissionId,true] as const
    }catch{
      return [entry?.submissionId,false] as const
    }
  }))
  return Object.fromEntries(results)
}
