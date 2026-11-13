import { importSpki,verify } from '../../identity/infrastructure/crypto'
import { pinnedPeer } from '../../sharing/key-directory'
import type { SignedDirectory } from '../../sharing/key-directory'
import type { AssignmentMediaSubmission } from './assignment-outbox'

const core=[
  'version','submissionId','operationId','assignmentId',
  'contributorAccountId','mediaId','mediaGrantId',
  'mediaContractHash','policyRevision','policyHash','kind',
]
const captureKeys=[
  'version','assignmentId','ownerAccountId','contributorAccountId',
  'policyRevision','policyHash','mediaId','mediaContractHash',
  'mediaType','startedAt','finishedAt',
]
function exact(value:Record<string,unknown>,keys:string[]):boolean{
  return Object.keys(value).sort().join('|')===keys.slice().sort().join('|')
}
function object(value:unknown):value is Record<string,unknown>{
  return value!==null&&typeof value==='object'&&!Array.isArray(value)
}
function hexHash(value:unknown):boolean{
  return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
}
/**
 * Structural check of the immutable contributor-signed consent receipt.
 * This alone is NOT verification: the independent peer pin and ECDSA checks
 * in verifyMediaSubmissionReceipt are mandatory before the UI says verified.
 */
export function inspectMediaSubmissionReceipt(
  entry:AssignmentMediaSubmission,assignmentId:string,ownerAccountId:string,
):{version:1|2|3|4;captureContract?:string;captureSignature?:string}{
  if(typeof entry.contract!=='string'||entry.contract.length>30000
    ||typeof entry.signature!=='string'||!hexHash(entry.mediaContractHash))
    throw Error('assignment.receipt_unverified')
  let c:unknown
  try{c=JSON.parse(entry.contract)}catch{throw Error('assignment.receipt_unverified')}
  if(!object(c))throw Error('assignment.receipt_unverified')
  const version=c.version
  if(version!==1&&version!==2&&version!==3&&version!==4
    ||!exact(c,version===2||version===4
      ?[...core,'captureContract','captureSignature']:core)
    ||JSON.stringify(c)!==entry.contract
    ||c.submissionId!==entry.submissionId
    ||c.assignmentId!==assignmentId
    ||c.contributorAccountId!==entry.contributorAccountId
    ||c.mediaId!==entry.mediaId||c.mediaGrantId!==entry.mediaGrantId
    ||c.mediaContractHash!==entry.mediaContractHash
    ||c.kind!==entry.mediaType
    ||typeof c.policyRevision!=='number'
    ||!Number.isSafeInteger(c.policyRevision)
    ||c.policyRevision<(version===3||version===4?1:2)
    ||c.policyRevision>1001
    ||!hexHash(c.policyHash)
    ||entry.capturedInAssignment!==(version===2||version===4)
    ||([3,4].includes(version)
      ?entry.mediaType!=='photo':entry.mediaType==='photo'))
    throw Error('assignment.receipt_unverified')
  if(version!==2&&version!==4)return {version}
  if(typeof c.captureContract!=='string'
    ||typeof c.captureSignature!=='string')throw Error('assignment.receipt_unverified')
  let capture:unknown
  try{capture=JSON.parse(c.captureContract)}catch{throw Error('assignment.receipt_unverified')}
  if(!object(capture)||!exact(capture,captureKeys)
    ||JSON.stringify(capture)!==c.captureContract
    ||capture.version!==1
    ||capture.assignmentId!==assignmentId
    ||capture.ownerAccountId!==ownerAccountId
    ||capture.contributorAccountId!==entry.contributorAccountId
    ||capture.mediaId!==entry.mediaId
    ||capture.mediaType!==entry.mediaType
    ||capture.mediaContractHash!==entry.mediaContractHash
    ||capture.policyRevision!==c.policyRevision
    ||capture.policyHash!==c.policyHash
    ||typeof capture.startedAt!=='number'
    ||typeof capture.finishedAt!=='number'
    ||!Number.isSafeInteger(capture.startedAt)
    ||!Number.isSafeInteger(capture.finishedAt)
    ||capture.finishedAt<=capture.startedAt
    ||capture.finishedAt-capture.startedAt>3*60000)
    throw Error('assignment.receipt_unverified')
  return {version,captureContract:c.captureContract,captureSignature:c.captureSignature}
}
/**
 * Signed account consent, NOT independent camera/GPS hardware attestation.
 * An unpinned contributor, changed key or invalid signature fails closed.
 */
async function verifySignedReceiptWithPinnedIdentity(
  entry:AssignmentMediaSubmission,assignmentId:string,
  ownerAccountId:string,peer:SignedDirectory,
):Promise<void>{
  const parsed=inspectMediaSubmissionReceipt(entry,assignmentId,ownerAccountId)
  if(peer.accountId!==entry.contributorAccountId)
    throw Error('assignment.receipt_unverified')
  const key=await importSpki(peer.accountSpki)
  if(!await verify(key,
    'pb3.assignment-media-submit.v'+parsed.version+'\n'+entry.contract,
    entry.signature))
    throw Error('assignment.receipt_unverified')
  if((parsed.version===2||parsed.version===4)
    &&(!parsed.captureContract||!parsed.captureSignature
      ||!await verify(key,'pb3.assignment-media-capture.v1\n'
        +parsed.captureContract,parsed.captureSignature)))
    throw Error('assignment.receipt_unverified')
}

export async function verifyMediaSubmissionReceipt(
  entry:AssignmentMediaSubmission,assignmentId:string,ownerAccountId:string,
):Promise<void>{
  const peer=await pinnedPeer(entry.contributorAccountId)
  await verifySignedReceiptWithPinnedIdentity(entry,assignmentId,ownerAccountId,peer)
}

/**
 * Fetch each contributor's independently verified key only ONCE per page.
 * No trusted key survives a refresh/session change in this batch cache.
 * Each receipt still gets its own canonical and ECDSA verification result.
 */
export async function verifyMediaSubmissionReceiptPage(
  entries:AssignmentMediaSubmission[],assignmentId:string,ownerAccountId:string,
):Promise<Record<string,boolean>>{
  const pins=new Map<string,Promise<SignedDirectory>>()
  const checked=await Promise.all(entries.map(async entry=>{
    try{
      // Never request a peer key for a structurally invalid receipt.
      inspectMediaSubmissionReceipt(entry,assignmentId,ownerAccountId)
      let pin=pins.get(entry.contributorAccountId)
      if(!pin){
        pin=pinnedPeer(entry.contributorAccountId)
        pins.set(entry.contributorAccountId,pin)
      }
      await verifySignedReceiptWithPinnedIdentity(entry,assignmentId,ownerAccountId,await pin)
      return [entry.submissionId,true] as const
    }catch{
      return [entry.submissionId,false] as const
    }
  }))
  return Object.fromEntries(checked)
}
