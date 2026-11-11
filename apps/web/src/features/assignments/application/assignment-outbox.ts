import Dexie, { type Table } from 'dexie'
import { activeSession, requireSession } from '../../identity/application/session'
import { jsonApi } from '../../identity/infrastructure/api'
import { importSigner, sign, verify, importSpki, digest, hex, b64, unb64 } from '../../identity/infrastructure/crypto'
import { pinnedPeer } from '../../sharing/key-directory'
import { listOutgoingGrants } from '../../sharing/grant-flow'
import { listOutgoingMediaGrants,parseMediaGrantContract } from '../../media/application/media-grants'
import { listLocalMedia } from '../../media/application/media-outbox'
import type { MediaCaptureIntent } from '../../media/application/media-outbox'
import { sealAssignment, resealOwnerAssignment, openOwnerAssignment, wrapAssignmentForRecipient, validatePrivateAssignment, upgradePrivateAssignment } from '../infrastructure/assignment-crypto'
import type { AssignmentEnvelope, AssignmentInviteEnvelope, PrivateAssignment } from '../infrastructure/assignment-crypto'
import { preparePhotoMetadata } from '../../photo-sync/domain/capture-metadata'
import type { CaptureMetadataInput } from '../../photo-sync/domain/capture-metadata'
import { prepareMediaPrivateFields, validateMediaPrivateRequirements } from '../../media/domain/media-crypto'
import type { MediaPrivateFields } from '../../media/domain/media-crypto'
import { EMPTY_ADVANCED_RULES, normalizeAdvancedRules, validateAdvancedFields } from '../domain/advanced-rules'
import {inspectAssignmentRemovalNotices} from './verify-removal-notice'
import {appendBoundedUuidPage} from './bounded-uuid-pages'
import type {AssignmentRemovalNotice,CheckedAssignmentRemovalNotice} from './verify-removal-notice'
import type { AdvancedRules } from '../domain/advanced-rules'

export type AssignmentOperationKind='create'|'invite'|'accept'|'remove-member'|'submit'|'media-submit'|'state'|'policy'|'private'|'schedule'|'retention'
export type AssignmentOperationState='queued'|'retry'|'sent'|'conflict'

export interface AssignmentOperation {
  id:string
  accountId:string
  kind:AssignmentOperationKind
  path:string
  contract:string
  signature:string
  state:AssignmentOperationState
  createdAt:number
  lastError?:string
  prerequisiteGrantId?:string
}
export interface LocalAssignment {
  id:string
  ownerAccountId:string
  createdAt:number
  state:AssignmentOperationState
  privateEnvelope:AssignmentEnvelope
  photoGoal:number|null
  startsAt:number
  endsAt:number|null
}
export type AssignmentListing={
  assignmentId:string
  ownerAccountId:string
  ownerAccountSpki:string
  state:string
  revision:number
  photoGoal:number|null
  videoGoal?:number|null
  audioGoal?:number|null
  confirmedPhotoCount:number // server-derived, never a signed capture-policy field
  confirmedVideoCount?:number
  confirmedAudioCount?:number
  policyRevision:number
  policyContract:string
  policySignature:string
  policyAmendmentContract?:string|null
  policyAmendmentSignature?:string|null
  privateRevision?:number
  privateAmendmentContract?:string|null
  privateAmendmentSignature?:string|null
  scheduleRevision?:number
  scheduleAmendmentContract?:string|null
  scheduleAmendmentSignature?:string|null
  retentionRevision?:number
  retentionAmendmentContract?:string|null
  retentionAmendmentSignature?:string|null
  filesAccessUntil?:number|null
  assignmentAccessUntil?:number|null
  stateContract:string|null
  stateSignature:string|null
  privateEnvelope:AssignmentEnvelope
  startsAt:number
  endsAt:number|null
}
export type ReceivedAssignmentInvite={
  inviteId:string
  assignmentId:string
  ownerAccountId:string
  ownerAccountSpki:string
  state:string
  contract:string
  signature:string
  expiresAt:number
}

/** P1-23: freshly fetched owner-only roster; never an offline entitlement. */
export type AssignmentParticipant={
  inviteId:string;recipientAccountId:string;role:'contributor'
  state:'pending'|'accepted'|'removed';expiresAt:number;expired:boolean
  contract:string;signature:string
  removalContract?:string|null;removalSignature?:string|null
}
type AssignmentParticipantsPage={
  items:AssignmentParticipant[];nextCursor:string|null;serverNowMs:number
}
/**
 * Verify each identity/role/expiry against its original owner signature.
 * State and expired are SERVER observations; never claim client-signed consent.
 */
export async function verifyAssignmentParticipantRoster(
  page:AssignmentParticipantsPage,assignmentId:string,
  ownerAccountId:string,ownerSpki:string,
):Promise<void>{
  if(!page||!Array.isArray(page.items)||page.items.length>50
    ||!Number.isSafeInteger(page.serverNowMs)||page.serverNowMs<0)
    throw Error('assignment.roster_invalid')
  const signer=await importSpki(ownerSpki)
  const ids=new Set<string>()
  for(const item of page.items){
    if(!item||typeof item.inviteId!=='string'
      ||typeof item.recipientAccountId!=='string'
      ||ids.has(item.inviteId)
      ||item.role!=='contributor'
      ||!['pending','accepted','removed'].includes(item.state)
      ||!Number.isSafeInteger(item.expiresAt)
      ||item.expired!==(item.state==='pending'&&item.expiresAt<=page.serverNowMs)
      ||typeof item.contract!=='string'||typeof item.signature!=='string')
      throw Error('assignment.roster_invalid')
    ids.add(item.inviteId)
    let signed:Record<string,unknown>
    try{signed=JSON.parse(item.contract) as Record<string,unknown>}
    catch{throw Error('assignment.roster_invalid')}
    if(!signed||typeof signed!=='object'||Array.isArray(signed)
      ||signed.version!==1||signed.inviteId!==item.inviteId
      ||signed.assignmentId!==assignmentId
      ||signed.ownerAccountId!==ownerAccountId
      ||signed.recipientAccountId!==item.recipientAccountId
      ||signed.role!==item.role||signed.expiresAt!==item.expiresAt
      ||!await verify(signer,domain('invite')+item.contract,item.signature))
      throw Error('assignment.roster_untrusted_invite')
    if(item.state==='removed'){
      if(typeof item.removalContract!=='string'
        ||typeof item.removalSignature!=='string')
        throw Error('assignment.roster_untrusted_removal')
      let removal:Record<string,unknown>
      try{removal=JSON.parse(item.removalContract) as Record<string,unknown>}
      catch{throw Error('assignment.roster_untrusted_removal')}
      const fields=['version','action','operationId','assignmentId','inviteId',
        'ownerAccountId','recipientAccountId']
      const keys=removal&&typeof removal==='object'&&!Array.isArray(removal)
        ?Object.keys(removal):[]
      if(keys.sort().join('|')!==fields.sort().join('|')
        ||JSON.stringify(removal)!==item.removalContract
        ||removal.version!==1||removal.action!=='remove'
        ||removal.assignmentId!==assignmentId
        ||removal.inviteId!==item.inviteId
        ||removal.ownerAccountId!==ownerAccountId
        ||removal.recipientAccountId!==item.recipientAccountId
        ||typeof removal.operationId!=='string'
        ||!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(removal.operationId)
        ||!await verify(signer,domain('remove-member')+item.removalContract,
          item.removalSignature))
        throw Error('assignment.roster_untrusted_removal')
    }else if(item.removalContract!=null||item.removalSignature!=null){
      throw Error('assignment.roster_untrusted_removal')
    }
  }
  if(page.nextCursor!==null
    &&(typeof page.nextCursor!=='string'
      ||page.items.length!==50
      ||page.items[49]?.inviteId!==page.nextCursor))
    throw Error('assignment.roster_invalid_cursor')
}

/** Live owner-only verified roster. No optimistic or cached "accepted" states. */
export async function listAssignmentParticipants(
  assignmentId:string,
):Promise<AssignmentParticipant[]>{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&!navigator.onLine))
    throw Error('assignment.roster_requires_online')
  const local=await db.capturePolicies.get(s.accountId+'/'+assignmentId)
  if(!local||local.listing.ownerAccountId!==s.accountId)
    throw Error('assignment.roster_owner_required')
  await verifySignedAssignmentPolicy(local.listing,true)
  if(local.listing.ownerAccountSpki!==s.pkg.accountSpki)
    throw Error('assignment.roster_untrusted_owner')
  assertSame(s)
  const items:AssignmentParticipant[]=[]
  let after:string|null=null
  for(let pageNum=0;pageNum<100;pageNum++){
    const suffix:string=after?'?after='+encodeURIComponent(after):''
    const page:AssignmentParticipantsPage=await jsonApi<AssignmentParticipantsPage>(
      '/assignments/v1/'+encodeURIComponent(assignmentId)+'/participants'+suffix)
    assertSame(s)
    await verifyAssignmentParticipantRoster(page,assignmentId,s.accountId,s.pkg.accountSpki)
    assertSame(s)
    if(after&&page.items.length&&page.items[0]!.inviteId<=after)
      throw Error('assignment.roster_invalid_cursor')
    items.push(...page.items)
    if(!page.nextCursor)return items
    after=page.nextCursor
  }
  throw Error('assignment.roster_pagination_limit')
}

type CachedInvite=ReceivedAssignmentInvite & { cachedForAccountId:string }
type CachedCapturePolicy={
  key:string;accountId:string;listing:AssignmentListing;verifiedAt:number
}
type CachedPrivateAssignment={
  key:string;accountId:string;assignmentId:string;policyHash:string
  iv:string;ciphertext:Blob // AES-GCM ciphertext only, never plaintext
}
type CachedVerifiedRemoval={
  key:string;accountId:string;assignmentId:string;ownerAccountId:string
  inviteId:string;removalContract:string;removalSignature:string
  verifiedAt:number
}
export type SignedCaptureBinding={
  assignmentId:string;ownerAccountId:string;policyRevision:number
  policyHash:string;capturedAt:number
}
export type CaptureRequirements={
  requiredCategory:boolean;descriptionMinLength:number;requiredGps:boolean
}
const NO_CAPTURE_REQUIREMENTS:CaptureRequirements={
  requiredCategory:false,descriptionMinLength:0,requiredGps:false,
}
/**
 * Extracts requirements only from an owner-signed snapshot that the caller
 * has already authenticated with verifySignedAssignmentPolicy().
 */
export function signedPolicyRequirements(item:AssignmentListing):CaptureRequirements{
  if(item.policyRevision===1)return {...NO_CAPTURE_REQUIREMENTS}
  if(!item.policyAmendmentContract)throw Error('assignment.policy_revision_not_authenticated')
  const amend=JSON.parse(item.policyAmendmentContract) as Record<string,unknown>
  if(amend.version===1)return {...NO_CAPTURE_REQUIREMENTS}
  if(![2,3,4,5,6].includes(amend.version as number)||typeof amend.requiredCategory!=='boolean'
    ||typeof amend.requiredGps!=='boolean'
    ||!Number.isInteger(amend.descriptionMinLength)
    ||(amend.descriptionMinLength as number)<0
    ||(amend.descriptionMinLength as number)>4000)
    throw Error('assignment.invalid_capture_requirements')
  return {
    requiredCategory:amend.requiredCategory,
    descriptionMinLength:amend.descriptionMinLength as number,
    requiredGps:amend.requiredGps,
  }
}

export type AllowedAssignmentMedia=Array<'photo'|'video'|'audio'>
export function validAllowedMedia(value:unknown):value is AllowedAssignmentMedia{
  return Array.isArray(value)&&[
    ['photo'],['photo','video'],['photo','audio'],['photo','video','audio'],
  ].some(v=>JSON.stringify(v)===JSON.stringify(value))
}
/** Call only after verifySignedAssignmentPolicy; never trust raw server flags. */
export function signedAllowedAssignmentMedia(item:AssignmentListing):AllowedAssignmentMedia{
  if(item.policyRevision===1)return ['photo']
  if(!item.policyAmendmentContract)
    throw Error('assignment.policy_revision_not_authenticated')
  const edit=JSON.parse(item.policyAmendmentContract) as Record<string,unknown>
  if(edit.version===3||edit.version===4||edit.version===5||edit.version===6){
    if(!validAllowedMedia(edit.allowedMedia))throw Error('assignment.invalid_allowed_media')
    return edit.allowedMedia
  }
  if(edit.version===1||edit.version===2)return ['photo']
  throw Error('assignment.invalid_policy_revision')
}

/** Owner-signed public requirement flags, not plaintext captured metadata. */
export function signedMediaRequirements(
  item:AssignmentListing,kind:'video'|'audio',
):CaptureRequirements{
  if(item.policyRevision===1)return {...NO_CAPTURE_REQUIREMENTS}
  if(!item.policyAmendmentContract)throw Error('assignment.policy_revision_not_authenticated')
  const edit=JSON.parse(item.policyAmendmentContract) as Record<string,unknown>
  if(edit.version!==5&&edit.version!==6)return {...NO_CAPTURE_REQUIREMENTS}
  const rules=edit[kind==='video'?'videoRequirements':'audioRequirements']
  if(!validCaptureRequirements(rules))throw Error('assignment.invalid_media_requirements')
  if(!signedAllowedAssignmentMedia(item).includes(kind)
    &&JSON.stringify(rules)!==JSON.stringify(NO_CAPTURE_REQUIREMENTS))
    throw Error('assignment.invalid_media_requirements')
  return rules as CaptureRequirements
}
/** Only after verification of the account-signed policy signature. */
export function signedAdvancedRequirements(
  item:AssignmentListing,kind:'photo'|'video'|'audio',
):AdvancedRules{
  if(item.policyRevision===1)return {...EMPTY_ADVANCED_RULES,allowedCategories:[],requiredTags:[]}
  if(!item.policyAmendmentContract)throw Error('assignment.policy_revision_not_authenticated')
  const edit=JSON.parse(item.policyAmendmentContract) as Record<string,unknown>
  if(edit.version!==6)return {...EMPTY_ADVANCED_RULES,allowedCategories:[],requiredTags:[]}
  const field=kind==='photo'?'photoAdvanced':kind==='video'?'videoAdvanced':'audioAdvanced'
  const result=normalizeAdvancedRules(edit[field],true)
  if(!signedAllowedAssignmentMedia(item).includes(kind)
    &&(result.allowedCategories.length>0||result.requiredTags.length>0))
    throw Error('assignment.rules_for_disabled_type')
  return result
}
function validCaptureRequirements(value:unknown):value is CaptureRequirements{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const r=value as Record<string,unknown>
  return Object.keys(r).join('|')==='requiredCategory|descriptionMinLength|requiredGps'
    &&typeof r.requiredCategory==='boolean'
    &&typeof r.requiredGps==='boolean'
    &&Number.isInteger(r.descriptionMinLength)
    &&(r.descriptionMinLength as number)>=0
    &&(r.descriptionMinLength as number)<=4000
}
export type AssignmentProgressGoals={
  photoGoal:number|null;videoGoal:number|null;audioGoal:number|null
}
function progressGoal(value:unknown,max:number):value is number|null{
  return value===null||(typeof value==='number'&&Number.isInteger(value)
    &&value>=1&&value<=max)
}
/** Server goal columns are merely a display projection of OWNER signed policy.
 * Caller must also verify the signature and monotonic policy snapshot.
 */
export function signedPolicyGoals(item:AssignmentListing):AssignmentProgressGoals{
  const result:AssignmentProgressGoals={
    photoGoal:item.photoGoal,videoGoal:null,audioGoal:null,
  }
  if(!progressGoal(item.photoGoal,9999))throw Error('assignment.invalid_signed_goal')
  if(item.policyRevision===1){
    if((item.videoGoal??null)!==null||(item.audioGoal??null)!==null)
      throw Error('assignment.unsigned_media_goal')
    return result
  }
  if(!item.policyAmendmentContract)throw Error('assignment.policy_revision_not_authenticated')
  const amendment=JSON.parse(item.policyAmendmentContract) as Record<string,unknown>
  if(amendment.version!==4&&amendment.version!==5&&amendment.version!==6){
    if((item.videoGoal??null)!==null||(item.audioGoal??null)!==null)
      throw Error('assignment.unsigned_media_goal')
    return result
  }
  if(!validAllowedMedia(amendment.allowedMedia)
    ||!progressGoal(amendment.videoGoal,999)
    ||!progressGoal(amendment.audioGoal,999)
    ||(amendment.videoGoal!==null&&!amendment.allowedMedia.includes('video'))
    ||(amendment.audioGoal!==null&&!amendment.allowedMedia.includes('audio'))
    ||amendment.photoGoal!==item.photoGoal
    ||amendment.videoGoal!==(item.videoGoal??null)
    ||amendment.audioGoal!==(item.audioGoal??null))
    throw Error('assignment.invalid_signed_goal')
  return {
    photoGoal:item.photoGoal,
    videoGoal:amendment.videoGoal as number|null,
    audioGoal:amendment.audioGoal as number|null,
  }
}

/**
 * An assignment's IMMUTABLE root envelope stays in the original owner
 * signature. Signed private amendments refer to a new AES-GCM ciphertext
 * with the SAME DEK; previously accepted ECDH invitations still work.
 * Caller must authenticate the owner's signature before reading.
 */
export function effectiveAssignmentEnvelope(item:AssignmentListing):AssignmentEnvelope{
  const revision=item.privateRevision??1
  if(revision===1)return item.privateEnvelope
  if(!item.privateAmendmentContract)
    throw Error('assignment.private_revision_not_authenticated')
  const p=JSON.parse(item.privateAmendmentContract) as {
    version:number;privateEnvelope:AssignmentEnvelope
  }
  if(p.version!==2||!p.privateEnvelope)
    throw Error('assignment.invalid_private_revision')
  return p.privateEnvelope
}
export function assignmentPrivateCacheScope(item:AssignmentListing):string{
  return item.privateRevision&&item.privateRevision>1
    ?item.privateAmendmentContract??''
    :item.policyContract
}
function privateEventShape(value:unknown):value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const e=value as Record<string,unknown>
  const keys=[
    'version','operationId','assignmentId','ownerAccountId',
    'rootPrivateHash','previousPrivateHash',
    'fromPrivateRevision','toPrivateRevision','privateEnvelope',
  ]
  return Object.keys(e).sort().join('|')===keys.sort().join('|')
}
function privateEnvelopeShape(value:unknown,root:AssignmentEnvelope):value is AssignmentEnvelope{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const e=value as Record<string,unknown>
  const wrap=e.wrappedKey as Record<string,unknown>|null
  if(!wrap||typeof wrap!=='object'||Array.isArray(wrap))return false
  return Object.keys(e).sort().join('|')==='ciphertext|iv|version|wrappedKey'
    &&e.version===1
    &&Object.keys(wrap).sort().join('|')==='ciphertext|iv'
    &&JSON.stringify(wrap)===JSON.stringify(root.wrappedKey)
    &&typeof e.iv==='string'
    &&/^[A-Za-z0-9_-]{16}$/.test(e.iv)
    &&e.iv!==root.iv
    &&typeof e.ciphertext==='string'
    &&/^[A-Za-z0-9_-]{22,32768}$/.test(e.ciphertext)
    &&e.ciphertext.length<=32000
}
async function verifyPrivateEvent(
  raw:string,signature:string,spki:string,item:AssignmentListing,
  expectedFrom:number,expectedPreviousHash:string,
):Promise<void>{
  let e:Record<string,unknown>
  try{e=JSON.parse(raw) as Record<string,unknown>}
  catch{throw Error('assignment.private_revision_not_authenticated')}
  const rootHash=hex(await digest(new TextEncoder().encode(
    JSON.stringify(item.privateEnvelope))))
  if(!privateEventShape(e)||e.version!==2
    ||e.assignmentId!==item.assignmentId
    ||e.ownerAccountId!==item.ownerAccountId
    ||e.rootPrivateHash!==rootHash
    ||e.previousPrivateHash!==expectedPreviousHash
    ||e.fromPrivateRevision!==expectedFrom
    ||e.toPrivateRevision!==expectedFrom+1
    ||typeof e.operationId!=='string'
    ||!/^[a-f0-9-]{36}$/.test(e.operationId)
    ||!privateEnvelopeShape(e.privateEnvelope,item.privateEnvelope)
    ||JSON.stringify(e)!==raw
    ||!await verify(await importSpki(spki),
      'pb3.assignment-private.v2\n'+raw,signature))
    throw Error('assignment.private_revision_not_authenticated')
}
/** Validated history for fresh, multi-revision new-device account sessions. */
async function verifyPrivateHistory(item:AssignmentListing,spki:string):Promise<void>{
  const rev=item.privateRevision??1
  if(rev===1)return
  const session=requireSession()
  const path='/assignments/v1/'+encodeURIComponent(item.assignmentId)
    +'/private-history'
  const history=await jsonApi<{
    assignmentId:string;privateRevision:number;rootPrivateHash:string
    events:Array<{fromPrivateRevision:number;toPrivateRevision:number
      contractHash:string;contract:string;signature:string;occurredAtMs:number}>
  }>(path)
  assertSame(session)
  const enc=new TextEncoder()
  const rootHash=hex(await digest(enc.encode(JSON.stringify(item.privateEnvelope))))
  if(history.assignmentId!==item.assignmentId
    ||history.privateRevision!==rev||history.rootPrivateHash!==rootHash
    ||!Array.isArray(history.events)||history.events.length!==rev-1)
    throw Error('assignment.private_history_incomplete')
  let previousHash=rootHash
  const nonces=new Set([item.privateEnvelope.iv])
  for(let i=0;i<history.events.length;i++){
    const event=history.events[i]!
    if(event.fromPrivateRevision!==i+1
      ||event.toPrivateRevision!==i+2
      ||!Number.isSafeInteger(event.occurredAtMs)
      ||event.occurredAtMs<1500000000000)
      throw Error('assignment.private_history_invalid')
    const hash=hex(await digest(enc.encode(event.contract)))
    if(event.contractHash!==hash)throw Error('assignment.private_history_invalid')
    await verifyPrivateEvent(event.contract,event.signature,spki,item,
      i+1,previousHash)
    const envelope=(JSON.parse(event.contract) as {
      privateEnvelope:AssignmentEnvelope
    }).privateEnvelope
    if(nonces.has(envelope.iv))throw Error('assignment.private_nonce_reused')
    nonces.add(envelope.iv)
    previousHash=hash
  }
  const latest=history.events.at(-1)!
  if(latest.contract!==item.privateAmendmentContract
    ||latest.signature!==item.privateAmendmentSignature)
    throw Error('assignment.private_history_mismatch')
}

/**
 * Scheduling is independently owner-signed. The signed creation dates are
 * IMMUTABLE: these functions return effective time windows for admission.
 * Root-only legacy assignments retain their historically enforced hard gates.
 * Call only on a listing validated with verifySignedAssignmentPolicy().
 */
export type AssignmentSchedule={
  startsAt:number;endsAt:number|null
  blockBeforeStart:boolean;blockAfterEnd:boolean
}
function validScheduleTime(value:unknown):value is number{
  return typeof value==='number'&&Number.isSafeInteger(value)
    &&value>=1577836800000&&value<=4102444800000
}
export function validAssignmentSchedule(value:AssignmentSchedule):boolean{
  return validScheduleTime(value.startsAt)
    &&(value.endsAt===null
      ||(validScheduleTime(value.endsAt)&&value.endsAt>value.startsAt))
    &&typeof value.blockBeforeStart==='boolean'
    &&typeof value.blockAfterEnd==='boolean'
    &&(value.endsAt!==null||!value.blockAfterEnd)
}
export function signedAssignmentSchedule(item:AssignmentListing):AssignmentSchedule{
  if((item.scheduleRevision??1)===1)return {
    startsAt:item.startsAt,endsAt:item.endsAt,
    blockBeforeStart:true,blockAfterEnd:item.endsAt!==null,
  }
  if(!item.scheduleAmendmentContract)
    throw Error('assignment.schedule_not_authenticated')
  const e=JSON.parse(item.scheduleAmendmentContract) as AssignmentSchedule
  const result={
    startsAt:e.startsAt,endsAt:e.endsAt,
    blockBeforeStart:e.blockBeforeStart,blockAfterEnd:e.blockAfterEnd,
  }
  if(!validAssignmentSchedule(result))
    throw Error('assignment.invalid_signed_schedule')
  return result
}
export function schedulePermitsAt(item:AssignmentListing,at:number):boolean{
  const w=signedAssignmentSchedule(item)
  return (!w.blockBeforeStart||at>=w.startsAt)
    &&(!w.blockAfterEnd||(w.endsAt!==null&&at<w.endsAt))
}
function parseScheduleEvent(raw:string):Record<string,unknown>{
  let e:Record<string,unknown>
  try{e=JSON.parse(raw) as Record<string,unknown>}
  catch{throw Error('assignment.schedule_not_authenticated')}
  if(!e||typeof e!=='object'||Array.isArray(e))
    throw Error('assignment.schedule_not_authenticated')
  const keys=[
    'version','operationId','assignmentId','ownerAccountId',
    'rootPolicyHash','previousScheduleHash','fromScheduleRevision',
    'toScheduleRevision','startsAt','endsAt','blockBeforeStart','blockAfterEnd',
  ]
  if(Object.keys(e).sort().join('|')!==keys.sort().join('|')
    ||JSON.stringify(e)!==raw
    ||typeof e.operationId!=='string'
    ||!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(e.operationId)
    ||!validAssignmentSchedule(e as AssignmentSchedule))
    throw Error('assignment.schedule_not_authenticated')
  return e
}
async function verifyScheduleEvent(
  raw:string,signature:string,spki:string,item:AssignmentListing,
  from:number,previousHash:string,
):Promise<void>{
  const e=parseScheduleEvent(raw)
  const rootHash=hex(await digest(new TextEncoder().encode(item.policyContract)))
  if(e.version!==1||e.assignmentId!==item.assignmentId
    ||e.ownerAccountId!==item.ownerAccountId
    ||e.rootPolicyHash!==rootHash
    ||e.previousScheduleHash!==previousHash
    ||e.fromScheduleRevision!==from||e.toScheduleRevision!==from+1
    ||!await verify(await importSpki(spki),
      'pb3.assignment-schedule.v1\n'+raw,signature))
    throw Error('assignment.schedule_not_authenticated')
}
async function verifyScheduleHistory(item:AssignmentListing,spki:string):Promise<void>{
  const rev=item.scheduleRevision??1
  if(rev===1)return
  const session=requireSession()
  const history=await jsonApi<{
    assignmentId:string;scheduleRevision:number;rootPolicyHash:string
    events:Array<{fromScheduleRevision:number;toScheduleRevision:number
      contractHash:string;contract:string;signature:string;occurredAtMs:number}>
  }>('/assignments/v1/'+encodeURIComponent(item.assignmentId)+'/schedule-history')
  assertSame(session)
  const enc=new TextEncoder()
  const rootHash=hex(await digest(enc.encode(item.policyContract)))
  if(history.assignmentId!==item.assignmentId
    ||history.scheduleRevision!==rev||history.rootPolicyHash!==rootHash
    ||!Array.isArray(history.events)||history.events.length!==rev-1)
    throw Error('assignment.schedule_history_incomplete')
  let previousHash=rootHash
  for(let i=0;i<history.events.length;i++){
    const event=history.events[i]!
    if(event.fromScheduleRevision!==i+1
      ||event.toScheduleRevision!==i+2
      ||!Number.isSafeInteger(event.occurredAtMs)
      ||event.occurredAtMs<1577836800000)
      throw Error('assignment.schedule_history_invalid')
    const hash=hex(await digest(enc.encode(event.contract)))
    if(event.contractHash!==hash)throw Error('assignment.schedule_history_invalid')
    await verifyScheduleEvent(event.contract,event.signature,spki,item,
      i+1,previousHash)
    previousHash=hash
  }
  const latest=history.events.at(-1)!
  if(latest.contract!==item.scheduleAmendmentContract
    ||latest.signature!==item.scheduleAmendmentSignature)
    throw Error('assignment.schedule_history_mismatch')
}

/**
 * Assignment-scoped retention is NOT physical file deletion.
 * Captured objects remain owned by the contributor and retain their
 * independently signed TTL and recipients. This contract hides only
 * assignment associations and prevents assignment-specific new grants.
 */
export type AssignmentRetention={
  filesAccessUntil:number|null
  assignmentAccessUntil:number|null
  deleteOriginals:false
}
export function validAssignmentRetention(value:AssignmentRetention):boolean{
  return (value.filesAccessUntil===null||validScheduleTime(value.filesAccessUntil))
    &&(value.assignmentAccessUntil===null||validScheduleTime(value.assignmentAccessUntil))
    &&value.deleteOriginals===false
    &&(value.filesAccessUntil===null||value.assignmentAccessUntil===null
      ||value.assignmentAccessUntil>=value.filesAccessUntil)
}
export function signedAssignmentRetention(item:AssignmentListing):AssignmentRetention{
  if((item.retentionRevision??1)===1)return {
    filesAccessUntil:null,assignmentAccessUntil:null,deleteOriginals:false,
  }
  if(!item.retentionAmendmentContract)
    throw Error('assignment.retention_not_authenticated')
  const e=JSON.parse(item.retentionAmendmentContract) as AssignmentRetention
  const value={
    filesAccessUntil:e.filesAccessUntil,
    assignmentAccessUntil:e.assignmentAccessUntil,
    deleteOriginals:e.deleteOriginals,
  }
  if(!validAssignmentRetention(value))
    throw Error('assignment.invalid_signed_retention')
  return value
}
export function assignmentOpenAt(item:AssignmentListing,at:number):boolean{
  const r=signedAssignmentRetention(item)
  return r.assignmentAccessUntil===null||at<r.assignmentAccessUntil
}
export function assignmentFilesOpenAt(item:AssignmentListing,at:number):boolean{
  const r=signedAssignmentRetention(item)
  return assignmentOpenAt(item,at)
    &&(r.filesAccessUntil===null||at<r.filesAccessUntil)
}
/** Signer-verified maximum expiry of new Fieldwork-only E2EE recipient grants. */
export function assignmentGrantExpiryCap(item:AssignmentListing):number|null{
  const r=signedAssignmentRetention(item)
  const dates=[r.filesAccessUntil,r.assignmentAccessUntil]
    .filter((value):value is number=>value!==null)
  return dates.length?Math.min(...dates):null
}
function parseRetentionEvent(raw:string):Record<string,unknown>{
  let e:Record<string,unknown>
  try{e=JSON.parse(raw) as Record<string,unknown>}
  catch{throw Error('assignment.retention_not_authenticated')}
  if(!e||typeof e!=='object'||Array.isArray(e))
    throw Error('assignment.retention_not_authenticated')
  const keys=[
    'version','operationId','assignmentId','ownerAccountId',
    'rootPolicyHash','previousRetentionHash',
    'fromRetentionRevision','toRetentionRevision',
    'filesAccessUntil','assignmentAccessUntil','deleteOriginals',
  ]
  if(Object.keys(e).sort().join('|')!==keys.sort().join('|')
    ||JSON.stringify(e)!==raw
    ||typeof e.operationId!=='string'
    ||!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(e.operationId)
    ||!validAssignmentRetention(e as AssignmentRetention))
    throw Error('assignment.retention_not_authenticated')
  return e
}
async function verifyRetentionEvent(
  raw:string,signature:string,spki:string,item:AssignmentListing,
  from:number,previousHash:string,
):Promise<void>{
  const e=parseRetentionEvent(raw)
  const rootHash=hex(await digest(new TextEncoder().encode(item.policyContract)))
  if(e.version!==1||e.assignmentId!==item.assignmentId
    ||e.ownerAccountId!==item.ownerAccountId
    ||e.rootPolicyHash!==rootHash
    ||e.previousRetentionHash!==previousHash
    ||e.fromRetentionRevision!==from
    ||e.toRetentionRevision!==from+1
    ||!await verify(await importSpki(spki),
      'pb3.assignment-retention.v1\n'+raw,signature))
    throw Error('assignment.retention_not_authenticated')
}
async function verifyRetentionHistory(item:AssignmentListing,spki:string):Promise<void>{
  const rev=item.retentionRevision??1
  if(rev===1)return
  const session=requireSession()
  const history=await jsonApi<{
    assignmentId:string;retentionRevision:number;rootPolicyHash:string
    events:Array<{fromRetentionRevision:number;toRetentionRevision:number
      contractHash:string;contract:string;signature:string;occurredAtMs:number}>
  }>('/assignments/v1/'+encodeURIComponent(item.assignmentId)+'/retention-history')
  assertSame(session)
  const encoder=new TextEncoder()
  const rootHash=hex(await digest(encoder.encode(item.policyContract)))
  if(history.assignmentId!==item.assignmentId
    ||history.retentionRevision!==rev||history.rootPolicyHash!==rootHash
    ||!Array.isArray(history.events)||history.events.length!==rev-1)
    throw Error('assignment.retention_history_incomplete')
  let previousHash=rootHash
  for(let i=0;i<history.events.length;i++){
    const event=history.events[i]!
    if(event.fromRetentionRevision!==i+1
      ||event.toRetentionRevision!==i+2
      ||!Number.isSafeInteger(event.occurredAtMs)
      ||event.occurredAtMs<1577836800000)
      throw Error('assignment.retention_history_invalid')
    const hash=hex(await digest(encoder.encode(event.contract)))
    if(event.contractHash!==hash)throw Error('assignment.retention_history_invalid')
    await verifyRetentionEvent(event.contract,event.signature,spki,item,
      i+1,previousHash)
    previousHash=hash
  }
  const latest=history.events.at(-1)!
  if(latest.contract!==item.retentionAmendmentContract
    ||latest.signature!==item.retentionAmendmentSignature)
    throw Error('assignment.retention_history_mismatch')
}

class AssignmentDB extends Dexie {
  operations!:Table<AssignmentOperation,string>
  assignments!:Table<LocalAssignment,string>
  invites!:Table<CachedInvite,string>
  capturePolicies!:Table<CachedCapturePolicy,string>
  privateSummaries!:Table<CachedPrivateAssignment,string>
  revocations!:Table<CachedVerifiedRemoval,string>
  constructor(){
    super('pb3-assignment-operation-outbox-v1')
    this.version(1).stores({
      operations:'&id, accountId, [accountId+createdAt], [accountId+state]',
      assignments:'&id, ownerAccountId, [ownerAccountId+createdAt]',
      invites:'&inviteId, assignmentId, ownerAccountId, cachedForAccountId',
    })
    this.version(2).stores({
      operations:'&id, accountId, [accountId+createdAt], [accountId+state]',
      assignments:'&id, ownerAccountId, [ownerAccountId+createdAt]',
      invites:'&inviteId, assignmentId, ownerAccountId, cachedForAccountId',
      capturePolicies:'&key, accountId, [accountId+verifiedAt]',
    })
    this.version(3).stores({
      operations:'&id, accountId, [accountId+createdAt], [accountId+state]',
      assignments:'&id, ownerAccountId, [ownerAccountId+createdAt]',
      invites:'&inviteId, assignmentId, ownerAccountId, cachedForAccountId',
      capturePolicies:'&key, accountId, [accountId+verifiedAt]',
      privateSummaries:'&key, accountId, assignmentId',
    })
    this.version(4).stores({
      operations:'&id, accountId, [accountId+createdAt], [accountId+state]',
      assignments:'&id, ownerAccountId, [ownerAccountId+createdAt]',
      invites:'&inviteId, assignmentId, ownerAccountId, cachedForAccountId',
      capturePolicies:'&key, accountId, [accountId+verifiedAt]',
      privateSummaries:'&key, accountId, assignmentId',
      revocations:'&key, accountId, assignmentId',
    })
  }
}
const db=new AssignmentDB()

function assertSame(s:ReturnType<typeof requireSession>):void {
  if(activeSession.value!==s)throw new Error('identity.changed')
}
function domain(kind:AssignmentOperationKind):string{
  const signedDomains:Record<AssignmentOperationKind,string>={
    create:'pb3.assignment.v1\n',
    invite:'pb3.assignment-invite.v1\n',
    accept:'pb3.assignment-accept.v1\n',
    'remove-member':'pb3.assignment-member-remove.v1\n',
    submit:'pb3.assignment-submit.v1\n',
    'media-submit':'pb3.assignment-media-submit.v1\n',
    state:'pb3.assignment-state.v1\n',
    policy:'pb3.assignment-policy.v1\n',
    private:'pb3.assignment-private.v2\n',
    schedule:'pb3.assignment-schedule.v1\n',
    retention:'pb3.assignment-retention.v1\n',
  }
  return signedDomains[kind]
}

async function signedOperation(
  kind:AssignmentOperationKind,path:string,payload:Record<string,unknown>,
  requirementGrantId?:string,
):Promise<AssignmentOperation>{
  const s=requireSession()
  const contract=JSON.stringify(payload)
  const signingDomain=kind==='media-submit'&&payload.version===3
    ?'pb3.assignment-media-submit.v3\n'
    :kind==='media-submit'&&payload.version===2
    ?'pb3.assignment-media-submit.v2\n'
    :kind==='policy'&&payload.version===6
      ?'pb3.assignment-policy.v6\n'
      :kind==='policy'&&payload.version===5
      ?'pb3.assignment-policy.v5\n'
      :kind==='policy'&&payload.version===4
      ?'pb3.assignment-policy.v4\n'
      :kind==='policy'&&payload.version===3
      ?'pb3.assignment-policy.v3\n'
      :kind==='policy'&&payload.version===2
      ?'pb3.assignment-policy.v2\n':domain(kind)
  const signature=await sign(await importSigner(s.pkg.accountPkcs8),signingDomain+contract)
  assertSame(s)
  return {
    id:crypto.randomUUID(),accountId:s.accountId,kind,path,
    contract,signature,state:'queued',createdAt:Date.now(),
    prerequisiteGrantId:requirementGrantId,
  }
}
async function persist(op:AssignmentOperation):Promise<void>{
  if(requireSession().accountId!==op.accountId)throw new Error('identity.changed')
  await db.operations.put(op)
  void flushAssignmentOutbox()
}

export async function queueAssignmentCreation(input:{
  title:string;instructions:string;photoGoal:number|null;endsAt?:number|null
}):Promise<string>{
  const s=requireSession()
  if(input.photoGoal!==null&&(!Number.isInteger(input.photoGoal)
    ||input.photoGoal<1||input.photoGoal>9999))throw Error('assignment.invalid_goal')
  const id=crypto.randomUUID(),operationId=crypto.randomUUID()
  const startsAt=Date.now(),endsAt=input.endsAt??null
  const data:PrivateAssignment={
    version:1,title:input.title.trim(),instructions:input.instructions,
  }
  const privateEnvelope=await sealAssignment(s.pkg,id,data)
  const payload={
    version:1,assignmentId:id,operationId,ownerAccountId:s.accountId,
    revision:1,policyRevision:1,state:'active',
    startsAt,endsAt,photoGoal:input.photoGoal,
    allowedMedia:['photo'],privateEnvelope,
  }
  const op=await signedOperation('create','/assignments/v1',payload)
  assertSame(s)
  await db.transaction('rw',db.assignments,db.operations,async()=>{
    await db.assignments.put({
      id,ownerAccountId:s.accountId,createdAt:startsAt,
      state:'queued',privateEnvelope,photoGoal:input.photoGoal,
      startsAt,endsAt,
    })
    await db.operations.put(op)
  })
  void flushAssignmentOutbox()
  return id
}

export async function listLocalAssignmentDrafts():Promise<LocalAssignment[]> {
  const s=requireSession()
  return db.assignments.where('ownerAccountId').equals(s.accountId).toArray()
}

/**
 * Do not use server-declared assignment capture restrictions until the
 * immutable owner-root-signed creation policy has been authenticated.
 * For another account, the public key must already have been pinned via
 * independent first-contact fingerprint verification.
 */
export async function verifySignedAssignmentPolicy(
  item:AssignmentListing,cachedOnly=false,
):Promise<void>{
  const s=requireSession()
  // A count is server-derived from authorized, finalized receipts, NOT part
  // of the immutable owner signature and not a client ACL/crypto input.
  if(!Number.isSafeInteger(item.confirmedPhotoCount)
    ||item.confirmedPhotoCount<0)throw new Error('assignment.invalid_receipt_count')
  const trustedSpki=item.ownerAccountId===s.accountId
    ?s.pkg.accountSpki
    :(await pinnedPeer(item.ownerAccountId,!cachedOnly)).accountSpki
  if(!trustedSpki||item.ownerAccountSpki!==trustedSpki
    ||!await verify(await importSpki(trustedSpki),
      'pb3.assignment.v1\n'+item.policyContract,item.policySignature)){
    throw new Error('assignment.untrusted_capture_policy')
  }
  let c:Record<string,unknown>
  try{c=JSON.parse(item.policyContract) as Record<string,unknown>}
  catch{throw new Error('assignment.invalid_capture_policy')}
  // The owner's immutable creation policy never changes when an assignment
  // is finished/resumed. Its current state MUST have a second signed command.
  if(c.version!==1||c.assignmentId!==item.assignmentId
    ||c.ownerAccountId!==item.ownerAccountId||c.state!=='active'
    ||c.revision!==1||c.policyRevision!==1
    ||c.startsAt!==item.startsAt
    ||c.endsAt!==item.endsAt||!Array.isArray(c.allowedMedia)
    ||c.allowedMedia.length!==1||c.allowedMedia[0]!=='photo'
    ||JSON.stringify(c.privateEnvelope)!==JSON.stringify(item.privateEnvelope)){
    throw new Error('assignment.policy_snapshot_mismatch')
  }
  const originalHash=hex(await digest(new TextEncoder().encode(item.policyContract)))
  if(!Number.isInteger(item.policyRevision)||item.policyRevision<1
    ||item.policyRevision>1001)throw new Error('assignment.invalid_policy_revision')
  if(item.policyRevision===1){
    signedPolicyGoals(item)
    if(item.photoGoal!==c.photoGoal||item.policyAmendmentContract!=null
      ||item.policyAmendmentSignature!=null)
      throw new Error('assignment.policy_snapshot_mismatch')
  }else{
    if(typeof item.policyAmendmentContract!=='string'
      ||typeof item.policyAmendmentSignature!=='string')
      throw new Error('assignment.policy_revision_not_authenticated')
    let edit:Record<string,unknown>
    try{edit=JSON.parse(item.policyAmendmentContract) as Record<string,unknown>}
    catch{throw new Error('assignment.invalid_policy_revision')}
    const type=edit.version
    if(type!==1&&type!==2&&type!==3&&type!==4&&type!==5&&type!==6)throw Error('assignment.invalid_policy_revision')
    const expected=[
      'version','operationId','assignmentId','ownerAccountId',
      'rootPolicyHash','previousPolicyHash','fromPolicyRevision',
      'toPolicyRevision','photoGoal','allowedMedia',
      ...(type>=2?['requiredCategory','descriptionMinLength','requiredGps']:[]),
      ...(type>=4?['videoGoal','audioGoal']:[]),
      ...(type>=5?['videoRequirements','audioRequirements']:[]),
      ...(type===6?['photoAdvanced','videoAdvanced','audioAdvanced']:[]),
    ]
    if(Object.keys(edit).sort().join('|')!==expected.sort().join('|')
      ||!await verify(await importSpki(trustedSpki),
        (type===6?'pb3.assignment-policy.v6\n'
          :type===5?'pb3.assignment-policy.v5\n'
          :type===4?'pb3.assignment-policy.v4\n'
          :type===3?'pb3.assignment-policy.v3\n'
          :type===2?'pb3.assignment-policy.v2\n':domain('policy'))
          +item.policyAmendmentContract,
        item.policyAmendmentSignature))
      throw new Error('assignment.policy_revision_not_authenticated')
    if(edit.assignmentId!==item.assignmentId
      ||edit.ownerAccountId!==item.ownerAccountId
      ||edit.rootPolicyHash!==originalHash
      ||edit.toPolicyRevision!==item.policyRevision
      ||edit.fromPolicyRevision!==item.policyRevision-1
      ||(type>=3?!validAllowedMedia(edit.allowedMedia)
        :JSON.stringify(edit.allowedMedia)!==JSON.stringify(['photo']))
      ||edit.photoGoal!==item.photoGoal
      ||typeof edit.previousPolicyHash!=='string'
      ||!/^[a-f0-9]{64}$/.test(edit.previousPolicyHash))
      throw new Error('assignment.policy_revision_mismatch')
    signedPolicyRequirements(item) // hard-fail invalid signed v2-v4 flags
    signedAllowedAssignmentMedia(item)
    signedPolicyGoals(item) // reject spoofed per-kind server columns
    signedMediaRequirements(item,'video')
    signedMediaRequirements(item,'audio')
    signedAdvancedRequirements(item,'photo')
    signedAdvancedRequirements(item,'video')
    signedAdvancedRequirements(item,'audio')
  }
  const privateRevision=item.privateRevision??1
  if(!Number.isInteger(privateRevision)||privateRevision<1||privateRevision>1001)
    throw Error('assignment.invalid_private_revision')
  if(privateRevision===1){
    if(item.privateAmendmentContract!=null||item.privateAmendmentSignature!=null)
      throw Error('assignment.private_revision_not_authenticated')
  }else{
    if(typeof item.privateAmendmentContract!=='string'
      ||typeof item.privateAmendmentSignature!=='string')
      throw Error('assignment.private_revision_not_authenticated')
    const amendment=JSON.parse(item.privateAmendmentContract) as Record<string,unknown>
    const rootHash=hex(await digest(new TextEncoder().encode(
      JSON.stringify(item.privateEnvelope))))
    const previousHash=privateRevision===2?rootHash:amendment.previousPrivateHash
    if(typeof previousHash!=='string'||!/^[a-f0-9]{64}$/.test(previousHash))
      throw Error('assignment.private_revision_not_authenticated')
    await verifyPrivateEvent(item.privateAmendmentContract,
      item.privateAmendmentSignature,trustedSpki,item,
      privateRevision-1,previousHash)
  }
  const scheduleRevision=item.scheduleRevision??1
  if(!Number.isInteger(scheduleRevision)
    ||scheduleRevision<1||scheduleRevision>1001)
    throw Error('assignment.invalid_schedule_revision')
  if(scheduleRevision===1){
    if(item.scheduleAmendmentContract!=null
      ||item.scheduleAmendmentSignature!=null)
      throw Error('assignment.schedule_not_authenticated')
  }else{
    if(typeof item.scheduleAmendmentContract!=='string'
      ||typeof item.scheduleAmendmentSignature!=='string')
      throw Error('assignment.schedule_not_authenticated')
    const amendment=parseScheduleEvent(item.scheduleAmendmentContract)
    const rootHash=hex(await digest(new TextEncoder().encode(item.policyContract)))
    const prevHash=scheduleRevision===2?rootHash:amendment.previousScheduleHash
    if(typeof prevHash!=='string'||!/^[a-f0-9]{64}$/.test(prevHash))
      throw Error('assignment.schedule_not_authenticated')
    await verifyScheduleEvent(item.scheduleAmendmentContract,
      item.scheduleAmendmentSignature,trustedSpki,item,
      scheduleRevision-1,prevHash)
  }
  const retentionRevision=item.retentionRevision??1
  if(!Number.isInteger(retentionRevision)||retentionRevision<1
    ||retentionRevision>1001)
    throw Error('assignment.invalid_retention_revision')
  if(retentionRevision===1){
    if(item.retentionAmendmentContract!=null
      ||item.retentionAmendmentSignature!=null
      ||(item.filesAccessUntil??null)!==null
      ||(item.assignmentAccessUntil??null)!==null)
      throw Error('assignment.retention_not_authenticated')
  }else{
    if(typeof item.retentionAmendmentContract!=='string'
      ||typeof item.retentionAmendmentSignature!=='string')
      throw Error('assignment.retention_not_authenticated')
    const edit=parseRetentionEvent(item.retentionAmendmentContract)
    const rootHash=hex(await digest(new TextEncoder().encode(item.policyContract)))
    const prevHash=retentionRevision===2?rootHash:edit.previousRetentionHash
    if(typeof prevHash!=='string'||!/^[a-f0-9]{64}$/.test(prevHash))
      throw Error('assignment.retention_not_authenticated')
    await verifyRetentionEvent(item.retentionAmendmentContract,
      item.retentionAmendmentSignature,trustedSpki,item,
      retentionRevision-1,prevHash)
    const effective=signedAssignmentRetention(item)
    if(effective.filesAccessUntil!==(item.filesAccessUntil??null)
      ||effective.assignmentAccessUntil!==(item.assignmentAccessUntil??null))
      throw Error('assignment.retention_projection_mismatch')
    if(effective.filesAccessUntil!==null
      &&effective.assignmentAccessUntil!==null
      &&effective.assignmentAccessUntil<effective.filesAccessUntil)
      throw Error('assignment.invalid_signed_retention')
  }
  if(item.revision===1){
    if(item.state!=='active'||item.stateContract!==null
      ||item.stateSignature!==null)throw new Error('assignment.state_not_authenticated')
  }else{
    if(!Number.isInteger(item.revision)||item.revision<2
      ||typeof item.stateContract!=='string'
      ||typeof item.stateSignature!=='string'
      ||!await verify(await importSpki(trustedSpki),
        'pb3.assignment-state.v1\n'+item.stateContract,item.stateSignature)){
      throw new Error('assignment.state_not_authenticated')
    }
    let transition:Record<string,unknown>
    try{transition=JSON.parse(item.stateContract) as Record<string,unknown>}
    catch{throw new Error('assignment.state_not_authenticated')}
    const hash=hex(await digest(new TextEncoder().encode(item.policyContract)))
    if(transition.version!==1||transition.assignmentId!==item.assignmentId
      ||transition.ownerAccountId!==item.ownerAccountId
      ||transition.policyHash!==hash
      ||transition.policyRevision!==1
      ||transition.fromRevision!==item.revision-1
      ||transition.toRevision!==item.revision
      ||!((transition.action==='finish'&&transition.state==='finished')
        ||(transition.action==='resume'&&transition.state==='active'))
      ||transition.state!==item.state){
      throw new Error('assignment.state_snapshot_mismatch')
    }
  }
  assertSame(s)
}

/**
 * A correctly signed but stale state is still dangerous: a malicious/stale API
 * could replay a previously valid "active" snapshot after a signed finish.
 * Preserve the highest locally authenticated revision per account.
 */
export function assertSignedPolicyProgress(
  previous:AssignmentListing|undefined,next:AssignmentListing,
):void{
  if(!previous)return
  if(previous.policyContract!==next.policyContract
    ||previous.policySignature!==next.policySignature)
    throw new Error('assignment.original_policy_changed')
  if(next.revision<previous.revision)
    throw new Error('assignment.state_rollback')
  if((next.retentionRevision??1)<(previous.retentionRevision??1))
    throw Error('assignment.retention_rollback')
  if((next.retentionRevision??1)===(previous.retentionRevision??1)
    &&((next.retentionAmendmentContract??null)!==(previous.retentionAmendmentContract??null)
      ||(next.retentionAmendmentSignature??null)!==(previous.retentionAmendmentSignature??null)
      ||(next.filesAccessUntil??null)!==(previous.filesAccessUntil??null)
      ||(next.assignmentAccessUntil??null)!==(previous.assignmentAccessUntil??null)))
    throw Error('assignment.retention_equivocation')
  if((next.scheduleRevision??1)<(previous.scheduleRevision??1))
    throw Error('assignment.schedule_rollback')
  if((next.scheduleRevision??1)===(previous.scheduleRevision??1)
    &&((next.scheduleAmendmentContract??null)!==(previous.scheduleAmendmentContract??null)
      ||(next.scheduleAmendmentSignature??null)!==(previous.scheduleAmendmentSignature??null)))
    throw Error('assignment.schedule_equivocation')
  if(JSON.stringify(next.privateEnvelope)!==JSON.stringify(previous.privateEnvelope))
    throw Error('assignment.original_private_envelope_changed')
  if((next.privateRevision??1)<(previous.privateRevision??1))
    throw Error('assignment.private_rollback')
  if((next.privateRevision??1)===(previous.privateRevision??1)
    &&((next.privateAmendmentContract??null)!==(previous.privateAmendmentContract??null)
      ||(next.privateAmendmentSignature??null)!==(previous.privateAmendmentSignature??null)))
    throw Error('assignment.private_equivocation')
  if(next.policyRevision<previous.policyRevision)
    throw new Error('assignment.policy_rollback')
  if(next.policyRevision===previous.policyRevision
    &&(next.photoGoal!==previous.photoGoal
      ||(next.videoGoal??null)!==(previous.videoGoal??null)
      ||(next.audioGoal??null)!==(previous.audioGoal??null)
      ||next.policyAmendmentContract!==previous.policyAmendmentContract
      ||next.policyAmendmentSignature!==previous.policyAmendmentSignature))
    throw new Error('assignment.policy_equivocation')
  if(next.revision===previous.revision
    &&(next.state!==previous.state
      ||next.stateContract!==previous.stateContract
      ||next.stateSignature!==previous.stateSignature))
    throw new Error('assignment.state_equivocation')
}

export type AssignmentMonthlyUsage={
  planId:'free';catalogVersion:string
  periodStart:string;periodEnd:string
  limit:number;used:number;remaining:number
}
/**
 * Current server-authoritative account quota; it is informational only.
 * Local encrypted assignment drafts are never blocked or dropped offline.
 * Actual admission runs atomically in the backend on signed create.
 */
export async function listServerAssignmentUsage():Promise<AssignmentMonthlyUsage>{
  const session=requireSession()
  if(!session.online)throw Error('assignment.offline')
  const usage=await jsonApi<AssignmentMonthlyUsage>('/assignments/v1/usage')
  assertSame(session)
  if(usage.planId!=='free'
    ||!Number.isSafeInteger(usage.limit)||usage.limit<0
    ||!Number.isSafeInteger(usage.used)||usage.used<0
    ||!Number.isSafeInteger(usage.remaining)||usage.remaining<0
    ||usage.remaining!==Math.max(0,usage.limit-usage.used)
    ||!Number.isFinite(Date.parse(usage.periodEnd))
    ||!Number.isFinite(Date.parse(usage.periodStart))
    ||Date.parse(usage.periodEnd)<=Date.parse(usage.periodStart)
    ||typeof usage.catalogVersion!=='string'||!usage.catalogVersion)
    throw Error('assignment.usage_invalid')
  return usage
}

export async function listServerAssignments(after?:string):Promise<{
  items:AssignmentListing[];nextCursor:string|null
}>{
  const s=requireSession()
  if(!s.online)throw new Error('assignment.offline')
  const q=after?'?after='+encodeURIComponent(after):''
  const result=await jsonApi<{items:AssignmentListing[];nextCursor:string|null}>(
    '/assignments/v1'+q)
  assertSame(s)
  for(const item of result.items){
    await verifySignedAssignmentPolicy(item)
    if((item.privateRevision??1)>1){
      const trustedSpki=item.ownerAccountId===s.accountId
        ?s.pkg.accountSpki:(await pinnedPeer(item.ownerAccountId)).accountSpki
      await verifyPrivateHistory(item,trustedSpki)
    }
    if((item.scheduleRevision??1)>1){
      const trustedSpki=item.ownerAccountId===s.accountId
        ?s.pkg.accountSpki:(await pinnedPeer(item.ownerAccountId)).accountSpki
      await verifyScheduleHistory(item,trustedSpki)
    }
    if((item.retentionRevision??1)>1){
      const trustedSpki=item.ownerAccountId===s.accountId
        ?s.pkg.accountSpki:(await pinnedPeer(item.ownerAccountId)).accountSpki
      await verifyRetentionHistory(item,trustedSpki)
    }
  }
  assertSame(s)
  // Cache only signed, independently authenticated policy snapshots.
  // No plaintext assignment name, DEK or recovery material is persisted.
  await db.transaction('rw',db.capturePolicies,db.revocations,async()=>{
    for(const item of result.items){
      const key=s.accountId+'/'+item.assignmentId
      // A previously authenticated owner-signed exclusion is stronger
      // than a later stale server overview snapshot.
      if(await db.revocations.get(key))continue
      const previous=await db.capturePolicies.get(key)
      assertSignedPolicyProgress(previous?.listing,item)
      await db.capturePolicies.put({
        key,accountId:s.accountId,
        listing:item,verifiedAt:Date.now(),
      })
    }
  })
  assertSame(s)
  return result
}

/**
 * Owner and contributor overview: fetch every authenticated, signed server
 * page instead of silently hiding all assignments past the first 50.
 * Keep each exact source policy's existing independent verification.
 */
export async function listAllServerAssignments():Promise<AssignmentListing[]>{
  const session=requireSession()
  let items:AssignmentListing[]=[]
  let after:string|null=null
  for(let n=0;n<100;n++){
    const page=await listServerAssignments(after??undefined)
    assertSame(session)
    const next:{items:AssignmentListing[];nextCursor:string|null}=
      appendBoundedUuidPage(items,page,after,item=>item.assignmentId)
    items=next.items
    if(next.nextCursor===null){
      const revoked=await db.revocations.where('accountId')
        .equals(session.accountId).toArray()
      assertSame(session)
      const denied=new Set(revoked.map(r=>r.assignmentId))
      return items.filter(row=>row.ownerAccountId===session.accountId
        ||!denied.has(row.assignmentId))
    }
    after=next.nextCursor
  }
  throw Error('assignment.overview_pagination_limit')
}

/**
 * A previously verified policy can be read offline for local-only capture.
 * A server can still reject a later upload if membership or state changed.
 */
export async function listCachedAssignmentSnapshots():Promise<AssignmentListing[]>{
  const s=requireSession()
  const [rows,removed]=await Promise.all([
    db.capturePolicies.where('accountId').equals(s.accountId).toArray(),
    db.revocations.where('accountId').equals(s.accountId).toArray(),
  ])
  const revoked=new Set(removed.map(x=>x.assignmentId))
  const verified:AssignmentListing[]=[]
  for(const row of rows){
    assertSame(s)
    if(revoked.has(row.listing.assignmentId))continue
    try{
      await verifySignedAssignmentPolicy(row.listing,true)
      if(assignmentOpenAt(row.listing,Date.now()))
        verified.push(row.listing)
    }catch{/* A stale/corrupt/unpinned server snapshot grants no authority. */}
  }
  assertSame(s)
  // These are historical signed snapshots, NOT fresh server ACL or receipts.
  return verified
}

export async function listVerifiedCapturePolicies():Promise<AssignmentListing[]>{
  const rows=await listCachedAssignmentSnapshots()
  return rows.filter(item=>item.state==='active'
    &&assignmentFilesOpenAt(item,Date.now())
    &&schedulePermitsAt(item,Date.now()))
}

export async function signedCaptureBinding(
  assignmentId:string,capturedAt=Date.now(),
  privateFields:CaptureMetadataInput={},
):Promise<SignedCaptureBinding>{
  const s=requireSession()
  const key=s.accountId+'/'+assignmentId
  if(await db.revocations.get(key))throw Error('assignment.member_removed')
  const row=await db.capturePolicies.get(key)
  if(!row)throw new Error('assignment.policy_not_cached')
  const policy=row.listing
  // Capture is deliberately Local-First. Recheck the cached owner signature
  // against the independently pinned local key, not a live key-directory
  // request that can fail during an API outage.
  await verifySignedAssignmentPolicy(policy,true)
  if(policy.state!=='active'
    ||!assignmentFilesOpenAt(policy,Date.now())
    ||!assignmentFilesOpenAt(policy,capturedAt)
    ||!schedulePermitsAt(policy,capturedAt)) {
    throw new Error('assignment.capture_not_permitted')
  }
  // Enforce authenticated requirements before creating any ciphertext.
  // The backend cannot inspect private GPS/category/description bytes, and
  // does not claim to prove that a compromised client obeyed these rules.
  const meta=preparePhotoMetadata(capturedAt,undefined,privateFields)
  const rules=signedPolicyRequirements(policy)
  if(rules.requiredCategory&&!meta.category)
    throw Error('assignment.category_required')
  if(rules.descriptionMinLength>0
    &&(meta.description?.length??0)<rules.descriptionMinLength)
    throw Error('assignment.description_too_short')
  if(rules.requiredGps&&!meta.gps)
    throw Error('assignment.gps_required')
  validateAdvancedFields(meta,signedAdvancedRequirements(policy,'photo'))
  const effectiveContract=policy.policyRevision===1
    ?policy.policyContract:policy.policyAmendmentContract
  if(!effectiveContract)throw new Error('assignment.policy_revision_not_authenticated')
  const policyHash=hex(await digest(new TextEncoder().encode(effectiveContract)))
  assertSame(s)
  return {
    assignmentId:policy.assignmentId,ownerAccountId:policy.ownerAccountId,
    policyRevision:policy.policyRevision,policyHash,capturedAt,
  }
}

const summaryEncoder=new TextEncoder()
function summaryContext(accountId:string,assignmentId:string,policyHash:string):Uint8Array<ArrayBuffer>{
  return summaryEncoder.encode('pb3.assignment-cached-summary.v1\n'
    +accountId+'\n'+assignmentId+'\n'+policyHash)
}
function checkSummary(data:PrivateAssignment):void{
  try{validatePrivateAssignment(data)}
  catch{throw Error('assignment.invalid_cached_summary')}
}
async function summaryKey(
  s:ReturnType<typeof requireSession>,usage:'encrypt'|'decrypt',
):Promise<CryptoKey>{
  const raw=unb64(s.pkg.akek,32)
  try{return await crypto.subtle.importKey('raw',raw,
    {name:'AES-GCM'},false,[usage])}
  finally{raw.fill(0)}
}
/**
 * Cache ONLY an already-verified/decrypted assignment title/instructions as
 * separate account-AKEK-encrypted ciphertext; never persist plaintext or raw
 * assignment DEK. The signed policy hash is authenticated as AES-GCM AAD.
 */
export async function cachePrivateAssignment(
  assignmentId:string,policyContract:string,data:PrivateAssignment,
):Promise<void>{
  const s=requireSession()
  checkSummary(data)
  const policyHash=hex(await digest(summaryEncoder.encode(policyContract)))
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const key=await summaryKey(s,'encrypt')
  const encrypted=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,
    additionalData:summaryContext(s.accountId,assignmentId,policyHash),tagLength:128,
  },key,summaryEncoder.encode(JSON.stringify(data)))
  assertSame(s)
  await db.privateSummaries.put({
    key:s.accountId+'/'+assignmentId,accountId:s.accountId,
    assignmentId,policyHash,iv:b64(iv),ciphertext:new Blob([encrypted]),
  })
  assertSame(s)
}
export async function readCachedPrivateAssignment(
  assignmentId:string,policyContract:string,
):Promise<PrivateAssignment|null>{
  const s=requireSession()
  const row=await db.privateSummaries.get(s.accountId+'/'+assignmentId)
  if(!row)return null
  const policyHash=hex(await digest(summaryEncoder.encode(policyContract)))
  if(row.accountId!==s.accountId||row.assignmentId!==assignmentId
    ||row.policyHash!==policyHash)return null
  const key=await summaryKey(s,'decrypt')
  const decrypted=await crypto.subtle.decrypt({
    name:'AES-GCM',iv:unb64(row.iv,12),
    additionalData:summaryContext(s.accountId,assignmentId,policyHash),tagLength:128,
  },key,await row.ciphertext.arrayBuffer())
  assertSame(s)
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decrypted)) as PrivateAssignment
  checkSummary(data)
  return data
}

/**
 * Owner-root-signed edits affect only the target count. Historical capture
 * contracts stay immutable and are evaluated by the server at capture time.
 */
export async function queueAssignmentPolicyChange(
  assignmentId:string,
  next:{photoGoal:number|null;videoGoal?:number|null;audioGoal?:number|null;
    allowedMedia?:AllowedAssignmentMedia
    videoRequirements?:CaptureRequirements;audioRequirements?:CaptureRequirements
    photoAdvanced?:AdvancedRules;videoAdvanced?:AdvancedRules;audioAdvanced?:AdvancedRules
  }&CaptureRequirements,
):Promise<string>{
  const s=requireSession()
  const {photoGoal,requiredCategory,descriptionMinLength,requiredGps}=next
  if(!progressGoal(photoGoal,9999)
    ||(next.videoGoal!==undefined&&!progressGoal(next.videoGoal,999))
    ||(next.audioGoal!==undefined&&!progressGoal(next.audioGoal,999)))
    throw Error('assignment.invalid_goal')
  if(typeof requiredCategory!=='boolean'||typeof requiredGps!=='boolean'
    ||!Number.isInteger(descriptionMinLength)||descriptionMinLength<0
    ||descriptionMinLength>4000)
    throw Error('assignment.invalid_capture_requirements')
  const row=await db.capturePolicies.get(s.accountId+'/'+assignmentId)
  if(!row||row.listing.ownerAccountId!==s.accountId)
    throw Error('assignment.policy_not_owned')
  await verifySignedAssignmentPolicy(row.listing,true)
  const a=row.listing
  const previousRules=signedPolicyRequirements(a)
  const previousMedia=signedAllowedAssignmentMedia(a)
  const previousGoals=signedPolicyGoals(a)
  const previousVideoRules=signedMediaRequirements(a,'video')
  const previousAudioRules=signedMediaRequirements(a,'audio')
  const previousPhotoAdvanced=signedAdvancedRequirements(a,'photo')
  const previousVideoAdvanced=signedAdvancedRequirements(a,'video')
  const previousAudioAdvanced=signedAdvancedRequirements(a,'audio')
  const allowedMedia=next.allowedMedia??previousMedia
  if(!validAllowedMedia(allowedMedia))throw Error('assignment.invalid_allowed_media')
  const videoGoal=next.videoGoal===undefined?previousGoals.videoGoal:next.videoGoal
  const audioGoal=next.audioGoal===undefined?previousGoals.audioGoal:next.audioGoal
  if((videoGoal!==null&&!allowedMedia.includes('video'))
    ||(audioGoal!==null&&!allowedMedia.includes('audio')))
    throw Error('assignment.goal_for_disabled_type')
  const videoRequirements=allowedMedia.includes('video')
    ?next.videoRequirements??previousVideoRules:{...NO_CAPTURE_REQUIREMENTS}
  const audioRequirements=allowedMedia.includes('audio')
    ?next.audioRequirements??previousAudioRules:{...NO_CAPTURE_REQUIREMENTS}
  if(!validCaptureRequirements(videoRequirements)
    ||!validCaptureRequirements(audioRequirements))
    throw Error('assignment.invalid_media_requirements')
  const photoAdvanced=normalizeAdvancedRules(next.photoAdvanced??previousPhotoAdvanced)
  const videoAdvanced=normalizeAdvancedRules(allowedMedia.includes('video')
    ?next.videoAdvanced??previousVideoAdvanced:{allowedCategories:[],requiredTags:[]})
  const audioAdvanced=normalizeAdvancedRules(allowedMedia.includes('audio')
    ?next.audioAdvanced??previousAudioAdvanced:{allowedCategories:[],requiredTags:[]})
  const mediaChanged=JSON.stringify(allowedMedia)!==JSON.stringify(previousMedia)
  if(a.state!=='active'||(a.photoGoal===photoGoal&&!mediaChanged
    &&videoGoal===previousGoals.videoGoal
    &&audioGoal===previousGoals.audioGoal
    &&JSON.stringify(videoRequirements)===JSON.stringify(previousVideoRules)
    &&JSON.stringify(audioRequirements)===JSON.stringify(previousAudioRules)
    &&JSON.stringify(photoAdvanced)===JSON.stringify(previousPhotoAdvanced)
    &&JSON.stringify(videoAdvanced)===JSON.stringify(previousVideoAdvanced)
    &&JSON.stringify(audioAdvanced)===JSON.stringify(previousAudioAdvanced)
    &&previousRules.requiredCategory===requiredCategory
    &&previousRules.descriptionMinLength===descriptionMinLength
    &&previousRules.requiredGps===requiredGps))
    throw Error('assignment.invalid_policy_change')
  const schedule=signedAssignmentSchedule(a)
  if(!assignmentFilesOpenAt(a,Date.now()))
    throw Error('assignment.retention_access_expired')
  if(a.policyRevision>=1001||(schedule.blockAfterEnd
    &&schedule.endsAt!==null&&schedule.endsAt<=Date.now()))
    throw Error('assignment.policy_edit_limit')
  const ops=await listAssignmentOperations()
  if(ops.some(op=>(op.kind==='policy'||op.kind==='state')
    &&(op.state==='queued'||op.state==='retry')
    &&(JSON.parse(op.contract) as {assignmentId:string}).assignmentId===assignmentId))
    throw Error('assignment.policy_change_pending')
  const enc=new TextEncoder()
  const rootPolicyHash=hex(await digest(enc.encode(a.policyContract)))
  const previousContract=a.policyRevision===1?a.policyContract:a.policyAmendmentContract
  if(!previousContract)throw Error('assignment.policy_revision_not_authenticated')
  const previousPolicyHash=hex(await digest(enc.encode(previousContract)))
  // New edits use v6; historical v1-v5 signatures are immutable.
  const payload={
    version:6,operationId:crypto.randomUUID(),assignmentId,
    ownerAccountId:s.accountId,rootPolicyHash,previousPolicyHash,
    fromPolicyRevision:a.policyRevision,toPolicyRevision:a.policyRevision+1,
    photoGoal,allowedMedia,
    requiredCategory,descriptionMinLength,requiredGps,
    videoGoal,audioGoal,videoRequirements,audioRequirements,
    photoAdvanced,videoAdvanced,audioAdvanced,
  }
  const op=await signedOperation('policy',
    '/assignments/v1/'+encodeURIComponent(assignmentId)+'/policy',payload)
  await persist(op)
  return op.id
}
/**
 * Owner edits encrypted assignment text without rotating the immutable
 * root DEK. Existing accepted invitations retain access to new revisions.
 * No plaintext title/instructions are ever persisted in the outbox or API.
 */
export async function queueAssignmentPrivateTextChange(
  assignmentId:string,next:PrivateAssignment,
):Promise<string>{
  const session=requireSession()
  const cache=await db.capturePolicies.get(session.accountId+'/'+assignmentId)
  if(!cache||cache.listing.ownerAccountId!==session.accountId)
    throw Error('assignment.private_not_owned')
  const listing=cache.listing
  await verifySignedAssignmentPolicy(listing,true)
  assertSame(session)
  const schedule=signedAssignmentSchedule(listing)
  if(!assignmentOpenAt(listing,Date.now()))
    throw Error('assignment.retention_access_expired')
  if(listing.state!=='active'
    ||(schedule.blockAfterEnd&&schedule.endsAt!==null
      &&schedule.endsAt<=Date.now())
    ||(listing.privateRevision??1)>=1001)
    throw Error('assignment.private_edit_not_allowed')
  const operations=await listAssignmentOperations()
  if(operations.some(op=>op.kind==='private'
    &&['queued','retry'].includes(op.state)
    &&(JSON.parse(op.contract) as {assignmentId:string}).assignmentId===assignmentId))
    throw Error('assignment.private_edit_pending')
  const old=await openOwnerAssignment(session.pkg,assignmentId,
    listing.privateEnvelope,effectiveAssignmentEnvelope(listing))
  // A v1 client must never silently discard newer encrypted media instructions.
  if(old.version===2&&next.version!==2)
    throw Error('assignment.private_text_downgrade')
  const validated:PrivateAssignment=next.version===2
    ?{...upgradePrivateAssignment(next),title:next.title.trim()}
    :{version:1,title:next.title.trim(),instructions:next.instructions}
  validatePrivateAssignment(validated)
  if(JSON.stringify(upgradePrivateAssignment(old))
    ===JSON.stringify(upgradePrivateAssignment(validated)))
    throw Error('assignment.private_text_unchanged')
  const newEnvelope=await resealOwnerAssignment(session.pkg,assignmentId,
    listing.privateEnvelope,validated)
  assertSame(session)
  const enc=new TextEncoder()
  const root=JSON.stringify(listing.privateEnvelope)
  const previous=(listing.privateRevision??1)>1
    ?listing.privateAmendmentContract:root
  if(!previous)throw Error('assignment.private_revision_not_authenticated')
  const payload={
    version:2,operationId:crypto.randomUUID(),assignmentId,
    ownerAccountId:session.accountId,
    rootPrivateHash:hex(await digest(enc.encode(root))),
    previousPrivateHash:hex(await digest(enc.encode(previous))),
    fromPrivateRevision:listing.privateRevision??1,
    toPrivateRevision:(listing.privateRevision??1)+1,
    privateEnvelope:newEnvelope,
  }
  const op=await signedOperation('private',
    '/assignments/v1/'+encodeURIComponent(assignmentId)+'/private',payload)
  assertSame(session)
  await persist(op)
  return op.id
}

export async function queueAssignmentGoalChange(
  assignmentId:string,photoGoal:number|null,
):Promise<string>{
  const s=requireSession()
  const row=await db.capturePolicies.get(s.accountId+'/'+assignmentId)
  if(!row)throw Error('assignment.policy_not_cached')
  await verifySignedAssignmentPolicy(row.listing,true)
  const rules=signedPolicyRequirements(row.listing)
  const targets=signedPolicyGoals(row.listing)
  return queueAssignmentPolicyChange(assignmentId,{
    photoGoal,videoGoal:targets.videoGoal,audioGoal:targets.audioGoal,...rules,
    videoRequirements:signedMediaRequirements(row.listing,'video'),
    audioRequirements:signedMediaRequirements(row.listing,'audio'),
    photoAdvanced:signedAdvancedRequirements(row.listing,'photo'),
    videoAdvanced:signedAdvancedRequirements(row.listing,'video'),
    audioAdvanced:signedAdvancedRequirements(row.listing,'audio'),
  })
}

/**
 * A schedule edit never modifies the immutable signed creation policy,
 * never rotates media keys, and never triggers physical deletion.
 */
export async function queueAssignmentScheduleChange(
  assignmentId:string,next:AssignmentSchedule,
):Promise<string>{
  const session=requireSession()
  if(!validAssignmentSchedule(next))throw Error('assignment.invalid_schedule')
  const cache=await db.capturePolicies.get(session.accountId+'/'+assignmentId)
  if(!cache||cache.listing.ownerAccountId!==session.accountId)
    throw Error('assignment.schedule_not_owned')
  const item=cache.listing
  await verifySignedAssignmentPolicy(item,true)
  assertSame(session)
  if(item.state!=='active'||!assignmentFilesOpenAt(item,Date.now())
    ||(item.scheduleRevision??1)>=1001)
    throw Error('assignment.schedule_edit_not_allowed')
  const old=signedAssignmentSchedule(item)
  if(JSON.stringify(old)===JSON.stringify(next))
    throw Error('assignment.schedule_unchanged')
  const ops=await listAssignmentOperations()
  if(ops.some(op=>op.kind==='schedule'
    &&['queued','retry'].includes(op.state)
    &&(JSON.parse(op.contract) as {assignmentId:string}).assignmentId===assignmentId))
    throw Error('assignment.schedule_edit_pending')
  const enc=new TextEncoder()
  const previous=item.scheduleRevision&&item.scheduleRevision>1
    ?item.scheduleAmendmentContract:item.policyContract
  if(!previous)throw Error('assignment.schedule_not_authenticated')
  const payload={
    version:1,operationId:crypto.randomUUID(),assignmentId,
    ownerAccountId:session.accountId,
    rootPolicyHash:hex(await digest(enc.encode(item.policyContract))),
    previousScheduleHash:hex(await digest(enc.encode(previous))),
    fromScheduleRevision:item.scheduleRevision??1,
    toScheduleRevision:(item.scheduleRevision??1)+1,
    startsAt:next.startsAt,endsAt:next.endsAt,
    blockBeforeStart:next.blockBeforeStart,
    blockAfterEnd:next.blockAfterEnd,
  }
  const op=await signedOperation('schedule',
    '/assignments/v1/'+encodeURIComponent(assignmentId)+'/schedule',payload)
  assertSame(session)
  await persist(op)
  return op.id
}

/**
 * Durable owner-signed logical retention. This operation NEVER delegates
 * physical deletion of contributor originals or expands their independent
 * file TTL. Existing accepted assignment policy remains immutable.
 */
export async function queueAssignmentRetentionChange(
  assignmentId:string,next:AssignmentRetention,
):Promise<string>{
  const session=requireSession()
  if(!validAssignmentRetention(next))throw Error('assignment.invalid_retention')
  const cache=await db.capturePolicies.get(session.accountId+'/'+assignmentId)
  if(!cache||cache.listing.ownerAccountId!==session.accountId)
    throw Error('assignment.retention_not_owned')
  const item=cache.listing
  await verifySignedAssignmentPolicy(item,true)
  assertSame(session)
  if(item.state!=='active'||!assignmentFilesOpenAt(item,Date.now())
    ||(item.retentionRevision??1)>=1001)
    throw Error('assignment.retention_edit_not_allowed')
  const old=signedAssignmentRetention(item)
  if(JSON.stringify(old)===JSON.stringify(next))
    throw Error('assignment.retention_unchanged')
  const end=signedAssignmentSchedule(item).endsAt
  for(const date of [next.filesAccessUntil,next.assignmentAccessUntil]){
    if(date!==null&&(date<=Date.now()||(end!==null&&date<end)))
      throw Error('assignment.retention_deadline_not_allowed')
  }
  const ops=await listAssignmentOperations()
  if(ops.some(op=>op.kind==='retention'
    &&['queued','retry'].includes(op.state)
    &&(JSON.parse(op.contract) as {assignmentId:string}).assignmentId===assignmentId))
    throw Error('assignment.retention_edit_pending')
  const enc=new TextEncoder()
  const previous=(item.retentionRevision??1)>1
    ?item.retentionAmendmentContract:item.policyContract
  if(!previous)throw Error('assignment.retention_not_authenticated')
  const payload={
    version:1,operationId:crypto.randomUUID(),assignmentId,
    ownerAccountId:session.accountId,
    rootPolicyHash:hex(await digest(enc.encode(item.policyContract))),
    previousRetentionHash:hex(await digest(enc.encode(previous))),
    fromRetentionRevision:item.retentionRevision??1,
    toRetentionRevision:(item.retentionRevision??1)+1,
    filesAccessUntil:next.filesAccessUntil,
    assignmentAccessUntil:next.assignmentAccessUntil,
    deleteOriginals:false,
  }
  const op=await signedOperation('retention',
    '/assignments/v1/'+encodeURIComponent(assignmentId)+'/retention',payload)
  assertSame(session)
  await persist(op)
  return op.id
}

/** Signed owner lifecycle commands are durable and do not delete media. */
export async function queueAssignmentStateTransition(
  assignmentId:string,action:'finish'|'resume',
):Promise<string>{
  const s=requireSession()
  const row=await db.capturePolicies.get(s.accountId+'/'+assignmentId)
  if(!row||row.listing.ownerAccountId!==s.accountId)
    throw new Error('assignment.state_policy_not_cached')
  await verifySignedAssignmentPolicy(row.listing)
  const a=row.listing
  if(!assignmentOpenAt(a,Date.now())
    ||!((action==='finish'&&a.state==='active')
    ||(action==='resume'&&a.state==='finished')))
    throw new Error('assignment.invalid_state_transition')
  const schedule=signedAssignmentSchedule(a)
  if(action==='resume'&&schedule.blockAfterEnd
    &&schedule.endsAt!==null&&schedule.endsAt<=Date.now())
    throw new Error('assignment.assignment_expired')
  const ops=await listAssignmentOperations()
  if(ops.some(op=>op.kind==='state'
    &&(op.state==='queued'||op.state==='retry')
    &&(JSON.parse(op.contract) as {assignmentId:string}).assignmentId===assignmentId)){
    throw new Error('assignment.state_change_pending')
  }
  const policyHash=hex(await digest(new TextEncoder().encode(a.policyContract)))
  const payload={
    version:1,operationId:crypto.randomUUID(),assignmentId,
    ownerAccountId:s.accountId,policyHash,policyRevision:1,
    fromRevision:a.revision,toRevision:a.revision+1,action,
    state:action==='finish'?'finished':'active',
  }
  const op=await signedOperation('state',
    '/assignments/v1/'+encodeURIComponent(assignmentId)+'/state',payload)
  await persist(op)
  return op.id
}

export async function queueAssignmentInvitation(
  assignmentId:string,recipientAccountId:string,
):Promise<string>{
  const s=requireSession()
  const peer=await pinnedPeer(recipientAccountId)
  const local=await db.assignments.get(assignmentId)
  // Editing older assignments after a reload must not depend on their being
  // in the FIRST 50 results of the paginated server listing. The existing
  // owner-signed policy snapshot has already been independently authenticated.
  const cached=await db.capturePolicies.get(s.accountId+'/'+assignmentId)
  if(cached)await verifySignedAssignmentPolicy(cached.listing,true)
  let listing:LocalAssignment|AssignmentListing|undefined=local??cached?.listing
  if(!listing&&s.online&&navigator.onLine){
    let cursor:string|undefined
    do{
      const page=await listServerAssignments(cursor)
      listing=page.items.find(x=>x.assignmentId===assignmentId)
      cursor=page.nextCursor??undefined
    }while(!listing&&cursor)
  }
  if(!listing||listing.ownerAccountId!==s.accountId)
    throw new Error('assignment.not_owned')
  if('policyContract' in listing
    &&!assignmentFilesOpenAt(listing,Date.now()))
    throw Error('assignment.retention_access_expired')
  const inviteId=crypto.randomUUID(),expiresAt=Date.now()+6*86400000
  const envelope:AssignmentInviteEnvelope=await wrapAssignmentForRecipient(
    s.pkg,assignmentId,listing.privateEnvelope,
    {inviteId,recipientAccountId,role:'contributor',expiresAt},
    peer.exchangeSpki,
  )
  const payload={
    version:1,inviteId,assignmentId,ownerAccountId:s.accountId,
    recipientAccountId,recipientKeyDigest:peer.descriptorHash,
    role:'contributor',expiresAt,envelope,
  }
  const op=await signedOperation('invite',
    '/assignments/v1/'+encodeURIComponent(assignmentId)+'/invites',payload)
  await persist(op)
  return inviteId
}

/**
 * Signed, durable owner removal. The UI must pass a freshly authenticated
 * roster item; the server checks live membership and only an owner signature
 * can revoke it. Offline outbox never pretends the removal has succeeded.
 */
export async function queueAssignmentMemberRemoval(
  assignmentId:string,person:AssignmentParticipant,
):Promise<string>{
  const session=requireSession()
  const cached=await db.capturePolicies.get(session.accountId+'/'+assignmentId)
  if(!cached||cached.listing.ownerAccountId!==session.accountId)
    throw Error('assignment.removal_requires_owner_policy')
  await verifySignedAssignmentPolicy(cached.listing,true)
  if(!['accepted','pending'].includes(person.state)
    ||person.role!=='contributor'
    ||person.recipientAccountId===session.accountId)
    throw Error('assignment.invalid_member_removal')
  const existing=await listAssignmentOperations()
  if(existing.some(op=>op.kind==='remove-member'
    &&['queued','retry'].includes(op.state)
    &&(JSON.parse(op.contract) as {inviteId?:string}).inviteId===person.inviteId))
    throw Error('assignment.member_removal_pending')
  const operationId=crypto.randomUUID()
  const payload={
    version:1,action:'remove',operationId,assignmentId,
    inviteId:person.inviteId,ownerAccountId:session.accountId,
    recipientAccountId:person.recipientAccountId,
  }
  const op=await signedOperation('remove-member',
    '/assignments/v1/'+encodeURIComponent(assignmentId)
      +'/invites/'+encodeURIComponent(person.inviteId)+'/remove',payload)
  await persist(op)
  return operationId
}

/**
 * Distinct recipient-only history, never part of the accepted invite inbox.
 * Fetch all bounded pages; a single page must not starve other live invites.
 * Only independently authenticated owner-signed removal may invalidate a
 * previously cached accepted invite. A bad / unpinned proof is not authority.
 */
export async function listAssignmentRemovalNotices():Promise<CheckedAssignmentRemovalNotice[]>{
  const session=requireSession()
  if(!session.online||(typeof navigator!=='undefined'&&!navigator.onLine))
    throw Error('assignment.removals_require_online')
  const all:AssignmentRemovalNotice[]=[]
  const seen=new Set<string>()
  let after:string|null=null
  for(let n=0;n<100;n++){
    const result:{items:AssignmentRemovalNotice[];nextCursor:string|null}=
      await jsonApi<{items:AssignmentRemovalNotice[];nextCursor:string|null}>(
        '/assignments/v1/invites/removals'+(after
          ?'?after='+encodeURIComponent(after):''))
    assertSame(session)
    if(!result||!Array.isArray(result.items)||result.items.length>50
      ||(result.nextCursor!==null&&(
        typeof result.nextCursor!=='string'||result.items.length!==50
        ||result.nextCursor!==result.items[49]?.inviteId)))
      throw Error('assignment.removals_invalid_page')
    for(const item of result.items){
      if(!item||typeof item.inviteId!=='string'
        ||seen.has(item.inviteId)
        ||(after!==null&&item.inviteId<=after)
        ||(all.length&&item.inviteId<=all[all.length-1]!.inviteId))
        throw Error('assignment.removals_invalid_page')
      seen.add(item.inviteId)
      all.push(item)
    }
    if(result.nextCursor===null)break
    if(n===99)throw Error('assignment.removals_pagination_limit')
    after=result.nextCursor
  }
  const checked=await inspectAssignmentRemovalNotices(all,session.accountId)
  assertSame(session)
  const verified=checked.filter(x=>x.verified).map(x=>x.notice)
  if(verified.length){
    // A verified, exact owner-signed removal is a durable denial of stale
    // offline Fieldwork capture authority. Never clear personal photos,
    // encrypted outbox entries, owner-created assignments or file grants.
    await db.transaction('rw',
      db.invites,db.capturePolicies,db.privateSummaries,db.revocations,
      async()=>{
        assertSame(session)
        for(const notice of verified){
          const key=session.accountId+'/'+notice.assignmentId
          if(notice.recipientAccountId!==session.accountId
            ||notice.ownerAccountId===session.accountId)
            throw Error('assignment.invalid_revocation_scope')
          // Write tombstone FIRST, within the same atomic transaction as
          // removing the former local Fieldwork permissions and summary.
          await db.revocations.put({
            key,accountId:session.accountId,
            assignmentId:notice.assignmentId,
            ownerAccountId:notice.ownerAccountId,
            inviteId:notice.inviteId,
            removalContract:notice.removalContract,
            removalSignature:notice.removalSignature,
            verifiedAt:Date.now(),
          })
          const old=await db.invites.get(notice.inviteId)
          if(old?.cachedForAccountId===session.accountId
            &&old.assignmentId===notice.assignmentId
            &&old.ownerAccountId===notice.ownerAccountId)
            await db.invites.delete(notice.inviteId)
          const snapshot=await db.capturePolicies.get(key)
          if(snapshot?.accountId===session.accountId
            &&snapshot.listing.assignmentId===notice.assignmentId
            &&snapshot.listing.ownerAccountId===notice.ownerAccountId)
            await db.capturePolicies.delete(key)
          // Only a disposable account-encrypted summary of this revoked
          // assignment is purged. Contributor's own media/outbox is untouched.
          const summary=await db.privateSummaries.get(key)
          if(summary?.accountId===session.accountId
            &&summary.assignmentId===notice.assignmentId)
            await db.privateSummaries.delete(key)
        }
    })
  }
  assertSame(session)
  return checked
}

/** Display-only cached invitations; never use them as current server ACL. */
export async function listCachedAssignmentInvites():Promise<ReceivedAssignmentInvite[]>{
  const s=requireSession()
  const [cached,removed]=await Promise.all([
    db.invites.where('cachedForAccountId').equals(s.accountId).toArray(),
    db.revocations.where('accountId').equals(s.accountId).toArray(),
  ])
  assertSame(s)
  const denied=new Set(removed.map(x=>x.assignmentId))
  return cached.filter(item=>!denied.has(item.assignmentId))
    .map(({cachedForAccountId:_account,...item})=>{
      void _account
      return item
    })
}

export async function listAssignmentInvites():Promise<ReceivedAssignmentInvite[]>{
  const s=requireSession()
  if(s.online&&(typeof navigator==='undefined'||navigator.onLine)){
    let items:ReceivedAssignmentInvite[]=[]
    let after:string|null=null
    let complete=false
    for(let n=0;n<100;n++){
      const response:{items:ReceivedAssignmentInvite[];nextCursor:string|null}=
        await jsonApi<{items:ReceivedAssignmentInvite[];nextCursor:string|null}>(
        '/assignments/v1/invites/received'
        +(after?'?after='+encodeURIComponent(after):''))
      assertSame(s)
      const next:{items:ReceivedAssignmentInvite[];nextCursor:string|null}=
        appendBoundedUuidPage(items,response,after,item=>item.inviteId)
      items=next.items
      if(next.nextCursor===null){complete=true;break}
      after=next.nextCursor
    }
    if(!complete)throw Error('assignment.inbox_pagination_limit')
    // A signed historical removal is stronger than a stale received-inbox
    // response. Keep the cache transaction ordered with tombstones.
    await db.transaction('rw',db.invites,db.revocations,async()=>{
      assertSame(s)
      for(const item of items){
        if(await db.revocations.get(s.accountId+'/'+item.assignmentId))
          continue
        await db.invites.put({...item,cachedForAccountId:s.accountId})
      }
    })
    assertSame(s)
    const denied=await db.revocations.where('accountId')
      .equals(s.accountId).toArray()
    assertSame(s)
    const blocked=new Set(denied.map(x=>x.assignmentId))
    return items.filter(item=>!blocked.has(item.assignmentId))
  }
  // No authority is claimed for stale local grants; these are display-only
  // ciphertext invitations until a fresh server-authenticated accept.
  return listCachedAssignmentInvites()
}

export async function verifyAssignmentInvite(
  invite:ReceivedAssignmentInvite,cachedOnly=false,
):Promise<void>{
  const s=requireSession()
  const peer=await pinnedPeer(invite.ownerAccountId,!cachedOnly)
  if(peer.accountSpki!==invite.ownerAccountSpki
    ||!await verify(await importSpki(peer.accountSpki),
      domain('invite')+invite.contract,invite.signature)) {
    throw new Error('assignment.untrusted_owner')
  }
  const c=JSON.parse(invite.contract) as Record<string,unknown>
  if(c.version!==1||c.inviteId!==invite.inviteId
    ||c.assignmentId!==invite.assignmentId
    ||c.recipientAccountId!==s.accountId
    ||c.ownerAccountId!==invite.ownerAccountId){
    throw new Error('assignment.bad_invite_scope')
  }
}

export async function queueAssignmentAcceptance(
  invite:ReceivedAssignmentInvite,
):Promise<string>{
  const s=requireSession()
  await verifyAssignmentInvite(invite)
  if(invite.state!=='pending'||invite.expiresAt<=Date.now())
    throw new Error('assignment.invite_not_pending')
  const operationId=crypto.randomUUID()
  const payload={
    version:1,action:'accept',inviteId:invite.inviteId,
    assignmentId:invite.assignmentId,
    recipientAccountId:s.accountId,operationId,
  }
  const op=await signedOperation('accept',
    '/assignments/v1/'+encodeURIComponent(invite.assignmentId)
    +'/invites/'+encodeURIComponent(invite.inviteId)+'/accept',payload)
  await persist(op)
  return operationId
}

/** A submission links ONLY an independently approved P1-03 E2EE grant. */
export async function queueAssignmentSubmission(
  assignmentId:string,photoId:string,photoGrantId:string,policyRevision=1,
):Promise<string>{
  if(!Number.isInteger(policyRevision)||policyRevision<1||policyRevision>1000000)
    throw new Error('assignment.invalid_policy_revision')
  const s=requireSession()
  const operationId=crypto.randomUUID()
  const op=await signedOperation('submit',
    '/assignments/v1/'+encodeURIComponent(assignmentId)+'/submissions',{
      version:1,submissionId:crypto.randomUUID(),operationId,
      assignmentId,contributorAccountId:s.accountId,
      photoId,photoGrantId,policyRevision,kind:'photo',
    },photoGrantId)
  await persist(op)
  return operationId
}

export type AssignmentPhotoSubmission={
  submissionId:string;photoId:string;photoGrantId:string;contributorAccountId:string
  // Immutable account-signed consent only. Neither camera nor GPS provenance.
  contract:string;signature:string;contractHash:string;policyRevision:number
}
export async function listAssignmentSubmissionsPage(
  assignmentId:string,after?:string,
):Promise<{items:AssignmentPhotoSubmission[];nextCursor:string|null}>{
  const s=requireSession()
  if(!s.online)throw new Error('assignment.offline')
  const result=await jsonApi<{
    items:AssignmentPhotoSubmission[];nextCursor:string|null
  }>('/assignments/v1/'+encodeURIComponent(assignmentId)+'/submissions'
    +(after?'?after='+encodeURIComponent(after):''))
  assertSame(s)
  return result
}
/** Preserve the old first-page helper for existing consumer compatibility. */
export async function listAssignmentSubmissions(
  assignmentId:string,
):Promise<AssignmentPhotoSubmission[]>{
  return (await listAssignmentSubmissionsPage(assignmentId)).items
}

/** Media submission is not a legacy photo capture. The owner must
 * explicitly opt into video/audio via a signed policy v3 amendment.
 * A previously approved recipient DEK grant is a strict prerequisite, not
 * automatically created by assignment membership.
 */
/** Authenticated warm-offline recording context for audio/video.
 * Snapshot is owner-signed and pinned. This is a CLIENT assertion of
 * recording time, not hardware/timestamp/GPS attestation.
 */
export async function signedMediaCaptureIntent(
  assignmentId:string,mediaType:'video'|'audio',startedAt=Date.now(),
  privateFields:MediaPrivateFields={},
):Promise<Omit<MediaCaptureIntent,'finishedAt'>>{
  const session=requireSession()
  const row=await db.capturePolicies.get(session.accountId+'/'+assignmentId)
  if(!row)throw Error('assignment.policy_not_cached')
  await verifySignedAssignmentPolicy(row.listing,true)
  assertSame(session)
  const policy=row.listing
  const allowed=signedAllowedAssignmentMedia(policy)
  if(policy.ownerAccountId===session.accountId
    ||!assignmentFilesOpenAt(policy,Date.now())
    ||policy.state!=='active'
    ||!allowed.includes(mediaType)
    ||policy.policyRevision<2
    ||!assignmentFilesOpenAt(policy,Date.now())
    ||!schedulePermitsAt(policy,startedAt))
    throw Error('assignment.media_recording_not_permitted')
  const latest=policy.policyAmendmentContract
  if(!latest||![3,4,5,6].includes(
    (JSON.parse(latest) as {version?:number}).version??0))
    throw Error('assignment.media_policy_v3_required')
  // Validate the exact user-supplied, private E2EE metadata before
  // the MediaRecorder obtains any recording bytes. No server field leaks.
  const canonical=prepareMediaPrivateFields(privateFields,startedAt)
  validateMediaPrivateRequirements(canonical,signedMediaRequirements(policy,mediaType))
  validateAdvancedFields(canonical,signedAdvancedRequirements(policy,mediaType))
  const policyHash=hex(await digest(new TextEncoder().encode(latest)))
  assertSame(session)
  return {
    assignmentId,ownerAccountId:policy.ownerAccountId,
    contributorAccountId:session.accountId,policyRevision:policy.policyRevision,
    policyHash,mediaType,startedAt,
  }
}

export async function queueAssignmentMediaSubmission(
  assignmentId:string,mediaId:string,mediaGrantId:string,
):Promise<string>{
  const session=requireSession()
  const cache=await db.capturePolicies.get(session.accountId+'/'+assignmentId)
  if(!cache)throw Error('assignment.policy_not_cached')
  const listing=cache.listing
  await verifySignedAssignmentPolicy(listing,true)
  assertSame(session)
  if(listing.ownerAccountId===session.accountId
    ||!assignmentFilesOpenAt(listing,Date.now())
    ||listing.state!=='active'
    ||!assignmentFilesOpenAt(listing,Date.now())
    ||!schedulePermitsAt(listing,Date.now()))
    throw Error('assignment.not_accepting_submissions')
  const media=(await listLocalMedia()).find(x=>x.mediaId===mediaId)
  if(!media||media.state!=='synced'||media.expiresAt<=Date.now()
    ||!['photo','video','audio'].includes(media.mediaType))
    throw Error('assignment.media_not_synced')
  if(media.mediaType==='photo'&&media.capture)
    throw Error('assignment.p2_photo_capture_not_supported')
  if(!signedAllowedAssignmentMedia(listing).includes(media.mediaType))
    throw Error('assignment.media_type_not_allowed')
  const grant=(await listOutgoingMediaGrants()).find(x=>
    x.id===mediaGrantId&&x.mediaId===mediaId
    &&x.recipientAccountId===listing.ownerAccountId
    &&x.ownerAccountId===session.accountId
    &&x.state!=='conflict')
  if(!grant)throw Error('assignment.media_grant_required')
  const isP2Photo=media.mediaType==='photo'
  const policy=listing.policyAmendmentContract??(
    isP2Photo?listing.policyContract:null)
  if(!policy)throw Error('assignment.media_policy_v3_required')
  const activePolicy=JSON.parse(policy) as {version?:number}
  if(!isP2Photo&&![3,4,5,6].includes(activePolicy.version??0))
    throw Error('assignment.media_policy_v3_required')
  if(isP2Photo){
    const c=parseMediaGrantContract(JSON.parse(grant.contract))
    if(c.version!==2||c.scope!=='read'
      ||c.assignmentId!==assignmentId
      ||c.mediaId!==mediaId
      ||c.ownerAccountId!==session.accountId
      ||c.recipientAccountId!==listing.ownerAccountId)
      throw Error('assignment.p2_photo_scoped_e2ee_required')
    if(!await verify(await importSpki(session.pkg.accountSpki),
      'pb3.media-grant.v2\n'+grant.contract,grant.signature))
      throw Error('assignment.p2_photo_invalid_grant_signature')
  }
  const policyHash=hex(await digest(new TextEncoder().encode(policy)))
  const mediaContractHash=hex(await digest(
    new TextEncoder().encode(JSON.stringify(media.contract))))
  let captureContract:string|undefined
  let captureSignature:string|undefined
  if(media.capture){
    captureContract=media.capture.contract
    captureSignature=media.capture.signature
    const c=JSON.parse(captureContract) as Record<string,unknown>
    if(c.version!==1||c.assignmentId!==assignmentId
      ||c.contributorAccountId!==session.accountId
      ||c.ownerAccountId!==listing.ownerAccountId
      ||c.policyRevision!==listing.policyRevision
      ||c.policyHash!==policyHash
      ||c.mediaContractHash!==mediaContractHash
      ||c.mediaId!==mediaId||c.mediaType!==media.mediaType)
      throw Error('assignment.recording_bound_to_different_policy')
    if(!await verify(await importSpki(session.pkg.accountSpki),
      'pb3.assignment-media-capture.v1\n'+captureContract,captureSignature))
      throw Error('assignment.invalid_recording_signature')
  }
  const op=await signedOperation('media-submit',
    '/assignments/v1/'+encodeURIComponent(assignmentId)+'/media-submissions',{
      version:isP2Photo?3:media.capture?2:1,submissionId:crypto.randomUUID(),
      operationId:crypto.randomUUID(),assignmentId,
      contributorAccountId:session.accountId,
      mediaId,mediaGrantId,mediaContractHash,
      policyRevision:listing.policyRevision,policyHash,kind:media.mediaType,
      ...(captureContract&&captureSignature
        ?{captureContract,captureSignature}:{}),
    },mediaGrantId)
  await persist(op)
  return op.id
}
export type AssignmentMediaSubmission={
  submissionId:string;mediaId:string;mediaGrantId:string
  mediaType:'photo'|'video'|'audio';contributorAccountId:string
  capturedInAssignment:boolean
  contract:string;signature:string;mediaContractHash:string
}
export async function listAssignmentMediaSubmissions(
  assignmentId:string,after?:string,
):Promise<{items:AssignmentMediaSubmission[];nextCursor:string|null}>{
  const session=requireSession()
  if(!session.online)throw Error('assignment.offline')
  const path='/assignments/v1/'+encodeURIComponent(assignmentId)
    +'/media-submissions'+(after?'?after='+encodeURIComponent(after):'')
  const result=await jsonApi<{
    items:AssignmentMediaSubmission[];nextCursor:string|null
  }>(path)
  assertSame(session)
  return result
}

export async function listAssignmentOperations():Promise<AssignmentOperation[]>{
  const s=requireSession()
  return db.operations.where('accountId').equals(s.accountId).sortBy('createdAt')
}

let running:Promise<void>|null=null
let rerun=false
export function flushAssignmentOutbox():Promise<void>{
  if(running){rerun=true;return running}
  running=(async()=>{
    do{rerun=false;await flushPass()}
    while(rerun&&activeSession.value?.online&&navigator.onLine)
  })().finally(()=>{running=null})
  return running
}
async function flushPass():Promise<void>{
  const s=activeSession.value
  if(!s?.online||!navigator.onLine)return
  const ops=await db.operations.where('accountId').equals(s.accountId).sortBy('createdAt')
  for(const op of ops.filter(p=>p.state==='queued'||p.state==='retry')){
    if(activeSession.value!==s)return
    if(op.prerequisiteGrantId){
      const shared=op.kind==='media-submit'
        ?(await listOutgoingMediaGrants()).find(g=>g.id===op.prerequisiteGrantId)
        :(await listOutgoingGrants()).find(g=>g.id===op.prerequisiteGrantId)
      if(!shared || shared.state!=='sent')continue
    }
    try{
      await jsonApi(op.path,'POST',{contract:op.contract,signature:op.signature})
      assertSame(s)
      await db.operations.update(op.id,{state:'sent',lastError:undefined})
      if(op.kind==='create'){
        const c=JSON.parse(op.contract) as {assignmentId:string}
        await db.assignments.update(c.assignmentId,{state:'sent'})
      }
    }catch(e){
      const reason=e instanceof Error?e.message:'assignment.network_error'
      await db.operations.update(op.id,{
        // A 401 can be caused by online proof/cookie rotation racing an
        // outbox request. Keep the signed operation retryable; a revoked
        // device cannot bypass server authorization on a later attempt.
        state:/^api\.http_(403|409|410|422)$/.test(reason)?'conflict':'retry',
        lastError:/^api\.http_\d+$/.test(reason)?reason:'assignment.retry_required',
      })
      if(op.kind==='create'){
        // An unaccepted signed draft stays encrypted and available locally;
        // its card must not misleadingly remain "in queue" after a terminal
        // entitlement/ACL conflict. Never delete the draft on HTTP 403.
        const c=JSON.parse(op.contract) as {assignmentId:string}
        await db.assignments.update(c.assignmentId,{
          state:/^api\.http_(403|409|410|422)$/.test(reason)?'conflict':'retry',
        })
      }
      if(!navigator.onLine)return
    }
  }
}
export function attachAssignmentLifecycle():()=>void {
  const run=()=>{void flushAssignmentOutbox()}
  window.addEventListener('online',run)
  document.addEventListener('visibilitychange',run)
  return()=>{
    window.removeEventListener('online',run)
    document.removeEventListener('visibilitychange',run)
  }
}
