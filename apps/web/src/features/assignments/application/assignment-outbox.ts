import Dexie, { type Table } from 'dexie'
import { activeSession, requireSession } from '../../identity/application/session'
import { jsonApi } from '../../identity/infrastructure/api'
import { importSigner, sign, verify, importSpki } from '../../identity/infrastructure/crypto'
import { pinnedPeer } from '../../sharing/key-directory'
import { listOutgoingGrants } from '../../sharing/grant-flow'
import { sealAssignment, wrapAssignmentForRecipient } from '../infrastructure/assignment-crypto'
import type { AssignmentEnvelope, AssignmentInviteEnvelope, PrivateAssignment } from '../infrastructure/assignment-crypto'

export type AssignmentOperationKind='create'|'invite'|'accept'|'submit'
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
  state:string
  photoGoal:number|null
  policyRevision:number
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

class AssignmentDB extends Dexie {
  operations!:Table<AssignmentOperation,string>
  assignments!:Table<LocalAssignment,string>
  invites!:Table<CachedInvite,string>
  constructor(){
    super('pb3-assignment-operation-outbox-v1')
    this.version(1).stores({
      operations:'&id, accountId, [accountId+createdAt], [accountId+state]',
      assignments:'&id, ownerAccountId, [ownerAccountId+createdAt]',
      invites:'&inviteId, assignmentId, ownerAccountId, cachedForAccountId',
    })
  }
}
const db=new AssignmentDB()

function assertSame(s:ReturnType<typeof requireSession>):void {
  if(activeSession.value!==s)throw new Error('identity.changed')
}
function signDomain(kind:AssignmentOperationKind):string {
  return 'pb3.assignment-'+(
    kind==='create'?'':kind==='invite'?'invite':kind==='accept'?'accept':'submit')+'.v1\n'
}
function domain(kind:AssignmentOperationKind):string{
  return kind==='create'?'pb3.assignment.v1\n':signDomain(kind)
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

export async function listServerAssignments(after?:string):Promise<{
  items:AssignmentListing[];nextCursor:string|null
}>{
  const s=requireSession()
  if(!s.online)throw new Error('assignment.offline')
  const q=after?'?after='+encodeURIComponent(after):''
  const result=await jsonApi<{items:AssignmentListing[];nextCursor:string|null}>(
    '/assignments/v1'+q)
  assertSame(s)
  return result
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

export async function listAssignmentInvites():Promise<ReceivedAssignmentInvite[]>{
  const s=requireSession()
  if(s.online){
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
  return (await db.invites.where('cachedForAccountId').equals(s.accountId).toArray())
}

export async function verifyAssignmentInvite(
  invite:ReceivedAssignmentInvite,
):Promise<void>{
  const s=requireSession()
  const peer=await pinnedPeer(invite.ownerAccountId)
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
  assignmentId:string,photoId:string,photoGrantId:string,
):Promise<string>{
  const s=requireSession()
  const operationId=crypto.randomUUID()
  const op=await signedOperation('submit',
    '/assignments/v1/'+encodeURIComponent(assignmentId)+'/submissions',{
      version:1,submissionId:crypto.randomUUID(),operationId,
      assignmentId,contributorAccountId:s.accountId,
      photoId,photoGrantId,policyRevision:1,kind:'photo',
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
        state:/^api\.http_(401|403|410|422)$/.test(reason)?'conflict':'retry',
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
