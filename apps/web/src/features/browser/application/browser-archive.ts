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
  const correctState=pending.action==='archive'?'archived'
    :pending.action==='restore'?'restored':'deleting'
  if(response.assetId!==pending.assetId||response.kind!==pending.kind
    ||response.revision!==pending.expectedRevision+1
    ||response.state!==correctState
    ||typeof response.unchanged!=='boolean')
    throw Error('browser.archive_invalid_ack')
  // The same exact command/signature may return unchanged:true (Lost ACK),
  // but a new command with the same expectedRevision MUST NOT be substituted.
  await clearAcknowledgedArchiveAction(pending.operationId)
  return response
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
      'pb3.browser-archive.v1\\n'+command)
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
