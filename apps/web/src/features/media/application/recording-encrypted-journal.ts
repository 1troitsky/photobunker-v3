import Dexie,{type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import {wrapAssetDEK,unwrapAssetDEK,b64,unb64} from '../../identity/infrastructure/crypto'
import type {PackageV2} from '../../identity/infrastructure/crypto'
import {MAX_MEDIA_BYTES} from '../domain/media-crypto'
import {assertRecordingDuration} from '../domain/recording-limits'

/**
 * Transient MediaRecorder chunks are encrypted BEFORE IndexedDB writes.
 * This is a private scratch journal, NOT a signed MediaFile or a cloud outbox.
 * Interrupted drafts remain encrypted and are NEVER implicitly publishable.
 */
export type RecordingKind='audio'|'video'
export type DraftState='writing'|'interrupted'|'complete'
type WrappedKey={iv:string;ciphertext:string}
type DraftRow={
  key:string;accountId:string;recordingId:string;kind:RecordingKind
  mime:string;createdAt:number;expiresAt:number;revision:number
  wrappingKeyId:string
  wrapped:WrappedKey;nextIndex:number;plainBytes:number;state:DraftState
  durationMs:number|null
}
type SegmentRow={
  key:string;recordingKey:string;index:number;iv:string
  plainBytes:number;ciphertext:Blob
}
class RecordingJournalDb extends Dexie {
  recordings!:Table<DraftRow,string>
  segments!:Table<SegmentRow,string>
  constructor(){
    super('pb3-encrypted-recording-journal-v1')
    this.version(1).stores({
      recordings:'&key,accountId,[accountId+createdAt]',
      segments:'&key,recordingKey,[recordingKey+index]',
    })
  }
}
const db=new RecordingJournalDb()
const encoder=new TextEncoder()
const ONE_DAY=24*60*60*1000
const MAX_SEGMENT=8*1024*1024
const formats:Record<RecordingKind,string[]>={
  audio:['audio/webm','audio/mp4','audio/ogg'],
  video:['video/webm','video/mp4'],
}

type Owner={accountId:string;pkg:PackageV2}
// Emergency-delete acts on ALL accounts' local scratch (never remote media).
// Stay locked in this JS realm until the page reloads. Cross-tab/device
// coordination belongs to the verified Panic orchestrator, not this API.
let scratchWipeLock=false
function refuseDuringScratchWipe():void {
  if(scratchWipeLock)throw Error('camera.recording_scratch_wiped')
}
function owner():Owner{
  refuseDuringScratchWipe()
  const s=requireSession()
  return {accountId:s.accountId,pkg:s.pkg}
}
function assertOwner(s:Owner):void{
  refuseDuringScratchWipe()
  const now=activeSession.value
  if(!now||now.accountId!==s.accountId
    ||now.pkg.accountId!==s.accountId
    ||now.pkg.akek!==s.pkg.akek
    ||now.pkg.revision!==s.pkg.revision
    ||now.pkg.wrappingKeyId!==s.pkg.wrappingKeyId)
    throw Error('camera.recording_account_changed')
}
function keyOf(s:Owner,id:string):string {
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))
    throw Error('camera.recording_id_invalid')
  return s.accountId+'/'+id
}
function aad(row:DraftRow,index:number,plainBytes:number):Uint8Array<ArrayBuffer>{
  return encoder.encode(JSON.stringify({
    version:1,purpose:'pb3.camera.recording-segment.v1',
    accountId:row.accountId,recordingId:row.recordingId,
    kind:row.kind,mime:row.mime,expiresAt:row.expiresAt,
    revision:row.revision,index,plainBytes,
  }))
}
async function rowFor(s:Owner,id:string):Promise<DraftRow>{
  const row=await db.recordings.get(keyOf(s,id))
  assertOwner(s)
  if(!row||row.accountId!==s.accountId||row.recordingId!==id
    ||row.revision!==s.pkg.revision
    ||row.wrappingKeyId!==s.pkg.wrappingKeyId
    ||row.expiresAt<=Date.now())
    throw Error('camera.recording_draft_unavailable')
  return row
}
function ensureWrite(row:DraftRow):void{
  if(row.state!=='writing')throw Error('camera.recording_draft_sealed')
  if(row.expiresAt<=Date.now())throw Error('camera.recording_draft_expired')
}
/** Only opaque identity, timing and codec metadata; no GPS, tags or filename. */
export async function createEncryptedRecordingDraft(
  kind:RecordingKind,mime:string,
):Promise<string>{
  const s=owner()
  if(!formats[kind]?.includes(mime))throw Error('camera.recording_mime_invalid')
  const recordingId=crypto.randomUUID()
  const createdAt=Date.now(),expiresAt=createdAt+ONE_DAY
  const wrapped=await wrapAssetDEK(s.pkg,recordingId,String(expiresAt))
  assertOwner(s)
  const row:DraftRow={
    key:keyOf(s,recordingId),accountId:s.accountId,recordingId,
    kind,mime,createdAt,expiresAt,revision:s.pkg.revision,
    wrappingKeyId:s.pkg.wrappingKeyId,
    wrapped,nextIndex:0,plainBytes:0,state:'writing',durationMs:null,
  }
  await db.recordings.add(row)
  assertOwner(s)
  return recordingId
}
/**
 * Caller serializes ondataavailable events and supplies monotonic indexes.
 * Each write atomically advances the row and stores AES-GCM ciphertext only.
 * A failure keeps earlier encrypted chunks and never stores the failed blob.
 */
export async function appendEncryptedRecordingSegment(
  id:string,index:number,blob:Blob,
):Promise<void>{
  const s=owner()
  if(!Number.isSafeInteger(index)||index<0||index>4095
    ||!(blob instanceof Blob)||blob.size<1||blob.size>MAX_SEGMENT)
    throw Error('camera.recording_segment_invalid')
  const row=await rowFor(s,id)
  ensureWrite(row)
  if(index!==row.nextIndex)throw Error('camera.recording_sequence_invalid')
  if(row.plainBytes+blob.size>MAX_MEDIA_BYTES)
    throw Error('media.invalid_size')
  const dek=await unwrapAssetDEK(s.pkg,id,String(row.expiresAt),row.wrapped)
  assertOwner(s)
  const clear=new Uint8Array(await blob.arrayBuffer())
  const iv=crypto.getRandomValues(new Uint8Array(12))
  let encrypted:ArrayBuffer
  try{
    encrypted=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:aad(row,index,clear.length),tagLength:128,
    },dek,clear)
  }finally{clear.fill(0)}
  assertOwner(s)
  await db.transaction('rw',db.recordings,db.segments,async()=>{
    const current=await db.recordings.get(row.key)
    assertOwner(s)
    if(!current)throw Error('camera.recording_draft_unavailable')
    ensureWrite(current)
    if(current.nextIndex!==index||current.plainBytes!==row.plainBytes)
      throw Error('camera.recording_sequence_invalid')
    if(current.plainBytes+blob.size>MAX_MEDIA_BYTES)
      throw Error('media.invalid_size')
    await db.segments.add({
      key:row.key+'/'+index,recordingKey:row.key,index,
      iv:b64(iv),plainBytes:blob.size,
      ciphertext:new Blob([encrypted],{type:'application/octet-stream'}),
    })
    await db.recordings.update(row.key,{
      nextIndex:index+1,plainBytes:current.plainBytes+blob.size,
    })
    assertOwner(s)
  })
}
/** Only explicit, bounded user Stop may seal a decryptable draft. */
export async function sealEncryptedRecordingDraft(id:string,durationMs:number):Promise<void>{
  const s=owner()
  const row=await rowFor(s,id)
  ensureWrite(row)
  assertRecordingDuration(row.kind,durationMs)
  if(row.nextIndex===0||row.plainBytes<128)
    throw Error('camera.recording_empty')
  await db.transaction('rw',db.recordings,async()=>{
    const current=await db.recordings.get(row.key)
    assertOwner(s)
    if(!current)throw Error('camera.recording_draft_unavailable')
    ensureWrite(current)
    if(current.nextIndex!==row.nextIndex||current.plainBytes!==row.plainBytes)
      throw Error('camera.recording_sequence_invalid')
    await db.recordings.update(row.key,{state:'complete',durationMs})
    assertOwner(s)
  })
}
/** Unexpected native MediaRecorder/track stop can only mark INCOMPLETE. */
export async function interruptEncryptedRecordingDraft(id:string):Promise<void>{
  const s=owner()
  const row=await rowFor(s,id)
  await db.transaction('rw',db.recordings,async()=>{
    const current=await db.recordings.get(row.key)
    assertOwner(s)
    if(!current)throw Error('camera.recording_draft_unavailable')
    if(current.state==='complete')throw Error('camera.recording_draft_sealed')
    await db.recordings.update(row.key,{state:'interrupted'})
    assertOwner(s)
  })
}
export async function listEncryptedRecordingDrafts():Promise<Array<{
  recordingId:string;kind:RecordingKind;createdAt:number;expiresAt:number
  chunkCount:number;plainBytes:number;state:DraftState
}>>{
  const s=owner()
  const rows=await db.recordings.where('accountId').equals(s.accountId)
    .reverse().sortBy('createdAt')
  assertOwner(s)
  return rows.filter(r=>r.expiresAt>Date.now()&&r.revision===s.pkg.revision
    &&r.wrappingKeyId===s.pkg.wrappingKeyId)
    .map(r=>({
      recordingId:r.recordingId,kind:r.kind,createdAt:r.createdAt,
      expiresAt:r.expiresAt,chunkCount:r.nextIndex,
      plainBytes:r.plainBytes,state:r.state,
    }))
}
/**
 * Interrupted and active drafts are never materialized as a playable file
 * without an explicit future verified salvage flow. No OS gallery writes.
 */
async function decryptLocallyReviewedRecording(
  id:string,allowInterrupted:boolean,
):Promise<Blob>{
  const s=owner()
  const row=await rowFor(s,id)
  if((row.state!=='complete'&&(!allowInterrupted||row.state!=='interrupted'))
    ||row.nextIndex<1)
    throw Error('camera.recording_not_finalized')
  const pieces=await db.segments.where('recordingKey').equals(row.key).sortBy('index')
  assertOwner(s)
  if(pieces.length!==row.nextIndex)
    throw Error('camera.recording_missing_segment')
  const dek=await unwrapAssetDEK(s.pkg,id,String(row.expiresAt),row.wrapped)
  assertOwner(s)
  const clearParts:Uint8Array<ArrayBuffer>[]=[]
  let total=0
  try{for(const [index,piece] of pieces.entries()){
    if(piece.index!==index||piece.plainBytes<1||piece.plainBytes>MAX_SEGMENT
      ||piece.ciphertext.type!=='application/octet-stream'
      ||piece.ciphertext.size!==piece.plainBytes+16)
      throw Error('camera.recording_segment_corrupt')
    const clear=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(piece.iv,12),
      additionalData:aad(row,index,piece.plainBytes),tagLength:128,
    },dek,await piece.ciphertext.arrayBuffer())
    assertOwner(s)
    if(clear.byteLength!==piece.plainBytes)
      throw Error('camera.recording_segment_corrupt')
    clearParts.push(new Uint8Array(clear))
    total+=clear.byteLength
  }
  if(total!==row.plainBytes||total>MAX_MEDIA_BYTES)
    throw Error('camera.recording_size_mismatch')
  return new Blob(clearParts,{type:row.mime})
  }finally{for(const bytes of clearParts)bytes.fill(0)}
}
/** Complete recordings only: used for exact encrypted E2EE finalization. */
export function readCompletedEncryptedRecording(id:string):Promise<Blob>{
  return decryptLocallyReviewedRecording(id,false)
}
/**
 * Only an explicit local user preview can decrypt interrupted fragments.
 * The return value is volatile plaintext in memory; caller MUST revoke any
 * object URL at logout/exit. Never authorize MediaFile signing/assignment
 * submission from this function. Codec may require a missing final frame.
 */
export function readEncryptedRecordingForPrivateReview(id:string):Promise<Blob>{
  return decryptLocallyReviewedRecording(id,true)
}
/**
 * Explicit bounded GC for expired scratch recordings. The server MediaFile
 * retention/GC policy is separate and is never touched by this operation.
 * Only delete rows of the CURRENT account; never purge another identity.
 */
export async function purgeExpiredEncryptedRecordingDrafts(limit=25):Promise<number>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>25)
    throw Error('camera.recording_gc_limit_invalid')
  const s=owner(),now=Date.now()
  const expired=await db.recordings.where('accountId').equals(s.accountId)
    .filter(row=>row.expiresAt<=now).limit(limit).toArray()
  assertOwner(s)
  let removed=0
  for(const row of expired){
    await db.transaction('rw',db.recordings,db.segments,async()=>{
      assertOwner(s)
      const current=await db.recordings.get(row.key)
      if(!current||current.accountId!==s.accountId||current.expiresAt>now)
        return
      await db.segments.where('recordingKey').equals(row.key).delete()
      await db.recordings.delete(row.key)
      assertOwner(s)
      removed++
    })
  }
  return removed
}
export async function deleteEncryptedRecordingDraft(id:string):Promise<void>{
  const s=owner()
  const row=await rowFor(s,id)
  await db.transaction('rw',db.recordings,db.segments,async()=>{
    assertOwner(s)
    await db.segments.where('recordingKey').equals(row.key).delete()
    await db.recordings.delete(row.key)
    assertOwner(s)
  })
}

/**
 * Fail-closed, no-identity-needed LOCAL erasure hook for a future verified
 * Panic/Emergency/Remote-Wipe orchestrator. This method itself is never called
 * by PIN success, Dead Man's Switch or any page load.
 *
 * Locks this tab against future recording writes, then clears ALL account
 * scratch segments+records in one IndexedDB transaction. The higher-level
 * orchestrator MUST stop capture, revoke other tabs/devices and verify DB
 * deletion/remote actions separately before claiming successful Panic.
 * A JS tab cannot guarantee deletion of persisted storage in a killed peer.
 */
export async function eraseAllEncryptedRecordingScratchForPanic():Promise<void>{
  scratchWipeLock=true
  await db.transaction('rw',db.recordings,db.segments,async()=>{
    await db.segments.clear()
    await db.recordings.clear()
  })
  if(await db.recordings.count()||await db.segments.count())
    throw Error('camera.recording_scratch_wipe_unverified')
}
