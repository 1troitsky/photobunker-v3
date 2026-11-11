import Dexie,{type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {b64,unb64} from '../../identity/infrastructure/crypto'
import {
  emptyWorkspace,validateWorkspace,addFolder,renameFolder,
  moveFolder,moveFile,moveFiles,removeEmptyFolder,
} from '../domain/folders'
import type {FolderWorkspace} from '../domain/folders'

type SealedWorkspace={
  key:string;version:1;revision:number;iv:string;ciphertext:string
}
export type FolderPendingUpload={
  operationId:string;contract:string;signature:string
  localRevision:number;fromRevision:number;toRevision:number
}
export type FolderSyncMarker={
  key:string;baseRevision:number;confirmedLocalRevision:number
  pending:FolderPendingUpload|null
}
class FolderDB extends Dexie{
  rows!:Table<SealedWorkspace,string>
  sync!:Table<FolderSyncMarker,string>
  constructor(){
    super('pb3-browser-device-folders-v1')
    this.version(1).stores({rows:'&key'})
    // Migration preserves ALL v1 device ciphertext; no plaintext or destructive
    // schema replacement. The sync cursor stores only versions + ciphertext.
    this.version(2).stores({rows:'&key',sync:'&key'})
  }
}
const db=new FolderDB()
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true})
function scoped(s:Session):string{return s.accountId+'/'+s.deviceId}
function same(s:Session):void{
  if(activeSession.value!==s)throw Error('identity.account_changed')
}
function aad(s:Session,revision:number):Uint8Array<ArrayBuffer>{
  return enc.encode(JSON.stringify({
    domain:'pb3/browser/local-folders/v1',accountId:s.accountId,
    deviceId:s.deviceId,revision,
  }))
}
async function unseal(s:Session,row:SealedWorkspace|undefined):Promise<FolderWorkspace>{
  same(s)
  if(!row)return emptyWorkspace()
  if(row.version!==1||row.key!==scoped(s)
    ||!Number.isSafeInteger(row.revision)||row.revision<1
    ||row.iv.length>64||row.ciphertext.length>200000)
    throw Error('browser.folder_invalid_envelope')
  const iv=unb64(row.iv,12)
  const encrypted=unb64(row.ciphertext)
  if(encrypted.length<16||encrypted.length>130000)
    throw Error('browser.folder_invalid_envelope')
  const plain=new Uint8Array(await crypto.subtle.decrypt({
    name:'AES-GCM',iv,additionalData:aad(s,row.revision),tagLength:128,
  },s.device.encryptionKey,encrypted))
  same(s)
  try{return validateWorkspace(JSON.parse(dec.decode(plain)) as unknown)}
  finally{plain.fill(0)}
}
async function seal(s:Session,workspace:FolderWorkspace,revision:number):Promise<SealedWorkspace>{
  validateWorkspace(workspace)
  const plain=enc.encode(JSON.stringify(workspace))
  if(plain.byteLength>120000)throw Error('browser.folder_limit')
  const iv=crypto.getRandomValues(new Uint8Array(12))
  try{
    same(s)
    const ciphertext=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:aad(s,revision),tagLength:128,
    },s.device.encryptionKey,plain)
    same(s)
    return {key:scoped(s),version:1,revision,iv:b64(iv),ciphertext:b64(ciphertext)}
  }finally{plain.fill(0)}
}
/**
 * Device-only encrypted organizational metadata, not server authoritative
 * location. A file's immutable ID/TTL, cloud payload and grants NEVER move.
 * The nonextractable device encryption key protects folder names and file
 * membership in IndexedDB; another device has its own independent workspace.
 */
export async function loadFolderWorkspace():Promise<FolderWorkspace>{
  const s=requireSession()
  const row=await db.rows.get(scoped(s))
  return unseal(s,row)
}
type Change={kind:'add';name:string;parentId:string|null;id:string;at:number}
  |{kind:'rename';id:string;name:string}
  |{kind:'move-folder';id:string;parentId:string|null}
  |{kind:'move-file';key:string;folderId:string|null}
  |{kind:'move-files';keys:string[];folderId:string|null}
  |{kind:'remove-empty';id:string}
function apply(s:FolderWorkspace,change:Change):FolderWorkspace{
  switch(change.kind){
    case 'add':return addFolder(s,change.name,change.parentId,change.id,change.at)
    case 'rename':return renameFolder(s,change.id,change.name)
    case 'move-folder':return moveFolder(s,change.id,change.parentId)
    case 'move-file':return moveFile(s,change.key,change.folderId)
    case 'move-files':return moveFiles(s,change.keys,change.folderId)
    case 'remove-empty':return removeEmptyFolder(s,change.id)
  }
}
async function commit(s:Session,change:Change):Promise<FolderWorkspace>{
  for(let attempt=0;attempt<4;attempt++){
    same(s)
    const previous=await db.rows.get(scoped(s))
    const workspace=await unseal(s,previous)
    const next=apply(workspace,change)
    const revision=(previous?.revision??0)+1
    const encrypted=await seal(s,next,revision)
    same(s)
    try{
      await db.transaction('rw',db.rows,async()=>{
        const latest=await db.rows.get(scoped(s))
        if((latest?.revision??0)!==(previous?.revision??0))
          throw Error('browser.folder_write_race')
        same(s)
        await db.rows.put(encrypted)
      })
      same(s)
      return next
    }catch(e){
      if(e instanceof Error&&e.message==='browser.folder_write_race'&&attempt<3)
        continue
      throw e
    }
  }
  throw Error('browser.folder_write_race')
}
export async function changeFolderWorkspace(change:Change):Promise<FolderWorkspace>{
  const s=requireSession()
  // Web Locks serializes cross-tab writers when supported; optimistic CAS
  // prevents silent lost updates in browsers lacking Web Locks.
  if(typeof navigator!=='undefined'&&navigator.locks?.request)
    return navigator.locks.request('pb3/browser/folders/'+scoped(s),()=>commit(s,change))
  return commit(s,change)
}


function defaultMarker(s:Session):FolderSyncMarker{
  return {key:scoped(s),baseRevision:0,confirmedLocalRevision:0,pending:null}
}
export async function getFolderLocalSync():Promise<{
  workspace:FolderWorkspace;localRevision:number;marker:FolderSyncMarker
}>{
  const s=requireSession()
  const [row,marker]=await db.transaction('r',db.rows,db.sync,
    ()=>Promise.all([db.rows.get(scoped(s)),db.sync.get(scoped(s))]))
  const workspace=await unseal(s,row)
  return {workspace,localRevision:row?.revision??0,
    marker:marker??defaultMarker(s)}
}
/** Persist signed ciphertext BEFORE attempting network POST (Lost ACK safe). */
export async function stageFolderUpload(
  expectedLocal:number,expectedBase:number,pending:FolderPendingUpload,
):Promise<boolean>{
  const s=requireSession()
  if(pending.localRevision!==expectedLocal
    ||pending.fromRevision!==expectedBase
    ||pending.toRevision!==expectedBase+1)
    throw Error('browser.sync_invalid_pending')
  return db.transaction('rw',db.rows,db.sync,async()=>{
    same(s)
    const row=await db.rows.get(scoped(s))
    const marker=await db.sync.get(scoped(s))??defaultMarker(s)
    if((row?.revision??0)!==expectedLocal
      ||marker.baseRevision!==expectedBase||marker.pending!==null)return false
    await db.sync.put({...marker,pending})
    return true
  })
}
/** Only the exact signed operation may acknowledge an outbox entry. */
export async function acknowledgeFolderUpload(
  operationId:string,toRevision:number,
):Promise<void>{
  const s=requireSession()
  await db.transaction('rw',db.rows,db.sync,async()=>{
    same(s)
    const marker=await db.sync.get(scoped(s))??defaultMarker(s)
    const pending=marker.pending
    if(!pending||pending.operationId!==operationId
      ||pending.toRevision!==toRevision
      ||pending.fromRevision!==marker.baseRevision)
      throw Error('browser.sync_ack_mismatch')
    const row=await db.rows.get(scoped(s))
    if((row?.revision??0)<pending.localRevision)
      throw Error('browser.sync_invalid_local_revision')
    await db.sync.put({
      ...marker,baseRevision:toRevision,
      confirmedLocalRevision:pending.localRevision,pending:null,
    })
  })
}
/**
 * Only an unchanged CLEAN local row can be replaced by a newer server
 * snapshot. CAS and encrypted atomic write block unacknowledged local loss.
 */
export async function installRemoteFolderWorkspace(
  workspace:FolderWorkspace,expectedLocal:number,
  expectedBase:number,remoteRevision:number,
):Promise<boolean>{
  const s=requireSession()
  if(remoteRevision<=expectedBase||remoteRevision<1)
    throw Error('browser.sync_invalid_revision')
  const encrypted=await seal(s,workspace,expectedLocal+1)
  return db.transaction('rw',db.rows,db.sync,async()=>{
    same(s)
    const row=await db.rows.get(scoped(s))
    const marker=await db.sync.get(scoped(s))??defaultMarker(s)
    if((row?.revision??0)!==expectedLocal
      ||marker.baseRevision!==expectedBase
      ||marker.confirmedLocalRevision!==expectedLocal
      ||marker.pending!==null)return false
    await db.rows.put(encrypted)
    await db.sync.put({...marker,baseRevision:remoteRevision,
      confirmedLocalRevision:expectedLocal+1,pending:null})
    return true
  })
}
