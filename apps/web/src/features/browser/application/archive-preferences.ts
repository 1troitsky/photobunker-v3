import Dexie,{type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {b64,unb64,importSigner,sign} from '../../identity/infrastructure/crypto'

export type ArchivePreferenceValues={
  useArchive:boolean;autoDeleteAfter7Days:boolean
}
export type ArchivePreferenceServer=ArchivePreferenceValues&{
  revision:number;writeEnabled:boolean;autoCleanupEnabled:boolean
}
type SignedPending=ArchivePreferenceValues&{
  operationId:string;expectedRevision:number;contract:string;signature:string
}
type LocalPreferences={
  confirmed:ArchivePreferenceServer|null
  draft:ArchivePreferenceValues|null
  pending:SignedPending|null
}
type SealedRow={scope:string;version:1;iv:string;ciphertext:string}
class PrefDB extends Dexie{
  rows!:Table<SealedRow,string>
  constructor(){
    super('pb3-browser-archive-preferences-v1')
    this.version(1).stores({rows:'&scope'})
  }
}
const db=new PrefDB()
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true})
const defaults:ArchivePreferenceValues={useArchive:true,autoDeleteAfter7Days:true}
function scope(s:Session){return s.accountId+'/'+s.deviceId}
function same(s:Session){
  if(activeSession.value!==s)throw Error('identity.account_changed')
}
function aad(s:Session):Uint8Array<ArrayBuffer>{
  return enc.encode(JSON.stringify({
    domain:'pb3/browser/archive-preferences/v1',
    accountId:s.accountId,deviceId:s.deviceId,
  }))
}
function validValues(x:unknown):x is ArchivePreferenceValues{
  return !!x&&typeof x==='object'&&!Array.isArray(x)
    &&typeof (x as ArchivePreferenceValues).useArchive==='boolean'
    &&typeof (x as ArchivePreferenceValues).autoDeleteAfter7Days==='boolean'
}
function validServer(x:unknown):x is ArchivePreferenceServer{
  return validValues(x)
    &&Number.isSafeInteger((x as ArchivePreferenceServer).revision)
    &&(x as ArchivePreferenceServer).revision>=0
    &&typeof (x as ArchivePreferenceServer).writeEnabled==='boolean'
    &&typeof (x as ArchivePreferenceServer).autoCleanupEnabled==='boolean'
}
function validLocal(x:unknown):x is LocalPreferences{
  if(!x||typeof x!=='object'||Array.isArray(x))return false
  const d=x as LocalPreferences
  return (d.confirmed===null||validServer(d.confirmed))
    &&(d.draft===null||validValues(d.draft))
    &&(d.pending===null||validValues(d.pending)
      &&typeof d.pending.contract==='string'
      &&typeof d.pending.signature==='string'
      &&typeof d.pending.operationId==='string'
      &&Number.isSafeInteger(d.pending.expectedRevision))
}
async function open(s:Session,row:SealedRow|undefined):Promise<LocalPreferences>{
  same(s)
  if(!row)return {confirmed:null,draft:null,pending:null}
  if(row.scope!==scope(s)||row.version!==1||row.iv.length>64
    ||row.ciphertext.length>10000)throw Error('browser.preferences_invalid_seal')
  const bytes=new Uint8Array(await crypto.subtle.decrypt({
    name:'AES-GCM',iv:unb64(row.iv,12),tagLength:128,
    additionalData:aad(s),
  },s.device.encryptionKey,unb64(row.ciphertext)))
  same(s)
  try{
    const x:unknown=JSON.parse(dec.decode(bytes))
    if(!validLocal(x))throw Error('browser.preferences_invalid_state')
    return x
  }finally{bytes.fill(0)}
}
async function seal(s:Session,data:LocalPreferences):Promise<SealedRow>{
  if(!validLocal(data))throw Error('browser.preferences_invalid_state')
  const bytes=enc.encode(JSON.stringify(data)),iv=crypto.getRandomValues(new Uint8Array(12))
  try{
    same(s)
    const ciphertext=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,tagLength:128,additionalData:aad(s),
    },s.device.encryptionKey,bytes)
    same(s)
    return {scope:scope(s),version:1,iv:b64(iv),ciphertext:b64(ciphertext)}
  }finally{bytes.fill(0)}
}
async function change(
  s:Session,fn:(data:LocalPreferences)=>LocalPreferences,
):Promise<LocalPreferences>{
  for(let i=0;i<4;i++){
    same(s)
    const old=await db.rows.get(scope(s))
    const prior=await open(s,old)
    const next=fn(prior)
    const encrypted=await seal(s,next)
    try{
      await db.transaction('rw',db.rows,async()=>{
        same(s)
        const current=await db.rows.get(scope(s))
        if((current?.iv??null)!==(old?.iv??null)
          ||(current?.ciphertext??null)!==(old?.ciphertext??null))
          throw Error('browser.preferences_local_race')
        await db.rows.put(encrypted)
      })
      return next
    }catch(e){
      if(e instanceof Error&&e.message==='browser.preferences_local_race'&&i<3)
        continue
      throw e
    }
  }
  throw Error('browser.preferences_local_race')
}
export async function localArchivePreferences():Promise<LocalPreferences>{
  const s=requireSession()
  return open(s,await db.rows.get(scope(s)))
}
export function effectiveArchivePreferenceValues(
  x:LocalPreferences,
):ArchivePreferenceValues{
  return x.draft??x.confirmed??defaults
}
/** Local-First draft. Never claims that it changes server cleanup gates. */
export async function editArchivePreferences(
  partial:Partial<ArchivePreferenceValues>,
):Promise<LocalPreferences>{
  const s=requireSession()
  if(Object.keys(partial).some(k=>k!=='useArchive'&&k!=='autoDeleteAfter7Days')
    ||Object.values(partial).some(v=>typeof v!=='boolean'))
    throw Error('browser.preferences_invalid_edit')
  return change(s,prior=>{
    if(prior.pending)throw Error('browser.preferences_pending_upload')
    const draft={...effectiveArchivePreferenceValues(prior),...partial}
    return {...prior,draft}
  })
}
async function remote(s:Session):Promise<ArchivePreferenceServer>{
  const x=await jsonApi<ArchivePreferenceServer>('/browser/v1/archive/preferences')
  same(s)
  if(!validServer(x))throw Error('browser.preferences_invalid_response')
  return x
}
type PreferenceAck=ArchivePreferenceValues&{revision:number;unchanged:boolean}
async function sendPending(s:Session,p:SignedPending):Promise<ArchivePreferenceServer>{
  const r=await jsonApi<PreferenceAck>('/browser/v1/archive/preferences','POST',{
    contract:p.contract,signature:p.signature,
  })
  same(s)
  if(!validValues(r)||r.revision!==p.expectedRevision+1
    ||r.useArchive!==p.useArchive
    ||r.autoDeleteAfter7Days!==p.autoDeleteAfter7Days
    ||typeof r.unchanged!=='boolean')
    throw Error('browser.preferences_invalid_ack')
  const latest=await remote(s)
  if(latest.revision<r.revision||latest.revision===r.revision
    &&(latest.useArchive!==p.useArchive
      ||latest.autoDeleteAfter7Days!==p.autoDeleteAfter7Days))
    throw Error('browser.preferences_rollback')
  await change(s,prior=>{
    if(prior.pending?.operationId!==p.operationId
      ||prior.pending?.contract!==p.contract
      ||prior.pending?.signature!==p.signature)
      throw Error('browser.preferences_ack_mismatch')
    // Do not silently drop another edit; the outbox is single-flight.
    return {...prior,confirmed:latest,pending:null,draft:null}
  })
  return latest
}

export type PreferenceSyncResult={
  state:'synced'|'uploaded'|'conflict'
  data:LocalPreferences
}
/** Identity-scoped sync. 409 never discards the encrypted signed command. */
async function sync(s:Session):Promise<PreferenceSyncResult>{
  if(!s.online||typeof navigator!=='undefined'&&navigator.onLine===false)
    throw Error('browser.preferences_offline')
  same(s)
  let local=await localArchivePreferences()
  if(local.pending){
    await sendPending(s,local.pending)
    return {state:'uploaded',data:await localArchivePreferences()}
  }
  const server=await remote(s)
  if(local.draft===null){
    local=await change(s,x=>{
      if(x.pending||x.draft)return x
      return {...x,confirmed:server}
    })
    return {state:'synced',data:local}
  }
  if(local.confirmed!==null&&local.confirmed.revision!==server.revision
    ||local.confirmed===null&&server.revision!==0)
    return {state:'conflict',data:local}
  const values=local.draft
  if(values.useArchive===server.useArchive
    &&values.autoDeleteAfter7Days===server.autoDeleteAfter7Days){
    local=await change(s,x=>({...x,confirmed:server,draft:null}))
    return {state:'synced',data:local}
  }
  const operationId=crypto.randomUUID()
  const contract=JSON.stringify({
    version:1,accountId:s.accountId,writerDeviceId:s.deviceId,operationId,
    expectedRevision:server.revision,...values,
  })
  const signature=await sign(await importSigner(s.pkg.accountPkcs8),
    'pb3.browser-archive-preferences.v1\n'+contract)
  same(s)
  const pending:SignedPending={
    ...values,operationId,expectedRevision:server.revision,contract,signature,
  }
  local=await change(s,x=>{
    if(x.pending||!x.draft||x.confirmed?.revision!==local.confirmed?.revision
      ||x.draft.useArchive!==values.useArchive
      ||x.draft.autoDeleteAfter7Days!==values.autoDeleteAfter7Days)
      throw Error('browser.preferences_local_changed')
    return {...x,pending}
  })
  await sendPending(s,pending)
  return {state:'uploaded',data:await localArchivePreferences()}
}
export async function synchronizeArchivePreferences():Promise<PreferenceSyncResult>{
  const s=requireSession()
  if(typeof navigator!=='undefined'&&navigator.locks?.request)
    return navigator.locks.request(
      'pb3/browser/archive-preferences/'+s.accountId+'/'+s.deviceId,
      ()=>sync(s),
    )
  return sync(s)
}
/** Explicitly accept latest server state after another device won the CAS. */
export async function discardArchivePreferenceDraft():Promise<LocalPreferences>{
  const s=requireSession()
  if(!s.online)throw Error('browser.preferences_offline')
  const current=await localArchivePreferences()
  if(current.pending)throw Error('browser.preferences_pending_upload')
  const server=await remote(s)
  return change(s,prior=>{
    if(prior.pending||prior.confirmed?.revision!==current.confirmed?.revision
      ||prior.draft?.useArchive!==current.draft?.useArchive
      ||prior.draft?.autoDeleteAfter7Days!==current.draft?.autoDeleteAfter7Days)
      throw Error('browser.preferences_local_changed')
    return {...prior,confirmed:server,draft:null}
  })
}
