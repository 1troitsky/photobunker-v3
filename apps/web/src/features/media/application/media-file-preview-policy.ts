import Dexie,{type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {importSigner,importSpki,sign,verify} from '../../identity/infrastructure/crypto'
import {sha} from '../../local-storage/infrastructure/cipher'
import {requireSafeDerivativeCandidate} from './safe-derivatives'
import {listLocalMedia} from './media-outbox'

const URI='/media-file-preview/v1/policies'
const DOMAIN='pb3.media-file-preview-policy.v1\n'
const ZERO='0'.repeat(64)
const enc=new TextEncoder()
export const PREVIEW_FIELD_KEYS=[
  'description','capturedAt','updatedAt','tags','authorTeam','gps','metadata',
] as const
export type PreviewField=typeof PREVIEW_FIELD_KEYS[number]
export type PreviewFields=Record<PreviewField,boolean>
type PreviewActions={view:false;copy:false;download:false;share:false}
export type PreviewContract={
  version:1;operationId:string;accountId:string
  sourceMediaId:string;safeMediaId:string
  sourceContractHash:string;safeContractHash:string
  fromRevision:number;toRevision:number;previousPolicyHash:string
  publication:'disabled';fields:PreviewFields;actions:PreviewActions
  expiresAt:number
}
type PreviewReply={
  safeMediaId:string;sourceMediaId?:string;revision:number
  policyHash:string;published:false;contract?:string;signature?:string
  unchanged?:boolean
}
type Row={
  key:string;accountId:string;safeMediaId:string
  contract:string;signature:string
  state:'queued'|'retry'|'sent'|'conflict'
  error?:string
}
class PolicyDb extends Dexie{
  policies!:Table<Row,string>
  constructor(){
    super('pb3-safe-file-preview-drafts-v1')
    this.version(1).stores({policies:'&key,accountId,state'})
  }
}
const db=new PolicyDb()
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const hash=/^[a-f0-9]{64}$/
const sorted=(keys:string[])=>[...keys].sort().join('|')
const fieldNames=sorted([...PREVIEW_FIELD_KEYS])
const actionNames=sorted(['view','copy','download','share'])
const contractNames=sorted([
  'version','operationId','accountId','sourceMediaId','safeMediaId',
  'sourceContractHash','safeContractHash','fromRevision','toRevision',
  'previousPolicyHash','publication','fields','actions','expiresAt',
])
export function emptyPreviewFields():PreviewFields{
  return {
    description:false,capturedAt:false,updatedAt:false,
    tags:false,authorTeam:false,gps:false,metadata:false,
  }
}
export function parseFilePreviewContract(raw:unknown):PreviewContract{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw Error('file_preview.invalid_contract')
  const c=raw as PreviewContract
  if(sorted(Object.keys(c))!==contractNames
    ||c.version!==1||c.publication!=='disabled'
    ||![c.operationId,c.accountId,c.sourceMediaId,c.safeMediaId]
      .every(id=>typeof id==='string'&&uuid.test(id))
    ||c.sourceMediaId===c.safeMediaId
    ||![c.sourceContractHash,c.safeContractHash,c.previousPolicyHash]
      .every(h=>typeof h==='string'&&hash.test(h))
    ||!Number.isSafeInteger(c.fromRevision)||c.fromRevision<0
    ||c.fromRevision>=100||c.toRevision!==c.fromRevision+1
    ||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=0
    ||!c.fields||typeof c.fields!=='object'||Array.isArray(c.fields)
    ||sorted(Object.keys(c.fields))!==fieldNames
    ||!PREVIEW_FIELD_KEYS.every(k=>typeof c.fields[k]==='boolean')
    ||!c.actions||typeof c.actions!=='object'||Array.isArray(c.actions)
    ||sorted(Object.keys(c.actions))!==actionNames
    ||Object.values(c.actions).some(v=>v!==false))
    throw Error('file_preview.invalid_contract')
  return c
}
function keyFor(accountId:string,safeMediaId:string):string{
  return accountId+'/'+safeMediaId
}
async function verifyReply(
  reply:PreviewReply,accountId:string,safeMediaId:string,
  spki:string,
):Promise<PreviewContract>{
  if(reply.published!==false||reply.safeMediaId!==safeMediaId
    ||!reply.contract||!reply.signature
    ||!hash.test(reply.policyHash))
    throw Error('file_preview.invalid_receipt')
  const contract=parseFilePreviewContract(JSON.parse(reply.contract))
  if(JSON.stringify(contract)!==reply.contract
    ||contract.accountId!==accountId
    ||contract.safeMediaId!==safeMediaId
    ||reply.revision!==contract.toRevision
    ||reply.sourceMediaId!==undefined
      &&reply.sourceMediaId!==contract.sourceMediaId
    ||reply.policyHash!==await sha(enc.encode(reply.contract))
    ||!await verify(await importSpki(spki),DOMAIN+reply.contract,
      reply.signature))
    throw Error('file_preview.invalid_receipt')
  return contract
}
async function remoteLatest(safeMediaId:string):Promise<PreviewReply|null>{
  try{
    return await jsonApi<PreviewReply>(URI+'/'+encodeURIComponent(safeMediaId))
  }catch(e){
    if(e instanceof Error&&e.message==='api.http_404')return null
    throw e
  }
}
/** Only owner can read this signed preview; it is not a public card. */
export async function loadFilePreviewDraft(
  safeMediaId:string,
):Promise<{contract:PreviewContract|null;state:Row['state']|'none'}>{
  const session=requireSession()
  const key=keyFor(session.accountId,safeMediaId)
  const row=await db.policies.get(key)
  if(row&&row.state!=='sent'){
    const contract=parseFilePreviewContract(JSON.parse(row.contract))
    return {contract,state:row.state}
  }
  if(session.online&&navigator.onLine){
    const remote=await remoteLatest(safeMediaId)
    if(activeSession.value!==session)throw Error('identity.changed')
    if(remote){
      const contract=await verifyReply(
        remote,session.accountId,safeMediaId,session.pkg.accountSpki)
      await db.policies.put({
        key,accountId:session.accountId,safeMediaId,
        contract:remote.contract!,signature:remote.signature!,state:'sent',
      })
      return {contract,state:'sent'}
    }
  }
  return row
    ?{contract:parseFilePreviewContract(JSON.parse(row.contract)),state:row.state}
    :{contract:null,state:'none'}
}
/**
 * Offline-first, signed preview-ceiling only. The app can never publish via
 * this module. A conflicted/stale local revision must be resolved explicitly.
 */
export async function queueFilePreviewDraft(
  sourceMediaId:string,safeMediaId:string,fields:PreviewFields,
):Promise<number>{
  const session=requireSession()
  const candidate=await requireSafeDerivativeCandidate(sourceMediaId,safeMediaId)
  const media=await listLocalMedia()
  const source=media.find(m=>m.mediaId===sourceMediaId)
  const safe=media.find(m=>m.mediaId===safeMediaId)
  if(!source||!safe||source.accountId!==session.accountId
    ||safe.accountId!==session.accountId)
    throw Error('file_preview.source_missing')
  const previous=await loadFilePreviewDraft(safeMediaId)
  if(previous.state==='queued'||previous.state==='retry'
    ||previous.state==='conflict')
    throw Error('file_preview.pending_revision')
  const from=previous.contract?.toRevision??0
  if(from>=100)throw Error('file_preview.max_revisions')
  const previousHash=previous.contract
    ?await sha(enc.encode(JSON.stringify(previous.contract))):ZERO
  const expiresAt=Math.min(source.expiresAt,safe.expiresAt)
  if(expiresAt<=Date.now())throw Error('file_preview.source_expired')
  const contract:PreviewContract={
    version:1,operationId:crypto.randomUUID(),accountId:session.accountId,
    sourceMediaId,safeMediaId,
    sourceContractHash:candidate.sourceContractHash,
    safeContractHash:candidate.safeContractHash,
    fromRevision:from,toRevision:from+1,
    previousPolicyHash:previousHash,
    publication:'disabled',fields:{...fields},
    actions:{view:false,copy:false,download:false,share:false},
    expiresAt,
  }
  parseFilePreviewContract(contract) // Fail closed before signing/persisting.
  const json=JSON.stringify(contract)
  const signature=await sign(await importSigner(session.pkg.accountPkcs8),
    DOMAIN+json)
  if(activeSession.value!==session)throw Error('identity.changed')
  await db.policies.put({
    key:keyFor(session.accountId,safeMediaId),accountId:session.accountId,
    safeMediaId,contract:json,signature,state:'queued',
  })
  void flushFilePreviewDrafts()
  return contract.toRevision
}
let running:Promise<void>|null=null
let rerun=false
export function flushFilePreviewDrafts():Promise<void>{
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
  const rows=await db.policies.where('accountId')
    .equals(session.accountId).toArray()
  for(const row of rows.filter(x=>x.state==='queued'||x.state==='retry')){
    if(activeSession.value!==session)return
    try{
      const expected=parseFilePreviewContract(JSON.parse(row.contract))
      const reply=await jsonApi<PreviewReply>(URI,'POST',{
        contract:row.contract,signature:row.signature,
      })
      if(activeSession.value!==session)throw Error('identity.changed')
      if(reply.published!==false
        ||reply.safeMediaId!==expected.safeMediaId
        ||reply.revision!==expected.toRevision
        ||reply.policyHash!==await sha(enc.encode(row.contract)))
        throw Error('file_preview.invalid_receipt')
      await db.policies.update(row.key,{state:'sent',error:undefined})
    }catch(e){
      const reason=e instanceof Error?e.message:'file_preview.retry'
      await db.policies.update(row.key,{
        state:/^api\.http_(401|403|404|409|410|422)$/.test(reason)
          ||reason==='file_preview.invalid_receipt'
          ?'conflict':'retry',
        error:/^api\.http_\d+$/.test(reason)
          ?reason:'file_preview.retry_required',
      })
    }
  }
}
export async function filePreviewDraftStatus(
  safeMediaId:string,
):Promise<'none'|Row['state']>{
  const session=requireSession()
  const row=await db.policies.get(keyFor(session.accountId,safeMediaId))
  return row?.state??'none'
}
