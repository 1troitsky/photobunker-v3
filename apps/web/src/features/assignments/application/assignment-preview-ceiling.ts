import Dexie,{type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {importSigner,importSpki,sign,verify} from '../../identity/infrastructure/crypto'
import {sha} from '../../local-storage/infrastructure/cipher'
import {
  emptyPreviewFields,PREVIEW_FIELD_KEYS,parseFilePreviewContract,
} from '../../media/application/media-file-preview-policy'
import type {
  PreviewFields,PreviewContract,
} from '../../media/application/media-file-preview-policy'
import type {AssignmentListing} from './assignment-outbox'

const URI='/assignments/v1'
const DOMAIN='pb3.assignment-preview-ceiling.v1\n'
const ZERO='0'.repeat(64)
const enc=new TextEncoder()
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const sha256=/^[a-f0-9]{64}$/
const keys=(o:object)=>Object.keys(o).sort().join('|')
export type AssignmentCeilingContract={
  version:1;operationId:string;assignmentId:string;ownerAccountId:string
  rootPolicyHash:string;fromRevision:number;toRevision:number
  previousPolicyHash:string;publication:'disabled'
  fields:PreviewFields;actions:{view:false;copy:false;download:false;share:false}
  expiresAt:number
}
export type CeilingDraftState='none'|'queued'|'retry'|'sent'|'conflict'
type Row={
  key:string;accountId:string;assignmentId:string
  contract:string;signature:string;state:Exclude<CeilingDraftState,'none'>
  error?:string
}
type Reply={
  assignmentId:string;revision:number;policyHash:string
  contract?:string;signature?:string;published:false;unchanged?:boolean
}
class Db extends Dexie{
  rows!:Table<Row,string>
  constructor(){
    super('pb3-private-assignment-preview-ceilings-v1')
    this.version(1).stores({rows:'&key,accountId,state'})
  }
}
const db=new Db()
export function parseAssignmentCeiling(raw:unknown):AssignmentCeilingContract{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw Error('assignment_preview.invalid_contract')
  const c=raw as AssignmentCeilingContract
  if(keys(c)!==[
    'version','operationId','assignmentId','ownerAccountId',
    'rootPolicyHash','fromRevision','toRevision','previousPolicyHash',
    'publication','fields','actions','expiresAt',
  ].sort().join('|')
    ||c.version!==1||c.publication!=='disabled'
    ||![c.operationId,c.assignmentId,c.ownerAccountId]
      .every(x=>typeof x==='string'&&uuid.test(x))
    ||![c.rootPolicyHash,c.previousPolicyHash]
      .every(x=>typeof x==='string'&&sha256.test(x))
    ||!Number.isSafeInteger(c.fromRevision)||c.fromRevision<0
    ||c.fromRevision>=100||c.toRevision!==c.fromRevision+1
    ||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=0
    ||!c.fields||typeof c.fields!=='object'||Array.isArray(c.fields)
    ||keys(c.fields)!==[...PREVIEW_FIELD_KEYS].sort().join('|')
    ||!PREVIEW_FIELD_KEYS.every(k=>typeof c.fields[k]==='boolean')
    ||!c.actions||typeof c.actions!=='object'||Array.isArray(c.actions)
    ||keys(c.actions)!=='copy|download|share|view'
    ||Object.values(c.actions).some(x=>x!==false))
    throw Error('assignment_preview.invalid_contract')
  return c
}

/**
 * Display-only upper ceiling comparison. NOT a credential, recipient grant,
 * verified photo-to-assignment provenance or public metadata response.
 * An unverified association cannot confer any effective public field access.
 */
export function comparePrivatePreviewCeilings(
  assignment:AssignmentCeilingContract|null,
  file:PreviewContract|null,
  associationVerifiedByServer=false,
):{candidateFields:PreviewFields;effectivePublicFields:PreviewFields}{
  const candidateFields=emptyPreviewFields()
  const effectivePublicFields=emptyPreviewFields()
  if(!assignment||!file)return {candidateFields,effectivePublicFields}
  parseAssignmentCeiling(assignment)
  parseFilePreviewContract(file)
  for(const field of PREVIEW_FIELD_KEYS){
    candidateFields[field]=assignment.fields[field]&&file.fields[field]
    // No public-grant/key-delivery/association exists in this version.
    // Even a verified server association would not authorize publication.
    effectivePublicFields[field]=false
  }
  void associationVerifiedByServer // reserved for future separately verified ACL
  return {candidateFields,effectivePublicFields}
}
const url=(id:string)=>URI+'/'+encodeURIComponent(id)+'/preview-ceiling'
const key=(account:string,id:string)=>account+'/'+id
function rootHash(listing:AssignmentListing):Promise<string>{
  return sha(enc.encode(listing.policyContract))
}
async function verifyReply(
  reply:Reply,session:ReturnType<typeof requireSession>,
  id:string,root:string,
):Promise<AssignmentCeilingContract>{
  if(!reply||reply.published!==false
    ||reply.assignmentId!==id||!reply.contract||!reply.signature
    ||!sha256.test(reply.policyHash))
    throw Error('assignment_preview.invalid_receipt')
  const contract=parseAssignmentCeiling(JSON.parse(reply.contract))
  if(JSON.stringify(contract)!==reply.contract
    ||contract.ownerAccountId!==session.accountId
    ||contract.assignmentId!==id||contract.rootPolicyHash!==root
    ||contract.toRevision!==reply.revision
    ||reply.policyHash!==await sha(enc.encode(reply.contract))
    ||!await verify(await importSpki(session.pkg.accountSpki),
      DOMAIN+reply.contract,reply.signature))
    throw Error('assignment_preview.invalid_receipt')
  return contract
}
export async function loadAssignmentPreviewCeiling(
  listing:AssignmentListing,
):Promise<{contract:AssignmentCeilingContract|null;state:CeilingDraftState}>{
  const session=requireSession()
  if(listing.ownerAccountId!==session.accountId)
    throw Error('assignment_preview.owner_required')
  const root=await rootHash(listing)
  const id=listing.assignmentId
  const row=await db.rows.get(key(session.accountId,id))
  if(row&&row.state!=='sent')
    return {contract:parseAssignmentCeiling(JSON.parse(row.contract)),
      state:row.state}
  if(session.online&&navigator.onLine){
    let response:Reply|null=null
    try{response=await jsonApi<Reply>(url(id))}
    catch(e){
      if(!(e instanceof Error&&e.message==='api.http_404'))throw e
    }
    if(activeSession.value!==session)throw Error('identity.changed')
    if(response){
      const contract=await verifyReply(response,session,id,root)
      await db.rows.put({
        key:key(session.accountId,id),
        accountId:session.accountId,assignmentId:id,
        contract:response.contract!,signature:response.signature!,
        state:'sent',
      })
      return {contract,state:'sent'}
    }
    if(row){
      await db.rows.update(row.key,{
        state:'conflict',error:'assignment_preview.remote_missing',
      })
      return {contract:null,state:'conflict'}
    }
    return {contract:null,state:'none'}
  }
  return row
    ?{contract:parseAssignmentCeiling(JSON.parse(row.contract)),
      state:row.state}
    :{contract:null,state:'none'}
}
export async function queueAssignmentPreviewCeiling(
  listing:AssignmentListing,fields:PreviewFields,
):Promise<number>{
  const session=requireSession()
  if(listing.ownerAccountId!==session.accountId
    ||listing.state!=='active')
    throw Error('assignment_preview.active_owner_required')
  const previous=await loadAssignmentPreviewCeiling(listing)
  if(previous.state==='queued'||previous.state==='retry'
    ||previous.state==='conflict')
    throw Error('assignment_preview.pending_revision')
  const fromRevision=previous.contract?.toRevision??0
  if(fromRevision>=100)throw Error('assignment_preview.max_revisions')
  const cutoff=Math.min(
    Date.now()+30*86400000,
    listing.filesAccessUntil??Number.POSITIVE_INFINITY,
    listing.assignmentAccessUntil??Number.POSITIVE_INFINITY,
  )
  if(cutoff<=Date.now())throw Error('assignment_preview.expired')
  const contract:AssignmentCeilingContract={
    version:1,operationId:crypto.randomUUID(),
    assignmentId:listing.assignmentId,ownerAccountId:session.accountId,
    rootPolicyHash:await rootHash(listing),
    fromRevision,toRevision:fromRevision+1,
    previousPolicyHash:previous.contract
      ?await sha(enc.encode(JSON.stringify(previous.contract))):ZERO,
    publication:'disabled',fields:{...fields},
    actions:{view:false,copy:false,download:false,share:false},
    expiresAt:Math.floor(cutoff),
  }
  parseAssignmentCeiling(contract)
  const json=JSON.stringify(contract)
  const signature=await sign(await importSigner(session.pkg.accountPkcs8),
    DOMAIN+json)
  if(activeSession.value!==session)throw Error('identity.changed')
  await db.rows.put({
    key:key(session.accountId,listing.assignmentId),
    accountId:session.accountId,assignmentId:listing.assignmentId,
    contract:json,signature,state:'queued',
  })
  void flushAssignmentPreviewCeilings()
  return contract.toRevision
}
let inflight:Promise<void>|null=null
let rerun=false
export function flushAssignmentPreviewCeilings():Promise<void>{
  if(inflight){rerun=true;return inflight}
  inflight=(async()=>{
    do{rerun=false;await flushPass()}
    while(rerun&&activeSession.value?.online&&navigator.onLine)
  })().finally(()=>{inflight=null})
  return inflight
}
async function flushPass():Promise<void>{
  const session=activeSession.value
  if(!session?.online||!navigator.onLine)return
  const rows=await db.rows.where('accountId')
    .equals(session.accountId).toArray()
  for(const row of rows.filter(x=>x.state==='queued'||x.state==='retry')){
    if(activeSession.value!==session)return
    try{
      const contract=parseAssignmentCeiling(JSON.parse(row.contract))
      const reply=await jsonApi<Reply>(url(row.assignmentId),'POST',{
        contract:row.contract,signature:row.signature,
      })
      if(activeSession.value!==session)throw Error('identity.changed')
      if(reply.published!==false||reply.assignmentId!==contract.assignmentId
        ||reply.revision!==contract.toRevision
        ||reply.policyHash!==await sha(enc.encode(row.contract)))
        throw Error('assignment_preview.invalid_receipt')
      await db.rows.update(row.key,{state:'sent',error:undefined})
    }catch(e){
      const reason=e instanceof Error?e.message:'assignment_preview.retry'
      await db.rows.update(row.key,{
        state:/^api\.http_(401|403|404|409|410|422)$/.test(reason)
          ||reason==='assignment_preview.invalid_receipt'
          ?'conflict':'retry',
        error:/^api\.http_\d+$/.test(reason)?reason
          :'assignment_preview.retry_required',
      })
    }
  }
}
export async function assignmentPreviewCeilingState(
  assignmentId:string,
):Promise<CeilingDraftState>{
  const session=requireSession()
  const row=await db.rows.get(key(session.accountId,assignmentId))
  return row?.state??'none'
}
