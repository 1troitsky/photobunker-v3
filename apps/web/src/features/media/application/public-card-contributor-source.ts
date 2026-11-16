import {activeSession,requireSession} from '../../identity/application/session'
import {digest,hex,importSpki,verify} from '../../identity/infrastructure/crypto'
import {
  assignmentFilesOpenAt,assignmentGrantExpiryCap,
  listCachedAssignmentSnapshots,listAssignmentOperations,
  mediaSubmissionSigningDomain,verifySignedAssignmentPolicy,
} from '../../assignments/application/assignment-outbox'
import {listLocalMedia,readLocalMedia} from './media-outbox'
import type {StoredMedia} from './media-outbox'
import {listOutgoingMediaGrants,parseMediaGrantContract} from './media-grants'
import {validateMediaContract} from '../domain/media-crypto'
import {requireSafeDerivativeCandidate} from './safe-derivatives'
import type {SafeDerivativeCandidate} from './safe-derivatives'
import {prepareSafePublicJpeg} from './public-card-safe-jpeg'
import type {PreparedSafePublicJpeg} from './public-card-safe-jpeg'
import type {ConsentBinding} from './public-card-consent-outbox'

/**
 * Private prepublication only. Independently inspect contributor-owned local
 * signed submission and safe derivative, decrypt ONLY the safe media via the
 * existing AES-GCM code, and return an in-memory clean JPEG for visual review.
 * This does not grant public access or independently prove server-current ACL.
 */
const enc=new TextEncoder()
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const sha=/^[a-f0-9]{64}$/
const SUBMISSION_KEYS=[
  'version','submissionId','operationId','assignmentId',
  'contributorAccountId','mediaId','mediaGrantId','mediaContractHash',
  'policyRevision','policyHash','kind',
]
const CAPTURE_KEYS=['captureContract','captureSignature']
const CAPTURE_FIELDS=[
  'version','assignmentId','ownerAccountId',
  'contributorAccountId','policyRevision','policyHash',
  'mediaId','mediaContractHash','mediaType','startedAt','finishedAt',
]
const exact=(value:unknown,fields:readonly string[]):boolean=>
  !!value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join('|')===[...fields].sort().join('|')

export type ContributorReviewSource={
  prepared:PreparedSafePublicJpeg
  binding:ConsentBinding
  localOnly:true
  published:false
  publicAuthorized:false
}

function same(session:ReturnType<typeof requireSession>):void{
  if(activeSession.value!==session)
    throw Error('public_card.source_identity_changed')
}
async function hashContract(raw:string):Promise<string>{
  return hex(await digest(enc.encode(raw)))
}
async function verifiedOwnMedia(
  record:StoredMedia|undefined,mediaId:string,
  session:ReturnType<typeof requireSession>,
):Promise<StoredMedia>{
  same(session)
  if(!record||record.accountId!==session.accountId
    ||record.mediaId!==mediaId
    ||!uuid.test(record.mediaId)
    ||record.mediaType!=='photo'||record.state!=='synced'
    ||!Number.isSafeInteger(record.expiresAt)
    ||record.expiresAt<=Date.now()
    ||record.contract?.mediaId!==mediaId
    ||record.contract.accountId!==session.accountId
    ||record.contract.mediaType!=='photo'
    ||record.contract.expiresAt!==record.expiresAt)
    throw Error('public_card.source_media_invalid')
  // A local database row is not proof: check the immutable manifest's
  // account/device P-256 signature and full field schema.
  validateMediaContract(record.contract,{
    accountId:session.accountId,mediaId,
  })
  const signed=JSON.stringify(record.contract)
  const signer=await importSpki(session.device.deviceSpki)
  if(!await verify(signer,'pb3.media.v1\n'+signed,record.signature))
    throw Error('public_card.source_media_signature_invalid')
  same(session)
  return record
}
function submittedContract(input:unknown):Record<string,unknown>{
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw Error('public_card.source_submission_invalid')
  const c=input as Record<string,unknown>
  const version=c.version
  if((version!==3&&version!==4)
    ||!exact(c,version===4
      ?[...SUBMISSION_KEYS,...CAPTURE_KEYS]:SUBMISSION_KEYS)
    ||c.kind!=='photo'
    ||!Number.isSafeInteger(c.policyRevision)
    ||(c.policyRevision as number)<1
    ||![c.submissionId,c.operationId,c.assignmentId,
      c.contributorAccountId,c.mediaId,c.mediaGrantId]
      .every(value=>typeof value==='string'&&uuid.test(value))
    ||![c.mediaContractHash,c.policyHash].every(
      value=>typeof value==='string'&&sha.test(value)))
    throw Error('public_card.source_submission_invalid')
  return c
}
async function assertCapture(
  source:StoredMedia,submission:Record<string,unknown>,
  policyHash:string,ownerAccountId:string,
  session:ReturnType<typeof requireSession>,
):Promise<void>{
  const attached=source.capture
  if(!attached){
    if(submission.version!==3)
      throw Error('public_card.source_capture_missing')
    return
  }
  if(submission.version!==4
    ||submission.captureContract!==attached.contract
    ||submission.captureSignature!==attached.signature)
    throw Error('public_card.source_capture_substituted')
  let proof:Record<string,unknown>
  try{proof=JSON.parse(attached.contract) as Record<string,unknown>}
  catch{throw Error('public_card.source_capture_invalid')}
  if(!exact(proof,CAPTURE_FIELDS)
    ||proof.version!==1
    ||proof.assignmentId!==submission.assignmentId
    ||proof.ownerAccountId!==ownerAccountId
    ||proof.contributorAccountId!==session.accountId
    ||proof.policyRevision!==submission.policyRevision
    ||proof.policyHash!==policyHash
    ||proof.mediaId!==source.mediaId
    ||proof.mediaContractHash!==submission.mediaContractHash
    ||proof.mediaType!=='photo'
    ||!Number.isSafeInteger(proof.startedAt)
    ||!Number.isSafeInteger(proof.finishedAt)
    ||(proof.finishedAt as number)<=(proof.startedAt as number)
    ||(proof.finishedAt as number)>Date.now()+120000
    ||!await verify(await importSpki(session.pkg.accountSpki),
      'pb3.assignment-media-capture.v1\n'+attached.contract,
      attached.signature))
    throw Error('public_card.source_capture_invalid')
  same(session)
}

/**
 * Local sent submission is only historical evidence. It is NOT live server
 * membership, current recipient permission, or authorization to publish.
 */
export async function prepareContributorReviewSource(
  candidate:SafeDerivativeCandidate,
):Promise<ContributorReviewSource>{
  const session=requireSession()
  if(!candidate||candidate.accountId!==session.accountId
    ||!uuid.test(candidate.sourceMediaId)
    ||!uuid.test(candidate.safeMediaId)
    ||candidate.sourceMediaId===candidate.safeMediaId)
    throw Error('public_card.source_wrong_candidate')
  const verifiedCandidate=await requireSafeDerivativeCandidate(
    candidate.sourceMediaId,candidate.safeMediaId)
  same(session)
  if(verifiedCandidate.key!==candidate.key
    ||verifiedCandidate.sourceContractHash!==candidate.sourceContractHash
    ||verifiedCandidate.safeContractHash!==candidate.safeContractHash)
    throw Error('public_card.source_candidate_changed')

  const [media,operations,policies,grants]=await Promise.all([
    listLocalMedia(),listAssignmentOperations(),
    listCachedAssignmentSnapshots(),listOutgoingMediaGrants(),
  ])
  same(session)
  const source=await verifiedOwnMedia(media.find(m=>
    m.mediaId===candidate.sourceMediaId),candidate.sourceMediaId,session)
  const safe=await verifiedOwnMedia(media.find(m=>
    m.mediaId===candidate.safeMediaId),candidate.safeMediaId,session)
  const sourceContractHash=await hashContract(JSON.stringify(source.contract))
  const safeContractHash=await hashContract(JSON.stringify(safe.contract))
  same(session)
  if(sourceContractHash!==candidate.sourceContractHash
    ||safeContractHash!==candidate.safeContractHash)
    throw Error('public_card.source_contract_changed')

  // The separately signed contributor-submission is required, not merely
  // a camera capture intent. Reject ambiguous duplicate sent submissions.
  const ownSigner=await importSpki(session.pkg.accountSpki)
  const matches:Array<{c:Record<string,unknown>;raw:string}>=[]
  for(const op of operations){
    same(session)
    if(op.kind!=='media-submit'||op.state!=='sent'
      ||op.accountId!==session.accountId)continue
    let c:Record<string,unknown>
    try{c=submittedContract(JSON.parse(op.contract))}
    catch{continue}
    if(c.mediaId!==source.mediaId)continue
    if(c.contributorAccountId!==session.accountId
      ||c.mediaContractHash!==sourceContractHash
      ||!await verify(ownSigner,
        mediaSubmissionSigningDomain(c.version)+op.contract,op.signature))
      throw Error('public_card.source_submission_signature_invalid')
    matches.push({c,raw:op.contract})
  }
  same(session)
  if(matches.length!==1)
    throw Error('public_card.source_single_sent_submission_required')
  const {c,raw}=matches[0]!
  const assignment=policies.find(row=>row.assignmentId===c.assignmentId)
  if(!assignment||assignment.ownerAccountId===session.accountId
    ||assignment.state!=='active'
    ||!assignmentFilesOpenAt(assignment,Date.now())
    ||assignment.policyRevision!==c.policyRevision)
    throw Error('public_card.source_signed_assignment_unavailable')
  await verifySignedAssignmentPolicy(assignment,true)
  same(session)
  const policyRaw=assignment.policyAmendmentContract
    ??assignment.policyContract
  const policyHash=await hashContract(policyRaw)
  if(c.policyHash!==policyHash)
    throw Error('public_card.source_assignment_policy_changed')
  await assertCapture(source,c,policyHash,assignment.ownerAccountId,session)

  const grant=grants.find(g=>g.id===c.mediaGrantId)
  if(!grant||grant.state!=='sent'
    ||grant.ownerAccountId!==session.accountId
    ||grant.recipientAccountId!==assignment.ownerAccountId
    ||grant.mediaId!==source.mediaId)
    throw Error('public_card.source_scoped_grant_missing')
  let grantContract:ReturnType<typeof parseMediaGrantContract>
  try{grantContract=parseMediaGrantContract(JSON.parse(grant.contract))}
  catch{throw Error('public_card.source_scoped_grant_invalid')}
  if(grantContract.version!==2||grantContract.scope!=='read'
    ||grantContract.assignmentId!==assignment.assignmentId
    ||grantContract.mediaId!==source.mediaId
    ||grantContract.ownerAccountId!==session.accountId
    ||grantContract.recipientAccountId!==assignment.ownerAccountId
    ||grantContract.grantId!==grant.id
    ||grantContract.mediaContractHash!==sourceContractHash
    ||grantContract.expiresAt<=Date.now()
    ||!await verify(ownSigner,
      'pb3.media-grant.v2\n'+grant.contract,grant.signature))
    throw Error('public_card.source_scoped_grant_invalid')
  same(session)

  const expiration=Math.min(
    source.expiresAt,safe.expiresAt,grantContract.expiresAt,
    assignmentGrantExpiryCap(assignment)??Number.POSITIVE_INFINITY,
  )
  if(expiration<=Date.now())
    throw Error('public_card.source_expired')

  // Only SAFE bytes are decrypted with the contributor's local AES-GCM.
  const decrypted=await readLocalMedia(safe.mediaId)
  same(session)
  if(decrypted.metadata.mime!=='image/jpeg'
    ||decrypted.blob.type!=='image/jpeg')
    throw Error('public_card.source_safe_jpeg_required')
  const prepared=await prepareSafePublicJpeg(decrypted.blob)
  same(session)
  if(expiration<=Date.now())
    throw Error('public_card.source_expired')

  // Local owner-signed removal/policy changes may have committed during
  // Canvas compression. Check before showing any derived pixels.
  const fresh=await requireSafeDerivativeCandidate(
    source.mediaId,safe.mediaId)
  const nowPolicies=await listCachedAssignmentSnapshots()
  same(session)
  if(fresh.sourceContractHash!==sourceContractHash
    ||fresh.safeContractHash!==safeContractHash
    ||!nowPolicies.some(p=>p.assignmentId===assignment.assignmentId
      &&p.state==='active'
      &&p.policyRevision===assignment.policyRevision
      &&p.policyContract===assignment.policyContract
      &&p.policyAmendmentContract===assignment.policyAmendmentContract
      &&assignmentFilesOpenAt(p,Date.now())))
    throw Error('public_card.source_changed_during_review')
  return {
    prepared,
    binding:{
      assignmentId:assignment.assignmentId,
      submissionId:c.submissionId as string,
      submissionContractHash:await hashContract(raw),
      sourceMediaId:source.mediaId,
      sourceContractHash,
      safeMediaId:safe.mediaId,
      sourceExpiresAt:Math.min(source.expiresAt,expiration),
      safeExpiresAt:Math.min(safe.expiresAt,expiration),
      assignmentExpiresAt:expiration,
    },
    localOnly:true,published:false,publicAuthorized:false,
  }
}
