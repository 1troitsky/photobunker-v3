import Dexie,{type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {importSigner,importSpki,sign,verify} from '../../identity/infrastructure/crypto'
import {sha} from '../../local-storage/infrastructure/cipher'
import {requireSafeDerivativeCandidate} from './safe-derivatives'
import type {SafeDerivativeCandidate} from './safe-derivatives'
import {listLocalMedia} from './media-outbox'
import {loadFilePreviewDraft,emptyPreviewFields} from './media-file-preview-policy'
import type {PreviewFields} from './media-file-preview-policy'
import {
  loadAssignmentPreviewCeiling,parseAssignmentCeiling,
} from '../../assignments/application/assignment-preview-ceiling'
import {verifySignedAssignmentPolicy} from '../../assignments/application/assignment-outbox'
import type {AssignmentListing} from '../../assignments/application/assignment-outbox'

const DOMAIN='pb3.safe-assignment-editorial-link.v1\n'
const DETACH_DOMAIN='pb3.safe-assignment-editorial-detach.v1\n'
const URI='/media-file-preview/v1/assignment-links'
const enc=new TextEncoder()
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const digest=/^[a-f0-9]{64}$/
const exact=(x:object,names:string[])=>Object.keys(x).sort().join('|')
  ===names.sort().join('|')
export type EditorialLinkContract={
  version:1;linkId:string;operationId:string;ownerAccountId:string
  assignmentId:string;sourceMediaId:string;safeMediaId:string
  sourceContractHash:string;safeContractHash:string
  assignmentRootHash:string;expiresAt:number
}
export type EditorialDetachContract={
  version:1;operationId:string;linkId:string;ownerAccountId:string
  safeMediaId:string;linkContractHash:string;action:'detach'
}
export type EditorialBinding={
  linkId:string;assignmentId:string;safeMediaId:string
  sourceMediaId:string;contract:string;signature:string;contractHash:string
  candidateFields:PreviewFields;effectivePublicFields:PreviewFields
  linked:true;published:false;unchanged?:boolean
}
type Row={
  key:string;accountId:string;safeMediaId:string
  contract:string;signature:string;kind:'link'|'detach'
  state:'queued'|'retry'|'sent'|'conflict';error?:string
}
class Db extends Dexie{
  operations!:Table<Row,string>
  constructor(){
    super('pb3-safe-editorial-association-outbox-v1')
    this.version(1).stores({operations:'&key,accountId,state'})
  }
}
const db=new Db()
const names=[
  'version','linkId','operationId','ownerAccountId','assignmentId',
  'sourceMediaId','safeMediaId','sourceContractHash','safeContractHash',
  'assignmentRootHash','expiresAt',
]
export function parseEditorialLink(x:unknown):EditorialLinkContract{
  if(!x||typeof x!=='object'||Array.isArray(x))
    throw Error('safe_editorial.invalid_contract')
  const c=x as EditorialLinkContract
  if(!exact(c,[...names])||c.version!==1
    ||![c.linkId,c.operationId,c.ownerAccountId,
      c.assignmentId,c.sourceMediaId,c.safeMediaId]
      .every(v=>typeof v==='string'&&id.test(v))
    ||c.safeMediaId===c.sourceMediaId
    ||![c.sourceContractHash,c.safeContractHash,c.assignmentRootHash]
      .every(v=>typeof v==='string'&&digest.test(v))
    ||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=0)
    throw Error('safe_editorial.invalid_contract')
  return c
}
export function parseEditorialDetach(x:unknown):EditorialDetachContract{
  if(!x||typeof x!=='object'||Array.isArray(x))
    throw Error('safe_editorial.invalid_detach')
  const c=x as EditorialDetachContract
  if(!exact(c,[
    'version','operationId','linkId','ownerAccountId',
    'safeMediaId','linkContractHash','action',
  ])||c.version!==1||c.action!=='detach'
    ||![c.operationId,c.linkId,c.ownerAccountId,c.safeMediaId]
      .every(v=>typeof v==='string'&&id.test(v))
    ||typeof c.linkContractHash!=='string'
    ||!digest.test(c.linkContractHash))
    throw Error('safe_editorial.invalid_detach')
  return c
}
async function verifiedReceipt(
  response:EditorialBinding,expected?:EditorialLinkContract,
):Promise<EditorialBinding>{
  const session=requireSession()
  if(response.published!==false||response.linked!==true
    ||!response.contract||!response.signature
    ||!digest.test(response.contractHash))
    throw Error('safe_editorial.invalid_receipt')
  const c=parseEditorialLink(JSON.parse(response.contract))
  if(JSON.stringify(c)!==response.contract
    ||c.ownerAccountId!==session.accountId
    ||c.linkId!==response.linkId
    ||c.safeMediaId!==response.safeMediaId
    ||c.sourceMediaId!==response.sourceMediaId
    ||c.assignmentId!==response.assignmentId
    ||response.contractHash!==await sha(enc.encode(response.contract))
    ||expected&&JSON.stringify(expected)!==response.contract
    ||!await verify(await importSpki(session.pkg.accountSpki),
      DOMAIN+response.contract,response.signature))
    throw Error('safe_editorial.invalid_receipt')
  if(!response.candidateFields||!response.effectivePublicFields)
    throw Error('safe_editorial.invalid_receipt')
  const zero=emptyPreviewFields()
  if(Object.keys(zero).some(k=>response.effectivePublicFields[k as keyof PreviewFields]!==false
    ||typeof response.candidateFields[k as keyof PreviewFields]!=='boolean'))
    throw Error('safe_editorial.invalid_public_right')
  return response
}
const key=(account:string,safe:string)=>account+'/'+safe
export async function readEditorialLink(
  safeMediaId:string,
):Promise<EditorialBinding|null>{
  const session=requireSession()
  if(!session.online||!navigator.onLine)return null
  try{
    const data=await jsonApi<EditorialBinding>(
      URI+'/'+encodeURIComponent(safeMediaId))
    if(activeSession.value!==session)throw Error('identity.changed')
    return verifiedReceipt(data)
  }catch(e){
    if(e instanceof Error&&e.message==='api.http_404')return null
    throw e
  }
}
/** A signed, independent proof of ownership, never a contributor receipt. */
export async function queueEditorialLink(
  candidate:SafeDerivativeCandidate,assignment:AssignmentListing,
):Promise<string>{
  const session=requireSession()
  if(candidate.accountId!==session.accountId
    ||assignment.ownerAccountId!==session.accountId
    ||assignment.state!=='active')
    throw Error('safe_editorial.owner_only')
  await verifySignedAssignmentPolicy(assignment,!session.online)
  const safe=await requireSafeDerivativeCandidate(
    candidate.sourceMediaId,candidate.safeMediaId)
  const [file,ceil,media,prior]=await Promise.all([
    loadFilePreviewDraft(candidate.safeMediaId),
    loadAssignmentPreviewCeiling(assignment),
    listLocalMedia(),
    db.operations.get(key(session.accountId,candidate.safeMediaId)),
  ])
  if(prior)throw Error('safe_editorial.already_linked_or_pending')
  if(file.state!=='sent'||!file.contract
    ||ceil.state!=='sent'||!ceil.contract
    ||file.contract.sourceMediaId!==safe.sourceMediaId
    ||file.contract.safeMediaId!==safe.safeMediaId)
    throw Error('safe_editorial.signed_ceilings_required')
  parseAssignmentCeiling(ceil.contract)
  const source=media.find(m=>m.mediaId===candidate.sourceMediaId)
  const derivative=media.find(m=>m.mediaId===candidate.safeMediaId)
  if(!source||!derivative||source.state!=='synced'
    ||derivative.state!=='synced')
    throw Error('safe_editorial.media_not_synced')
  const cutoff=Math.min(
    Date.now()+86400000,
    file.contract.expiresAt,ceil.contract.expiresAt,
    source.expiresAt,derivative.expiresAt,
    assignment.filesAccessUntil??Number.POSITIVE_INFINITY,
    assignment.assignmentAccessUntil??Number.POSITIVE_INFINITY,
  )
  if(cutoff<=Date.now())throw Error('safe_editorial.expired')
  const c:EditorialLinkContract={
    version:1,linkId:crypto.randomUUID(),operationId:crypto.randomUUID(),
    ownerAccountId:session.accountId,assignmentId:assignment.assignmentId,
    sourceMediaId:safe.sourceMediaId,safeMediaId:safe.safeMediaId,
    sourceContractHash:safe.sourceContractHash,
    safeContractHash:safe.safeContractHash,
    assignmentRootHash:await sha(enc.encode(assignment.policyContract)),
    expiresAt:Math.floor(cutoff),
  }
  parseEditorialLink(c)
  const raw=JSON.stringify(c)
  const signature=await sign(await importSigner(session.pkg.accountPkcs8),
    DOMAIN+raw)
  if(activeSession.value!==session)throw Error('identity.changed')
  await db.operations.add({
    key:key(session.accountId,c.safeMediaId),accountId:session.accountId,
    safeMediaId:c.safeMediaId,contract:raw,signature,kind:'link',
    state:'queued',
  })
  void flushEditorialLinks()
  return c.linkId
}
export async function queueEditorialDetach(
  association:EditorialBinding,
):Promise<void>{
  const session=requireSession()
  const verified=await verifiedReceipt(association)
  const prior=await db.operations.get(key(session.accountId,
    verified.safeMediaId))
  if(prior&&prior.state!=='sent')
    throw Error('safe_editorial.pending')
  const c:EditorialDetachContract={
    version:1,operationId:crypto.randomUUID(),
    linkId:verified.linkId,ownerAccountId:session.accountId,
    safeMediaId:verified.safeMediaId,
    linkContractHash:verified.contractHash,action:'detach',
  }
  parseEditorialDetach(c)
  const raw=JSON.stringify(c)
  const signature=await sign(await importSigner(session.pkg.accountPkcs8),
    DETACH_DOMAIN+raw)
  if(activeSession.value!==session)throw Error('identity.changed')
  await db.operations.put({
    key:key(session.accountId,verified.safeMediaId),
    accountId:session.accountId,safeMediaId:verified.safeMediaId,
    contract:raw,signature,kind:'detach',state:'queued',
  })
  void flushEditorialLinks()
}
export async function editorialLinkState(
  safeMediaId:string,
):Promise<'none'|Row['state']>{
  const session=requireSession()
  return (await db.operations.get(key(session.accountId,safeMediaId)))
    ?.state??'none'
}
let running:Promise<void>|null=null
let rerun=false
export function flushEditorialLinks():Promise<void>{
  if(running){rerun=true;return running}
  running=(async()=>{
    do{rerun=false;await flushPass()}
    while(rerun&&activeSession.value?.online&&navigator.onLine)
  })().finally(()=>{running=null})
  return running
}
async function flushPass():Promise<void>{
  const session=activeSession.value
  if(!session?.online||!navigator.onLine)return
  const rows=await db.operations.where('accountId')
    .equals(session.accountId).toArray()
  for(const row of rows.filter(x=>x.state==='queued'||x.state==='retry')){
    if(activeSession.value!==session)return
    try{
      const posted=row.kind==='link'
        ?await jsonApi<EditorialBinding>(URI,'POST',{
          contract:row.contract,signature:row.signature,
        })
        :await jsonApi<{linked:boolean;published:boolean;safeMediaId:string}>(
          URI+'/'+encodeURIComponent(row.safeMediaId)+'/detach','POST',{
            contract:row.contract,signature:row.signature,
          })
      if(activeSession.value!==session)throw Error('identity.changed')
      if(row.kind==='link'){
        await verifiedReceipt(posted as EditorialBinding,
          parseEditorialLink(JSON.parse(row.contract)))
      }else if(posted.linked!==false||posted.published!==false
        ||posted.safeMediaId!==row.safeMediaId){
        throw Error('safe_editorial.invalid_detach_receipt')
      }
      await db.operations.update(row.key,{state:'sent',error:undefined})
    }catch(e){
      const reason=e instanceof Error?e.message:'safe_editorial.retry'
      await db.operations.update(row.key,{
        state:/^api\.http_(401|403|404|409|410|422)$/.test(reason)
          ||reason.startsWith('safe_editorial.invalid_')
          ?'conflict':'retry',
        error:/^api\.http_\d+$/.test(reason)?reason
          :'safe_editorial.retry_required',
      })
    }
  }
}
