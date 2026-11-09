import Dexie, { type Table } from 'dexie'
import { activeSession, requireSession } from '../../identity/application/session'
import { jsonApi } from '../../identity/infrastructure/api'
import { importSigner, sign, verify, importSpki, digest, hex, b64, unb64 } from '../../identity/infrastructure/crypto'
import { pinnedPeer } from '../../sharing/key-directory'
import { listOutgoingGrants } from '../../sharing/grant-flow'
import { sealAssignment, wrapAssignmentForRecipient } from '../infrastructure/assignment-crypto'
import type { AssignmentEnvelope, AssignmentInviteEnvelope, PrivateAssignment } from '../infrastructure/assignment-crypto'

export type AssignmentOperationKind='create'|'invite'|'accept'|'submit'|'state'|'policy'
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
  confirmedPhotoCount:number // server-derived, never a signed capture-policy field
  policyRevision:number
  policyContract:string
  policySignature:string
  policyAmendmentContract?:string|null
  policyAmendmentSignature?:string|null
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

type CachedInvite=ReceivedAssignmentInvite & { cachedForAccountId:string }
type CachedCapturePolicy={
  key:string;accountId:string;listing:AssignmentListing;verifiedAt:number
}
type CachedPrivateAssignment={
  key:string;accountId:string;assignmentId:string;policyHash:string
  iv:string;ciphertext:Blob // AES-GCM ciphertext only, never plaintext
}
export type SignedCaptureBinding={
  assignmentId:string;ownerAccountId:string;policyRevision:number
  policyHash:string;capturedAt:number
}

class AssignmentDB extends Dexie {
  operations!:Table<AssignmentOperation,string>
  assignments!:Table<LocalAssignment,string>
  invites!:Table<CachedInvite,string>
  capturePolicies!:Table<CachedCapturePolicy,string>
  privateSummaries!:Table<CachedPrivateAssignment,string>
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
    submit:'pb3.assignment-submit.v1\n',
    state:'pb3.assignment-state.v1\n',
    policy:'pb3.assignment-policy.v1\n',
  }
  return signedDomains[kind]
}

async function signedOperation(
  kind:AssignmentOperationKind,path:string,payload:Record<string,unknown>,
  requirementGrantId?:string,
):Promise<AssignmentOperation>{
  const s=requireSession()
  const contract=JSON.stringify(payload)
  const signature=await sign(await importSigner(s.pkg.accountPkcs8),domain(kind)+contract)
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
    if(item.photoGoal!==c.photoGoal||item.policyAmendmentContract!=null
      ||item.policyAmendmentSignature!=null)
      throw new Error('assignment.policy_snapshot_mismatch')
  }else{
    if(typeof item.policyAmendmentContract!=='string'
      ||typeof item.policyAmendmentSignature!=='string'
      ||!await verify(await importSpki(trustedSpki),
        domain('policy')+item.policyAmendmentContract,
        item.policyAmendmentSignature))
      throw new Error('assignment.policy_revision_not_authenticated')
    let edit:Record<string,unknown>
    try{edit=JSON.parse(item.policyAmendmentContract) as Record<string,unknown>}
    catch{throw new Error('assignment.invalid_policy_revision')}
    if(edit.version!==1||edit.assignmentId!==item.assignmentId
      ||edit.ownerAccountId!==item.ownerAccountId
      ||edit.rootPolicyHash!==originalHash
      ||edit.toPolicyRevision!==item.policyRevision
      ||edit.fromPolicyRevision!==item.policyRevision-1
      ||!Array.isArray(edit.allowedMedia)||edit.allowedMedia.length!==1
      ||edit.allowedMedia[0]!=='photo'
      ||edit.photoGoal!==item.photoGoal
      ||typeof edit.previousPolicyHash!=='string'
      ||!/^[a-f0-9]{64}$/.test(edit.previousPolicyHash))
      throw new Error('assignment.policy_revision_mismatch')
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
  if(next.policyRevision<previous.policyRevision)
    throw new Error('assignment.policy_rollback')
  if(next.policyRevision===previous.policyRevision
    &&(next.photoGoal!==previous.photoGoal
      ||next.policyAmendmentContract!==previous.policyAmendmentContract
      ||next.policyAmendmentSignature!==previous.policyAmendmentSignature))
    throw new Error('assignment.policy_equivocation')
  if(next.revision===previous.revision
    &&(next.state!==previous.state
      ||next.stateContract!==previous.stateContract
      ||next.stateSignature!==previous.stateSignature))
    throw new Error('assignment.state_equivocation')
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
  for(const item of result.items)await verifySignedAssignmentPolicy(item)
  assertSame(s)
  // Cache only signed, independently authenticated policy snapshots.
  // No plaintext assignment name, DEK or recovery material is persisted.
  await db.transaction('rw',db.capturePolicies,async()=>{
    for(const item of result.items){
      const key=s.accountId+'/'+item.assignmentId
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
 * A previously verified policy can be read offline for local-only capture.
 * A server can still reject a later upload if membership or state changed.
 */
export async function listCachedAssignmentSnapshots():Promise<AssignmentListing[]>{
  const s=requireSession()
  const rows=await db.capturePolicies.where('accountId').equals(s.accountId).toArray()
  const verified:AssignmentListing[]=[]
  for(const row of rows){
    assertSame(s)
    try{
      await verifySignedAssignmentPolicy(row.listing,true)
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
    &&item.startsAt<=Date.now()
    &&(item.endsAt===null||item.endsAt>Date.now()))
}

export async function signedCaptureBinding(
  assignmentId:string,capturedAt=Date.now(),
):Promise<SignedCaptureBinding>{
  const s=requireSession()
  const row=await db.capturePolicies.get(s.accountId+'/'+assignmentId)
  if(!row)throw new Error('assignment.policy_not_cached')
  const policy=row.listing
  // Capture is deliberately Local-First. Recheck the cached owner signature
  // against the independently pinned local key, not a live key-directory
  // request that can fail during an API outage.
  await verifySignedAssignmentPolicy(policy,true)
  if(policy.state!=='active'
    ||capturedAt<policy.startsAt
    ||(policy.endsAt!==null&&capturedAt>=policy.endsAt)) {
    throw new Error('assignment.capture_not_permitted')
  }
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
  if(data.version!==1||typeof data.title!=='string'
    ||!data.title.trim()||data.title.length>120
    ||typeof data.instructions!=='string'||data.instructions.length>4000)
    throw new Error('assignment.invalid_cached_summary')
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
export async function queueAssignmentGoalChange(
  assignmentId:string,photoGoal:number|null,
):Promise<string>{
  const s=requireSession()
  if(photoGoal!==null&&(!Number.isInteger(photoGoal)||photoGoal<1||photoGoal>9999))
    throw new Error('assignment.invalid_goal')
  const row=await db.capturePolicies.get(s.accountId+'/'+assignmentId)
  if(!row||row.listing.ownerAccountId!==s.accountId)
    throw new Error('assignment.policy_not_owned')
  await verifySignedAssignmentPolicy(row.listing,true)
  const a=row.listing
  if(a.state!=='active'||a.photoGoal===photoGoal)
    throw new Error('assignment.invalid_policy_change')
  if(a.policyRevision>=1001
    ||(a.endsAt!==null&&a.endsAt<=Date.now()))
    throw new Error('assignment.policy_edit_limit')
  const ops=await listAssignmentOperations()
  if(ops.some(op=>(op.kind==='policy'||op.kind==='state')
    &&(op.state==='queued'||op.state==='retry')
    &&(JSON.parse(op.contract) as {assignmentId:string}).assignmentId===assignmentId))
    throw new Error('assignment.policy_change_pending')
  const enc=new TextEncoder()
  const rootPolicyHash=hex(await digest(enc.encode(a.policyContract)))
  const previousContract=a.policyRevision===1?a.policyContract:a.policyAmendmentContract
  if(!previousContract)throw new Error('assignment.policy_revision_not_authenticated')
  const previousPolicyHash=hex(await digest(enc.encode(previousContract)))
  const payload={
    version:1,operationId:crypto.randomUUID(),assignmentId,
    ownerAccountId:s.accountId,rootPolicyHash,previousPolicyHash,
    fromPolicyRevision:a.policyRevision,toPolicyRevision:a.policyRevision+1,
    photoGoal,allowedMedia:['photo'],
  }
  const op=await signedOperation('policy',
    '/assignments/v1/'+encodeURIComponent(assignmentId)+'/policy',payload)
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
  if(!((action==='finish'&&a.state==='active')
    ||(action==='resume'&&a.state==='finished')))
    throw new Error('assignment.invalid_state_transition')
  if(action==='resume'&&a.endsAt!==null&&a.endsAt<=Date.now())
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
  const listing=local??(await listServerAssignments()).items.find(x=>x.assignmentId===assignmentId)
  if(!listing||listing.ownerAccountId!==s.accountId)
    throw new Error('assignment.not_owned')
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

/** Display-only cached invitations; never use them as current server ACL. */
export async function listCachedAssignmentInvites():Promise<ReceivedAssignmentInvite[]>{
  const s=requireSession()
  const cached=await db.invites.where('cachedForAccountId').equals(s.accountId).toArray()
  assertSame(s)
  return cached.map(({cachedForAccountId:_account,...item})=>{
    void _account
    return item
  })
}

export async function listAssignmentInvites():Promise<ReceivedAssignmentInvite[]>{
  const s=requireSession()
  if(s.online&&(typeof navigator==='undefined'||navigator.onLine)){
    const response=await jsonApi<{items:ReceivedAssignmentInvite[]}>(
      '/assignments/v1/invites/received')
    assertSame(s)
    await db.transaction('rw',db.invites,async()=>{
      for(const item of response.items)await db.invites.put({...item,cachedForAccountId:s.accountId})
    })
    return response.items
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

export async function listAssignmentSubmissions(assignmentId:string):Promise<Array<{
  submissionId:string;photoId:string;photoGrantId:string;contributorAccountId:string
}>>{
  const s=requireSession()
  if(!s.online)throw new Error('assignment.offline')
  const result=await jsonApi<{items:Array<{
    submissionId:string;photoId:string;photoGrantId:string;contributorAccountId:string
  }>}>('/assignments/v1/'+encodeURIComponent(assignmentId)+'/submissions')
  assertSame(s)
  return result.items
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
      const shared=(await listOutgoingGrants()).find(g=>g.id===op.prerequisiteGrantId)
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
