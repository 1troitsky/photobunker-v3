import {activeSession,requireSession} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {importSigner,sign} from '../../identity/infrastructure/crypto'
import type {CatalogItem} from './catalog'

export type ArchiveEntry={
  entryId:string;kind:'photo'|'media';assetId:string
  revision:number;state:'archived'|'deleting'
  archiveUntilMs:number|null;expiresAt:number
  mediaType:'photo'|'video'|'audio'|null;plainBytes:number|null
  physicalStatus:'not_started'|'pending_gc'|'verified_absent'
    |'past_due_pending_gc'
}
type Page={items:ArchiveEntry[];nextCursor:string|null}
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
    ||response.nextCursor!==null&&typeof response.nextCursor!=='string')
    throw Error('browser.archive_invalid_response')
  for(const item of response.items){
    if(!['photo','media'].includes(item.kind)
      ||!['archived','deleting'].includes(item.state)
      ||!Number.isSafeInteger(item.revision)||item.revision<1
      ||!Number.isSafeInteger(item.expiresAt))
      throw Error('browser.archive_invalid_response')
  }
  return response
}

/** Capture the exact account-signed intent before any network side effect. */
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
  const command=JSON.stringify({
    version:1,accountId:session.accountId,writerDeviceId:session.deviceId,
    operationId:crypto.randomUUID(),kind,assetId,action,expectedRevision,
  })
  const signature=await sign(await importSigner(session.pkg.accountPkcs8),
    'pb3.browser-archive.v1\n'+command)
  if(activeSession.value!==session)throw Error('identity.changed')
  const result=await jsonApi<ArchiveAck>('/browser/v1/archive/actions','POST',{
    command,signature,
  })
  if(activeSession.value!==session)throw Error('identity.changed')
  if(result.assetId!==assetId||result.kind!==kind
    ||result.revision!==expectedRevision+1||result.unchanged!==false
    ||result.state!==(action==='archive'?'archived':action==='restore'?'restored':'deleting'))
    throw Error('browser.archive_invalid_ack')
  return result
}
