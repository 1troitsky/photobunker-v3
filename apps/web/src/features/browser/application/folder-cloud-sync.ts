import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {
  getFolderLocalSync,stageFolderUpload,
  acknowledgeFolderUpload,installRemoteFolderWorkspace,
} from './folder-workspace'
import type {FolderPendingUpload} from './folder-workspace'
import {
  createFolderSyncContract,verifyAndOpenFolderSync,parseFolderContract,
} from './folder-sync-crypto'

export type FolderSyncStatus='up-to-date'|'uploaded'|'downloaded'
  |'empty'|'conflict'
export type FolderSyncResult={state:FolderSyncStatus;revision:number}
type ServerFolderSnapshot={
  revision:number;contract:string|null;signature:string|null
}
type ServerFolderAck={revision:number;unchanged:boolean}

function live(s:Session):void{
  if(activeSession.value!==s)throw Error('browser.sync_session_changed')
}
function revisionValid(revision:unknown):revision is number{
  return typeof revision==='number'&&Number.isSafeInteger(revision)
    &&revision>=0&&revision<100000001
}
async function remoteSnapshot(s:Session):Promise<ServerFolderSnapshot>{
  const remote=await jsonApi<ServerFolderSnapshot>('/folders/v1/snapshot')
  live(s)
  if(!revisionValid(remote.revision))throw Error('browser.sync_invalid_revision')
  if(remote.revision===0){
    if(remote.contract!==null||remote.signature!==null)
      throw Error('browser.sync_invalid_snapshot')
  }else if(typeof remote.contract!=='string'
    ||typeof remote.signature!=='string'
    ||parseFolderContract(remote.contract).toRevision!==remote.revision){
    throw Error('browser.sync_invalid_snapshot')
  }
  return remote
}
async function uploadPending(
  s:Session,pending:FolderPendingUpload,
):Promise<'ack'|'conflict'>{
  live(s)
  let ack:ServerFolderAck
  try{
    ack=await jsonApi<ServerFolderAck>('/folders/v1/snapshot','POST',{
      contract:pending.contract,signature:pending.signature,
    })
  }catch(e){
    // 409 means another device won the revision race. Never discard this
    // device's encrypted outbox or silently resolve conflicts by LWW.
    if(e instanceof Error&&e.message==='api.http_409')return 'conflict'
    throw e
  }
  live(s)
  if(ack.revision!==pending.toRevision
    ||typeof ack.unchanged!=='boolean')
    throw Error('browser.sync_invalid_ack')
  await acknowledgeFolderUpload(pending.operationId,pending.toRevision)
  return 'ack'
}

/**
 * Explicit, bounded sync. No reliance on Matrix. Failed/ambiguous sends remain
 * in the durable encrypted-ciphertext outbox. A later retry uses identical
 * operationId/signature to survive Lost ACK. All local edits remain visible.
 */
async function synchronize(s:Session):Promise<FolderSyncResult>{
  if(!s.online||typeof navigator!=='undefined'&&navigator.onLine===false)
    throw Error('browser.sync_offline')
  live(s)
  let {workspace,localRevision,marker}=await getFolderLocalSync()
  if(marker.pending){
    const result=await uploadPending(s,marker.pending)
    if(result==='conflict')return {state:'conflict',revision:marker.baseRevision}
    ;({workspace,localRevision,marker}=await getFolderLocalSync())
  }
  const remote=await remoteSnapshot(s)
  if(remote.revision<marker.baseRevision)
    throw Error('browser.sync_remote_rollback')
  const dirty=localRevision!==marker.confirmedLocalRevision
  if(remote.revision>marker.baseRevision){
    if(dirty||marker.pending)
      return {state:'conflict',revision:remote.revision}
    if(!remote.contract||!remote.signature)
      throw Error('browser.sync_invalid_snapshot')
    const next=await verifyAndOpenFolderSync(s,{
      contract:remote.contract,signature:remote.signature,
    },remote.revision)
    live(s)
    if(!await installRemoteFolderWorkspace(
      next,localRevision,marker.baseRevision,remote.revision,
    ))return {state:'conflict',revision:remote.revision}
    return {state:'downloaded',revision:remote.revision}
  }
  if(!dirty)return {
    state:remote.revision===0?'empty':'up-to-date',revision:remote.revision,
  }
  const operationId=crypto.randomUUID()
  const signed=await createFolderSyncContract(s,workspace,
    marker.baseRevision,operationId)
  live(s)
  const pending:FolderPendingUpload={
    operationId,...signed,localRevision,
    fromRevision:marker.baseRevision,toRevision:marker.baseRevision+1,
  }
  if(!await stageFolderUpload(localRevision,marker.baseRevision,pending))
    return {state:'conflict',revision:marker.baseRevision}
  const result=await uploadPending(s,pending)
  if(result==='conflict')return {state:'conflict',revision:marker.baseRevision}
  return {state:'uploaded',revision:pending.toRevision}
}

export async function synchronizeFolderWorkspace():Promise<FolderSyncResult>{
  const s=requireSession()
  if(typeof navigator!=='undefined'&&navigator.locks?.request)
    return navigator.locks.request('pb3/browser/folder-cloud/'+s.accountId
      +'/'+s.deviceId,()=>synchronize(s))
  return synchronize(s)
}
