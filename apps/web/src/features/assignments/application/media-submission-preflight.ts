import { activeSession,requireSession } from '../../identity/application/session'
import { digest,hex,importSpki,verify } from '../../identity/infrastructure/crypto'
import { readLocalMedia,listLocalMedia } from '../../media/application/media-outbox'
import { prepareMediaPrivateFields,validateMediaPrivateRequirements } from '../../media/domain/media-crypto'
import { validateAdvancedFields } from '../domain/advanced-rules'
import {
  listServerAssignments,signedAllowedAssignmentMedia,
  signedMediaRequirements,signedAdvancedRequirements,verifySignedAssignmentPolicy,
  schedulePermitsAt,assignmentFilesOpenAt,assignmentGrantExpiryCap,
} from './assignment-outbox'
import type { AssignmentListing } from './assignment-outbox'

const enc=new TextEncoder()
/**
 * Fail CLOSED before giving another account a media DEK.
 * The owner can tighten the signed rules while an old offline recording
 * is pending; a cached offline policy is not grant authority.
 * Media bytes, original filename, category, description, and GPS remain local.
 */
export async function preflightAssignmentMediaGrant(
  assignmentId:string,mediaId:string,expectedOwnerAccountId:string,
):Promise<{mediaType:'video'|'audio';personalMedia:boolean}>{
  const session=requireSession()
  if(!session.online||!navigator.onLine)
    throw Error('assignment.media_grant_requires_connection')
  let cursor:string|undefined
  let policy:AssignmentListing|undefined
  do{
    const page=await listServerAssignments(cursor)
    policy=page.items.find(x=>x.assignmentId===assignmentId)
    cursor=page.nextCursor??undefined
  }while(!policy&&cursor)
  if(activeSession.value!==session)throw Error('identity.changed')
  if(!policy||policy.ownerAccountId!==expectedOwnerAccountId
    ||policy.ownerAccountId===session.accountId
    ||policy.state!=='active'
    ||!assignmentFilesOpenAt(policy,Date.now())
    ||!schedulePermitsAt(policy,Date.now()))
    throw Error('assignment.policy_not_authenticated')
  await verifySignedAssignmentPolicy(policy,true)
  const media=(await listLocalMedia()).find(x=>x.mediaId===mediaId)
  if(!media||media.accountId!==session.accountId
    ||media.state!=='synced'||media.expiresAt<=Date.now()
    ||(media.mediaType!=='video'&&media.mediaType!=='audio')
    ||!signedAllowedAssignmentMedia(policy).includes(media.mediaType))
    throw Error('assignment.media_not_allowed')
  const {metadata}=await readLocalMedia(mediaId)
  if(activeSession.value!==session)throw Error('identity.changed')
  const fields=prepareMediaPrivateFields(metadata,metadata.createdAt)
  validateMediaPrivateRequirements(fields,
    signedMediaRequirements(policy,media.mediaType))
  validateAdvancedFields(fields,signedAdvancedRequirements(policy,media.mediaType))
  if(media.capture){
    let proof:Record<string,unknown>
    try{proof=JSON.parse(media.capture.contract) as Record<string,unknown>}
    catch{throw Error('assignment.recording_bound_to_different_policy')}
    const effectiveContract=policy.policyAmendmentContract
    if(!effectiveContract)throw Error('assignment.policy_not_authenticated')
    const hash=hex(await digest(enc.encode(effectiveContract)))
    const mediaHash=hex(await digest(enc.encode(JSON.stringify(media.contract))))
    if(proof.version!==1
      ||proof.assignmentId!==assignmentId
      ||proof.ownerAccountId!==expectedOwnerAccountId
      ||proof.contributorAccountId!==session.accountId
      ||proof.policyRevision!==policy.policyRevision
      ||proof.policyHash!==hash
      ||proof.mediaId!==media.mediaId
      ||proof.mediaContractHash!==mediaHash
      ||proof.mediaType!==media.mediaType
      ||!await verify(await importSpki(session.pkg.accountSpki),
        'pb3.assignment-media-capture.v1\n'+media.capture.contract,
        media.capture.signature))
      throw Error('assignment.recording_bound_to_different_policy')
  }
  if(activeSession.value!==session)throw Error('identity.changed')
  return {mediaType:media.mediaType,personalMedia:!media.capture}
}
