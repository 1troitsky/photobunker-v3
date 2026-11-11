import Dexie,{type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {b64,unb64} from '../../identity/infrastructure/crypto'

export type ArchivePending={
  command:string;signature:string
  kind:'photo'|'media';assetId:string;action:'archive'|'restore'|'delete'
  expectedRevision:number;operationId:string;createdAt:number
}
type SealedPending={scope:string;version:1;iv:string;ciphertext:string}
class ArchiveOutboxDB extends Dexie{
  rows!:Table<SealedPending,string>
  constructor(){
    super('pb3-browser-device-archive-outbox-v1')
    this.version(1).stores({rows:'&scope'})
  }
}
const db=new ArchiveOutboxDB()
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true})
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
function scope(s:Session):string{return s.accountId+'/'+s.deviceId}
function live(s:Session):void{
  if(activeSession.value!==s)throw Error('identity.account_changed')
}
function aad(s:Session):Uint8Array<ArrayBuffer>{
  return enc.encode(JSON.stringify({domain:'pb3/browser/archive-outbox/v1',
    accountId:s.accountId,deviceId:s.deviceId}))
}
function validate(s:Session,x:ArchivePending):ArchivePending{
  if(!x||typeof x!=='object'||typeof x.command!=='string'
    ||x.command.length>10000||typeof x.signature!=='string'
    ||!['photo','media'].includes(x.kind)||!UUID.test(x.assetId)
    ||!['archive','restore','delete'].includes(x.action)
    ||!Number.isSafeInteger(x.expectedRevision)||x.expectedRevision<0
    ||!UUID.test(x.operationId)||!Number.isSafeInteger(x.createdAt)
    ||x.createdAt<0)throw Error('browser.archive_invalid_pending')
  let c:Record<string,unknown>
  try{c=JSON.parse(x.command) as Record<string,unknown>}
  catch{throw Error('browser.archive_invalid_pending')}
  if(c.version!==1||c.accountId!==s.accountId
    ||c.writerDeviceId!==s.deviceId||c.operationId!==x.operationId
    ||c.kind!==x.kind||c.assetId!==x.assetId||c.action!==x.action
    ||c.expectedRevision!==x.expectedRevision)
    throw Error('browser.archive_pending_identity')
  return x
}
async function seal(s:Session,x:ArchivePending):Promise<SealedPending>{
  validate(s,x)
  const bytes=enc.encode(JSON.stringify(x))
  const iv=crypto.getRandomValues(new Uint8Array(12))
  try{
    live(s)
    const encrypted=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:aad(s),tagLength:128,
    },s.device.encryptionKey,bytes)
    live(s)
    return {scope:scope(s),version:1,iv:b64(iv),ciphertext:b64(encrypted)}
  }finally{bytes.fill(0)}
}
async function open(s:Session,row:SealedPending):Promise<ArchivePending>{
  live(s)
  if(row.scope!==scope(s)||row.version!==1
    ||row.ciphertext.length>24000||row.iv.length>64)
    throw Error('browser.archive_invalid_sealed')
  const bytes=new Uint8Array(await crypto.subtle.decrypt({
    name:'AES-GCM',iv:unb64(row.iv,12),
    additionalData:aad(s),tagLength:128,
  },s.device.encryptionKey,unb64(row.ciphertext)))
  live(s)
  try{return validate(s,JSON.parse(dec.decode(bytes)) as ArchivePending)}
  finally{bytes.fill(0)}
}
/** A single per-device pending command is never replaced by a new intent. */
export async function getPendingArchiveAction():Promise<ArchivePending|null>{
  const s=requireSession()
  const row=await db.rows.get(scope(s))
  return row?open(s,row):null
}
/** Atomic add protects the exact signature from double-click and tab races. */
export async function savePendingArchiveAction(x:ArchivePending):Promise<ArchivePending>{
  const s=requireSession()
  const sealed=await seal(s,x)
  try{
    live(s)
    await db.rows.add(sealed)
    live(s)
    return x
  }catch(e){
    if(e instanceof Error&&e.name==='ConstraintError'){
      const existing=await getPendingArchiveAction()
      if(existing!==null)return existing
    }
    throw e
  }
}
/** Lost ACK is only acknowledged after a matching immutable server receipt. */
export async function clearAcknowledgedArchiveAction(
  operationId:string,
):Promise<void>{
  const s=requireSession()
  await db.transaction('rw',db.rows,async()=>{
    live(s)
    const row=await db.rows.get(scope(s))
    if(!row)throw Error('browser.archive_ack_missing')
    const pending=await open(s,row)
    if(pending.operationId!==operationId)
      throw Error('browser.archive_ack_mismatch')
    await db.rows.delete(scope(s))
  })
}
