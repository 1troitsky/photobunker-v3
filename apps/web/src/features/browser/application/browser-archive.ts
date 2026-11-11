import {activeSession,requireSession} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {importSigner,sign} from '../../identity/infrastructure/crypto'
import type {CatalogItem} from './catalog'
import {
  getPendingArchiveAction,savePendingArchiveAction,
  clearAcknowledgedArchiveAction,
} from './archive-outbox'
import type {ArchivePending} from './archive-outbox'

export type ArchiveEntry={
  entryId:string;kind:'photo'|'media';assetId:string
  revision:number;state:'archived'|'restored'|'deleting'
  archiveUntilMs:number|null;expiresAt:number
  mediaType:'photo'|'video'|'audio'|null;plainBytes:number|null
  physicalStatus:'not_started'|'pending_gc'|'verified_absent'
    |'past_due_pending_gc'
}
type Page={
  items:ArchiveEntry[];nextCursor:string|null
  writeEnabled:boolean;autoCleanupEnabled:boolean
}
export type ArchiveAction='archive'|'restore'|'delete'
export type ArchiveAck={
  entryId:string;kind:'photo'|'media';assetId:string
  state:'archived'|'restored'|'deleting';revision:number
  archiveUntilMs:number|null;expiresAt:number
  physicalStatus:string;unchanged:boolean
}

/** Owner-scoped server index, not evidence of physical S3 deletion. */
export async function listArchivePage(after:string|null=null):Promise<Page>{
  const session=requireSession()
  if(!session.online||typeof navigator!=='undefined'&&navigator.onLine===false)
    throw Error('browser.archive_offline')
  const path='/browser/v1/archive'+(after?'?after='+encodeURIComponent(after):'')
  const response=await jsonApi<Page>(path)
  if(activeSession.value!==session)throw Error('identity.changed')
  if(!Array.isArray(response.items)||response.items.length>50
    ||response.nextCursor!==null&&typeof response.nextCursor!=='string'
    ||typeof response.writeEnabled!=='boolean'
    ||typeof response.autoCleanupEnabled!=='boolean')
    throw Error('browser.archive_invalid_response')
  for(const item of response.items){
    if(!['photo','media'].includes(item.kind)
      ||!['archived','restored','deleting'].includes(item.state)
      ||!Number.isSafeInteger(item.revision)||item.revision<1
      ||!Number.isSafeInteger(item.expiresAt))
      throw Error('browser.archive_invalid_response')
  }
  return response
}

async function postPending(pending:ArchivePending):Promise<ArchiveAck>{
  const session=requireSession()
  if(!session.online||typeof navigator!=='undefined'&&navigator.onLine===false)
    throw Error('browser.archive_offline')
  const response=await jsonApi<ArchiveAck>('/browser/v1/archive/actions','POST',{
    command:pending.command,signature:pending.signature,
  })
  if(activeSession.value!==session)throw Error('identity.changed')
  validateAck(pending,response)
  // The same exact command/signature may return unchanged:true (Lost ACK),
  // but a new command with the same expectedRevision MUST NOT be substituted.
  await clearAcknowledgedArchiveAction(pending.operationId)
  return response
}
export type ArchivePendingInspection={
  status:'committed'|'obsolete'|'unresolved'
  currentRevision:number
  result:ArchiveAck|null
}
function validateAck(pending:ArchivePending,result:ArchiveAck):void{
  const desired=pending.action==='archive'?'archived'
    :pending.action==='restore'?'restored':'deleting'
  if(result.assetId!==pending.assetId||result.kind!==pending.kind
    ||result.revision!==pending.expectedRevision+1
    ||result.state!==desired||typeof result.unchanged!=='boolean')
    throw Error('browser.archive_invalid_ack')
}
/**
 * Server introspection is read-only even if the destructive archive gate is
 * OFF. Never discard an unknown pending operation: if its source revision is
 * still current, an in-flight original POST may yet commit.
 */
export async function inspectPendingArchiveAction():Promise<ArchivePendingInspection|null>{
  const session=requireSession()
  const pending=await getPendingArchiveAction()
  if(!pending)return null
  if(!session.online||typeof navigator!=='undefined'&&navigator.onLine===false)
    throw Error('browser.archive_offline')
  const answer=await jsonApi<ArchivePendingInspection>('/browser/v1/archive/inspect','POST',{
    command:pending.command,signature:pending.signature,
  })
  if(activeSession.value!==session)throw Error('identity.changed')
  if(!Number.isSafeInteger(answer.currentRevision)
    ||answer.currentRevision<0
    ||!['committed','obsolete','unresolved'].includes(answer.status))
    throw Error('browser.archive_invalid_inspection')
  if(answer.status==='committed'){
    if(!answer.result)throw Error('browser.archive_invalid_inspection')
    validateAck(pending,answer.result)
    await clearAcknowledgedArchiveAction(pending.operationId)
  }else{
    if(answer.result!==null
      ||answer.status==='obsolete'
        &&answer.currentRevision<=pending.expectedRevision
      ||answer.status==='unresolved'
        &&answer.currentRevision>pending.expectedRevision)
      throw Error('browser.archive_invalid_inspection')
  }
  return answer
}
/**
 * Explicit owner-reviewed discard ONLY after a second fresh signed server
 * check proves that the archive CAS revision moved beyond the old intent.
 * No timer, offline fallback, or network-failure response may invoke this.
 */
export async function discardObsoleteArchiveAction():Promise<void>{
  const session=requireSession()
  const pending=await getPendingArchiveAction()
  if(!pending)throw Error('browser.archive_pending_missing')
  const answer=await inspectPendingArchiveAction()
  if(activeSession.value!==session)throw Error('identity.changed')
  if(answer?.status!=='obsolete')
    throw Error('browser.archive_pending_not_obsolete')
  await clearAcknowledgedArchiveAction(pending.operationId)
}

/** Explicit retry after reload/failure. Never sign a second command. */
export async function retryPendingArchiveAction():Promise<ArchiveAck|null>{
  const pending=await getPendingArchiveAction()
  return pending===null?null:postPending(pending)
}
export {getPendingArchiveAction}

/**
 * Durable signed intent is saved under this device's nonextractable AES key
 * BEFORE network POST. Different intents cannot overtake a pending delete.
 */
export async function signedArchiveAction(
  item:CatalogItem|ArchiveEntry,action:ArchiveAction,
):Promise<ArchiveAck>{
  const session=requireSession()
  if(!session.online||typeof navigator!=='undefined'&&navigator.onLine===false)
    throw Error('browser.archive_offline')
  const fromCatalog='source' in item
  const kind=fromCatalog?item.source:item.kind
  const assetId=fromCatalog?item.id:item.assetId
  const expectedRevision=fromCatalog?0:item.revision
  if(!['photo','media'].includes(kind)
    ||!Number.isSafeInteger(expectedRevision)||expectedRevision<0
    ||!['archive','restore','delete'].includes(action))
    throw Error('browser.archive_invalid_intent')
  let pending=await getPendingArchiveAction()
  if(pending===null){
    const command=JSON.stringify({
      version:1,accountId:session.accountId,writerDeviceId:session.deviceId,
      operationId:crypto.randomUUID(),kind,assetId,action,expectedRevision,
    })
    const signature=await sign(await importSigner(session.pkg.accountPkcs8),
      'pb3.browser-archive.v1\n'+command)
    if(activeSession.value!==session)throw Error('identity.changed')
    pending=await savePendingArchiveAction({
      command,signature,kind,assetId,action,expectedRevision,
      operationId:(JSON.parse(command) as {operationId:string}).operationId,
      createdAt:Date.now(),
    })
  }
  if(pending.kind!==kind||pending.assetId!==assetId
    ||pending.action!==action||pending.expectedRevision!==expectedRevision)
    throw Error('browser.archive_pending_other_action')
  return postPending(pending)
}
