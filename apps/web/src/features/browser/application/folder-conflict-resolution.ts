import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {emptyWorkspace} from '../domain/folders'
import type {FolderWorkspace} from '../domain/folders'
import {mergeFolderWorkspaces} from '../domain/folder-merge'
import type {ConflictSide,FolderMergeResult} from '../domain/folder-merge'
import {verifyAndOpenFolderSync} from './folder-sync-crypto'
import {
  getFolderLocalSync,applyFolderConflictResolution,
} from './folder-workspace'
import {synchronizeFolderWorkspace} from './folder-cloud-sync'
import type {FolderSyncResult} from './folder-cloud-sync'

type Snapshot={revision:number;contract:string|null;signature:string|null}
function live(s:Session):void{
  if(activeSession.value!==s)throw Error('browser.merge_session_changed')
}
async function signedWorkspace(s:Session,snapshot:Snapshot):Promise<FolderWorkspace>{
  if(!snapshot||!Number.isSafeInteger(snapshot.revision)
    ||snapshot.revision<0||snapshot.revision>100000000)
    throw Error('browser.merge_invalid_remote')
  if(snapshot.revision===0){
    if(snapshot.contract!==null||snapshot.signature!==null)
      throw Error('browser.merge_invalid_remote')
    return emptyWorkspace()
  }
  if(typeof snapshot.contract!=='string'||typeof snapshot.signature!=='string')
    throw Error('browser.merge_invalid_remote')
  const result=await verifyAndOpenFolderSync(s,{
    contract:snapshot.contract,signature:snapshot.signature,
  },snapshot.revision)
  live(s)
  return result
}
export type FolderConflictPlan={
  localRevision:number;baseRevision:number;remoteRevision:number
  pendingOperationId:string|null;remoteContract:string;remoteSignature:string
  base:FolderWorkspace;local:FolderWorkspace;cloud:FolderWorkspace
}
export function previewFolderConflict(
  plan:FolderConflictPlan,choices:Readonly<Record<string,ConflictSide>>={},
):FolderMergeResult{
  return mergeFolderWorkspaces(plan.base,plan.local,plan.cloud,choices)
}

/**
 * No unsigned "latest" claims are accepted. The exact common ancestor
 * comes from an immutable account-scoped signed event, not from a guessed
 * previous snapshot or unverifiable local baseline.
 */
export async function prepareFolderConflict():Promise<FolderConflictPlan>{
  const s=requireSession()
  if(!s.online||typeof navigator!=='undefined'&&navigator.onLine===false)
    throw Error('browser.sync_offline')
  const {workspace,localRevision,marker}=await getFolderLocalSync()
  live(s)
  const remote=await jsonApi<Snapshot>('/folders/v1/snapshot')
  live(s)
  if(!Number.isSafeInteger(remote.revision)
    ||remote.revision<=marker.baseRevision
    ||remote.revision>100000000)
    throw Error('browser.merge_remote_not_newer')
  const cloud=await signedWorkspace(s,remote)
  let base:FolderWorkspace
  if(marker.baseRevision===0)base=emptyWorkspace()
  else{
    const historic=await jsonApi<Snapshot>(
      '/folders/v1/revisions/'+marker.baseRevision)
    live(s)
    if(historic.revision!==marker.baseRevision)
      throw Error('browser.merge_wrong_ancestor')
    base=await signedWorkspace(s,historic)
  }
  const hasLocalChanges=localRevision!==marker.confirmedLocalRevision
    ||marker.pending!==null
  if(!hasLocalChanges)throw Error('browser.merge_no_local_changes')
  return {
    localRevision,baseRevision:marker.baseRevision,
    remoteRevision:remote.revision,
    pendingOperationId:marker.pending?.operationId??null,
    remoteContract:remote.contract!,remoteSignature:remote.signature!,
    base,local:workspace,cloud,
  }
}

export async function applyFolderConflictPlan(
  plan:FolderConflictPlan,choices:Readonly<Record<string,ConflictSide>>,
):Promise<FolderSyncResult>{
  const s=requireSession()
  if(!s.online||typeof navigator!=='undefined'&&navigator.onLine===false)
    throw Error('browser.sync_offline')
  const choiceResult=previewFolderConflict(plan,choices)
  if(!choiceResult.workspace||choiceResult.structuralError)
    throw Error('browser.merge_choices_or_structure_invalid')
  // Recheck the exact signed remote contract after the owner has reviewed
  // choices, before atomically replacing any device ciphertext.
  const current=await jsonApi<Snapshot>('/folders/v1/snapshot')
  live(s)
  if(current.revision!==plan.remoteRevision
    ||current.contract!==plan.remoteContract
    ||current.signature!==plan.remoteSignature)
    throw Error('browser.merge_remote_changed')
  if(!await applyFolderConflictResolution(
    choiceResult.workspace,plan.localRevision,plan.baseRevision,
    plan.pendingOperationId,plan.remoteRevision,
  ))throw Error('browser.merge_local_changed')
  live(s)
  // The original local encrypted row is now in recoverable local backup.
  // A further remote edit produces 409/conflict instead of silent overwrite.
  return synchronizeFolderWorkspace()
}
