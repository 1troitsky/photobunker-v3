import { requireSession, activeSession } from '../../identity/application/session'
import { jsonApi } from '../../identity/infrastructure/api'
import { digest, hex } from '../../identity/infrastructure/crypto'
import { listLocalPhotos, readLocalPhotoMetadata } from '../../photo-sync/application/p1-photo'
import type { PhotoMetadata } from '../../photo-sync/domain/capture-metadata'
import type { StoredPhoto } from '../../photo-sync/application/p1-photo'
import {
  listCachedAssignmentSnapshots, signedPolicyRequirements,
  verifySignedAssignmentPolicy,
} from './assignment-outbox'
import type {
  AssignmentListing, CaptureRequirements, SignedCaptureBinding,
} from './assignment-outbox'

const encoder=new TextEncoder()
function hash(value:string):Promise<string>{
  return digest(encoder.encode(value)).then(hex)
}
function validatePrivateFields(metadata:PhotoMetadata,requirements:CaptureRequirements):void{
  if(requirements.requiredCategory&&!metadata.category)
    throw Error('assignment.category_required')
  if(requirements.descriptionMinLength>0
    &&(metadata.description?.length??0)<requirements.descriptionMinLength)
    throw Error('assignment.description_too_short')
  if(requirements.requiredGps&&!metadata.gps)
    throw Error('assignment.gps_required')
}

export type SignedPolicyHistoryEvent={
  fromPolicyRevision:number;toPolicyRevision:number
  contractHash:string;contract:string;signature:string;occurredAtMs:number
}
export type SignedPolicyHistory={
  assignmentId:string;policyRevision:number;rootPolicyHash:string
  events:SignedPolicyHistoryEvent[]
}
type HistoricalEffectivePolicy={
  revision:number;policyHash:string;requirements:CaptureRequirements
  validFrom:number;validUntil:number
}

/**
 * Verify EVERY signed amendment rather than trusting an unverified historical
 * policy from a mutable API. The latest signature/hash/revision is pinned to
 * an independently authenticated assignment snapshot already in IndexedDB.
 */
export async function verifySignedPolicyHistory(
  latest:AssignmentListing,history:SignedPolicyHistory,
):Promise<HistoricalEffectivePolicy[]>{
  await verifySignedAssignmentPolicy(latest,true)
  const root=await hash(latest.policyContract)
  if(history.assignmentId!==latest.assignmentId
    ||history.policyRevision!==latest.policyRevision
    ||history.rootPolicyHash!==root
    ||!Array.isArray(history.events)
    ||history.events.length!==latest.policyRevision-1
    ||history.events.length>1000)
    throw Error('assignment.policy_history_invalid')
  const chain:HistoricalEffectivePolicy[]=[{
    revision:1,policyHash:root,
    requirements:{requiredCategory:false,descriptionMinLength:0,requiredGps:false},
    validFrom:latest.startsAt,validUntil:Number.POSITIVE_INFINITY,
  }]
  let previousHash=root
  let previousVersion=1
  let previousAt=latest.startsAt
  for(let index=0;index<history.events.length;index++){
    const event=history.events[index]
    const revision=index+2
    if(!event||event.fromPolicyRevision!==revision-1
      ||event.toPolicyRevision!==revision
      ||!Number.isSafeInteger(event.occurredAtMs)
      ||event.occurredAtMs<previousAt
      ||typeof event.contract!=='string'
      ||typeof event.signature!=='string')
      throw Error('assignment.policy_history_invalid')
    const digestValue=await hash(event.contract)
    if(digestValue!==event.contractHash)
      throw Error('assignment.policy_history_invalid')
    let contract:Record<string,unknown>
    try{contract=JSON.parse(event.contract) as Record<string,unknown>}
    catch{throw Error('assignment.policy_history_invalid')}
    if((contract.version!==1&&contract.version!==2)
      ||(previousVersion===2&&contract.version!==2)
      ||contract.assignmentId!==latest.assignmentId
      ||contract.ownerAccountId!==latest.ownerAccountId
      ||contract.rootPolicyHash!==root
      ||contract.previousPolicyHash!==previousHash
      ||contract.fromPolicyRevision!==revision-1
      ||contract.toPolicyRevision!==revision
      ||contract.allowedMedia?.[0]!=='photo')
      throw Error('assignment.policy_history_invalid')
    const snapshot:AssignmentListing={
      ...latest,policyRevision:revision,
      photoGoal:contract.photoGoal as number|null,
      policyAmendmentContract:event.contract,
      policyAmendmentSignature:event.signature,
    }
    await verifySignedAssignmentPolicy(snapshot,true)
    chain[chain.length-1]!.validUntil=event.occurredAtMs
    chain.push({
      revision,policyHash:digestValue,
      requirements:signedPolicyRequirements(snapshot),
      validFrom:event.occurredAtMs,validUntil:Number.POSITIVE_INFINITY,
    })
    previousAt=event.occurredAtMs
    previousHash=digestValue
    previousVersion=contract.version as number
  }
  if(latest.policyRevision>1 && (
    history.events.at(-1)?.contract!==latest.policyAmendmentContract
    ||history.events.at(-1)?.signature!==latest.policyAmendmentSignature
  ))throw Error('assignment.policy_history_invalid')
  return chain
}

export function validatePhotoForGrant(
  photo:StoredPhoto,meta:PhotoMetadata,
  assignmentId:string,ownerAccountId:string,
  effective:HistoricalEffectivePolicy,
):void{
  if(photo.state!=='synced'||photo.expiresAt<=Date.now())
    throw Error('assignment.photo_not_synced')
  if(photo.accountId!==requireSession().accountId)
    throw Error('assignment.wrong_photo_owner')
  if(meta.capturedAt!==photo.createdAt)
    throw Error('assignment.capture_metadata_mismatch')
  if(photo.capture){
    const capture:SignedCaptureBinding=photo.capture
    if(capture.assignmentId!==assignmentId
      ||capture.ownerAccountId!==ownerAccountId
      ||capture.policyRevision!==effective.revision
      ||capture.policyHash!==effective.policyHash
      ||capture.capturedAt!==meta.capturedAt
      ||JSON.stringify(meta.assignmentCapture)!==JSON.stringify(capture))
      throw Error('assignment.capture_scope_mismatch')
    if(capture.capturedAt<effective.validFrom
      ||capture.capturedAt>=effective.validUntil)
      throw Error('assignment.capture_policy_not_effective')
  }else if(meta.assignmentCapture!==undefined){
    throw Error('assignment.capture_scope_mismatch')
  }
  validatePrivateFields(meta,effective.requirements)
}

/**
 * Gate BEFORE queueRecipientGrant: wrong-assignment ciphertext never reveals a
 * DEK to an unintended owner merely because the later submission rejects.
 * Personal v1 photos are explicitly shareable, but must satisfy current
 * owner's public requirements; caller must request separate user consent.
 */
export async function preflightAssignmentPhotoGrant(
  assignmentId:string,photoId:string,expectedOwner:string,
):Promise<{policyRevision:number;personalPhoto:boolean}>{
  const session=requireSession()
  const snapshots=await listCachedAssignmentSnapshots()
  const latest=snapshots.find(x=>x.assignmentId===assignmentId)
  if(!latest||latest.ownerAccountId!==expectedOwner
    ||latest.state!=='active'
    ||latest.startsAt>Date.now()
    ||(latest.endsAt!==null&&latest.endsAt<=Date.now()))
    throw Error('assignment.policy_not_authenticated')
  const photos=await listLocalPhotos()
  const photo=photos.find(p=>p.photoId===photoId)
  if(!photo)throw Error('assignment.photo_not_available')
  const metadata=await readLocalPhotoMetadata(photoId)
  if(activeSession.value!==session)throw Error('identity.changed')
  const revision=photo.capture?.policyRevision??latest.policyRevision
  if(!Number.isSafeInteger(revision)||revision<1
    ||revision>latest.policyRevision)
    throw Error('assignment.capture_scope_mismatch')
  let effective:HistoricalEffectivePolicy
  if(revision===1){
    effective={
      revision:1,policyHash:await hash(latest.policyContract),
      requirements:{requiredCategory:false,descriptionMinLength:0,requiredGps:false},
      validFrom:latest.startsAt,validUntil:Number.POSITIVE_INFINITY,
    }
  }else if(revision===latest.policyRevision){
    const contract=latest.policyAmendmentContract
    if(!contract)throw Error('assignment.policy_not_authenticated')
    effective={
      revision,policyHash:await hash(contract),
      requirements:signedPolicyRequirements(latest),
      validFrom:latest.startsAt,validUntil:Number.POSITIVE_INFINITY,
    }
  }else{
    // A historical revision (>1) is NOT guessable from a mutable latest
    // snapshot. Require its full owner-signed chain on first access. No
    // grant is created if the API is unavailable or history is incomplete.
    if(!session.online||!navigator.onLine)
      throw Error('assignment.policy_history_requires_connection')
    const history=await jsonApi<SignedPolicyHistory>(
      '/assignments/v1/'+encodeURIComponent(assignmentId)+'/policy-history')
    if(activeSession.value!==session)throw Error('identity.changed')
    const chain=await verifySignedPolicyHistory(latest,history)
    const selected=chain.find(x=>x.revision===revision)
    if(!selected)throw Error('assignment.policy_history_invalid')
    effective=selected
  }
  // A personal photo is intentionally permitted by the accepted v1
  // assignment contract. Apply the newest requirement set to it.
  if(!photo.capture){
    effective.requirements=signedPolicyRequirements(latest)
  }
  validatePhotoForGrant(photo,metadata,assignmentId,expectedOwner,effective)
  if(activeSession.value!==session)throw Error('identity.changed')
  return {policyRevision:revision,personalPhoto:!photo.capture}
}
