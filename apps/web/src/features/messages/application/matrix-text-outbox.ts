import Dexie,{type Table} from 'dexie'
import {MsgType,SyncState,type MatrixClient} from 'matrix-js-sdk'
import {OnlySignedDevicesIsolationMode} from 'matrix-js-sdk/lib/crypto-api'
import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {b64,unb64,digest,hex,random,uuid} from '../../identity/infrastructure/crypto'
import {jsonApi} from '../../identity/infrastructure/api'
import {listConfirmedContacts} from '../../people/application/contact-book'
import type {ConfirmedContact} from '../../people/application/contact-book'
import {
  getLocalMatrixBindingForPending,getBoundMatrixCredentials,
} from './matrix-binding'
import {getMatrixContactMapping} from './matrix-peer-identity'
import {inspectVerifiedMatrixDevice} from './matrix-verified-device'

/**
 * P2-02E1 — durable, E2EE *intent* queue, not yet user-enabled Messenger.
 * No unencrypted Matrix network fallback, no plaintext IndexedDB fields,
 * and no "delivered" claim after a successful homeserver ACK.
 *
 * Only an explicitly enabled future UI may enqueue. Sending requires a
 * presently synced and independently cross-signed recipient, current
 * authenticated room membership, real RustCrypto E2EE, and an exact
 * server-accepted encrypted event. All failures retain the sealed intent.
 */
const enc=new TextEncoder()
const dec=new TextDecoder('utf-8',{fatal:true})
const domain='pb3.matrix.text-outbox.v1'
const uuidRe=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const hexRe=/^[a-f0-9]{64}$/
const keyRe=/^[A-Za-z0-9+/_=-]{30,90}$/
const roomRe=/^![^:\s]{1,200}:[a-zA-Z0-9.-]{1,100}$/
const eventRe=/^\$[^\s]{1,512}$/
export const MAX_MATRIX_TEXT_LENGTH=4096

type PendingText={
  version:1
  operationId:string
  accountId:string
  pb3DeviceId:string
  matrixDeviceId:string
  peerAccountId:string
  peerFingerprint:string
  matrixUserId:string
  matrixEd25519:string
  roomId:string
  body:string
  createdAt:number
  state:'queued'|'server_accepted'
  eventId:string|null
}
type SealedRow={scope:string;key:string;iv:string;ciphertext:string}
class TextOutboxDB extends Dexie{
  items!:Table<SealedRow,string>
  constructor(){
    super('pb3-matrix-text-outbox-v1')
    this.version(1).stores({items:'&key,scope'})
  }
}
const db=new TextOutboxDB()
let flushing:Promise<{
  attempted:number;accepted:number;pending:number
}>|null=null

function same(s:Session):void{
  const now=activeSession.value
  if(!now||now.accountId!==s.accountId||now.deviceId!==s.deviceId
    ||now.pkg.akek!==s.pkg.akek||now.pkg.accountSpki!==s.pkg.accountSpki
    ||now.pkg.revision!==s.pkg.revision)
    throw Error('matrix.outbox_session_changed')
}
async function hash(input:string):Promise<string>{
  return hex(await digest(enc.encode(input)))
}
async function identifiers(s:Session,id:string):Promise<{scope:string;key:string}>{
  return {
    scope:await hash(domain+'\n'+s.accountId+'\n'+s.deviceId),
    key:await hash(domain+'\n'+s.accountId+'\n'+s.deviceId+'\n'+id),
  }
}
async function aes(s:Session,row:SealedRow,operation:KeyUsage):Promise<CryptoKey>{
  const bytes=unb64(s.pkg.akek,32)
  let master:CryptoKey
  try{master=await crypto.subtle.importKey('raw',bytes,'HKDF',false,['deriveKey'])}
  finally{bytes.fill(0)}
  return crypto.subtle.deriveKey({
    name:'HKDF',hash:'SHA-256',salt:enc.encode(domain),
    info:enc.encode(row.scope+'\n'+row.key),
  },master,{name:'AES-GCM',length:256},false,[operation])
}
function aad(row:SealedRow):Uint8Array<ArrayBuffer>{
  return enc.encode(domain+'\n'+row.scope+'\n'+row.key)
}
function validate(x:unknown):PendingText{
  if(!x||typeof x!=='object'||Array.isArray(x))
    throw Error('matrix.outbox_invalid_record')
  const c=x as Record<string,unknown>
  const actual=Object.keys(c).sort().join('|')
  const expected=['version','operationId','accountId','pb3DeviceId',
    'matrixDeviceId','peerAccountId','peerFingerprint','matrixUserId',
    'matrixEd25519','roomId','body','createdAt','state','eventId'].sort().join('|')
  if(actual!==expected||c.version!==1
    ||typeof c.operationId!=='string'||!uuidRe.test(c.operationId)
    ||typeof c.accountId!=='string'||!uuidRe.test(c.accountId)
    ||typeof c.pb3DeviceId!=='string'||!uuidRe.test(c.pb3DeviceId)
    ||typeof c.peerAccountId!=='string'||!uuidRe.test(c.peerAccountId)
    ||typeof c.peerFingerprint!=='string'||!hexRe.test(c.peerFingerprint)
    ||typeof c.matrixDeviceId!=='string'||!(c.matrixDeviceId.length>0)
    ||typeof c.matrixUserId!=='string'||!c.matrixUserId.startsWith('@')
    ||typeof c.matrixEd25519!=='string'||!keyRe.test(c.matrixEd25519)
    ||typeof c.roomId!=='string'||!roomRe.test(c.roomId)
    ||typeof c.body!=='string'||!c.body.trim()
    ||c.body.length>MAX_MATRIX_TEXT_LENGTH
    ||!Number.isSafeInteger(c.createdAt)||(c.createdAt as number)<=0
    ||!['queued','server_accepted'].includes(String(c.state))
    ||!(c.eventId===null||(typeof c.eventId==='string'&&eventRe.test(c.eventId)))
    ||(c.state==='queued'&&c.eventId!==null)
    ||(c.state==='server_accepted'&&c.eventId===null))
    throw Error('matrix.outbox_invalid_record')
  return c as PendingText
}
async function wrap(s:Session,content:PendingText):Promise<SealedRow>{
  validate(content)
  const {scope,key}=await identifiers(s,content.operationId)
  const iv=random(12),row:SealedRow={scope,key,iv:'',ciphertext:''}
  const ciphertext=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,tagLength:128,additionalData:aad(row),
  },await aes(s,row,'encrypt'),enc.encode(JSON.stringify(content)))
  same(s)
  return {...row,iv:b64(iv),ciphertext:b64(ciphertext)}
}
async function unwrap(s:Session,row:SealedRow):Promise<PendingText>{
  if(!hexRe.test(row.key)||!hexRe.test(row.scope))
    throw Error('matrix.outbox_corrupt_index')
  let value:PendingText
  try{
    const raw=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(row.iv,12),tagLength:128,
      additionalData:aad(row),
    },await aes(s,row,'decrypt'),unb64(row.ciphertext))
    value=validate(JSON.parse(dec.decode(raw)))
  }catch{throw Error('matrix.outbox_corrupt_ciphertext')}
  const expected=await identifiers(s,value.operationId)
  same(s)
  if(row.key!==expected.key||row.scope!==expected.scope
    ||value.accountId!==s.accountId||value.pb3DeviceId!==s.deviceId)
    throw Error('matrix.outbox_wrong_identity')
  return value
}
async function localRows(s:Session):Promise<PendingText[]>{
  const {scope}=await identifiers(s,'')
  same(s)
  const rows=await db.items.where('scope').equals(scope).toArray()
  const records:PendingText[]=[]
  for(const row of rows){
    same(s)
    records.push(await unwrap(s,row))
  }
  return records.sort((a,b)=>a.createdAt-b.createdAt
    ||a.operationId.localeCompare(b.operationId))
}
async function contactConfirmed(s:Session,p:PendingText):Promise<void>{
  const contacts=await listConfirmedContacts()
  same(s)
  if(!contacts.some(x=>x.peerAccountId===p.peerAccountId
    &&x.safetyFingerprint===p.peerFingerprint))
    throw Error('matrix.outbox_contact_changed')
  const current=await getMatrixContactMapping(p.peerAccountId)
  same(s)
  if(!current||current.matrixUserId!==p.matrixUserId
    ||current.matrixDeviceId.length<1)
    throw Error('matrix.outbox_matrix_id_changed')
}
function validateRoomId(roomId:string):void{
  if(!roomRe.test(roomId))throw Error('matrix.outbox_room_invalid')
}

/**
 * Local-First only: encrypted record COMMITTED before any online proof.
 * A pending message is NOT "sent", "delivered" or "read".
 */
export async function enqueueMatrixText(
  contact:Pick<ConfirmedContact,'peerAccountId'|'safetyFingerprint'>,
  roomId:string,body:string,approvedMatrixEd25519:string,
):Promise<string>{
  const s=requireSession()
  validateRoomId(roomId)
  if(typeof body!=='string'||!body.trim()||body.length>MAX_MATRIX_TEXT_LENGTH
    ||!hexRe.test(contact.safetyFingerprint)
    ||!uuidRe.test(contact.peerAccountId)||contact.peerAccountId===s.accountId
    ||!keyRe.test(approvedMatrixEd25519))
    throw Error('matrix.outbox_invalid_input')
  const local=await getLocalMatrixBindingForPending()
  same(s)
  const mapping=await getMatrixContactMapping(contact.peerAccountId)
  same(s)
  if(!local||!mapping||local.accountId!==s.accountId
    ||local.pb3DeviceId!==s.deviceId
    ||mapping.homeserverUrl!==local.homeserverUrl
    ||mapping.matrixUserId===local.matrixUserId)
    throw Error('matrix.outbox_binding_required')
  const confirmed=await listConfirmedContacts()
  same(s)
  if(!confirmed.some(x=>x.peerAccountId===contact.peerAccountId
    &&x.safetyFingerprint===contact.safetyFingerprint))
    throw Error('matrix.outbox_contact_changed')
  const operationId=uuid()
  const record:PendingText={
    version:1,operationId,accountId:s.accountId,pb3DeviceId:s.deviceId,
    matrixDeviceId:local.matrixDeviceId,
    peerAccountId:contact.peerAccountId,peerFingerprint:contact.safetyFingerprint,
    matrixUserId:mapping.matrixUserId,
    matrixEd25519:approvedMatrixEd25519,
    roomId,body,createdAt:Date.now(),state:'queued',eventId:null,
  }
  const row=await wrap(s,record)
  same(s)
  await db.items.add(row) // durable before ANY Matrix network
  same(s)
  return operationId
}
/** Local status is "queued" or "server_accepted", never delivered/read. */
export async function listMatrixTextOutbox():Promise<Array<{
  operationId:string;state:'queued'|'server_accepted'
  roomId:string;body:string;eventId:string|null
}>>{
  const s=requireSession()
  const rows=await localRows(s)
  same(s)
  return rows.map(x=>({
    operationId:x.operationId,state:x.state,roomId:x.roomId,
    body:x.body,eventId:x.eventId,
  }))
}
async function preflight(s:Session,x:PendingText,client:MatrixClient):Promise<void>{
  const binding=await getBoundMatrixCredentials()
  same(s)
  if(!binding||binding.contract.accountId!==s.accountId
    ||binding.contract.pb3DeviceId!==s.deviceId
    ||binding.contract.matrixDeviceId!==x.matrixDeviceId
    ||binding.contract.matrixUserId!==client.getUserId()
    ||binding.contract.matrixDeviceId!==client.getDeviceId()
    ||binding.contract.homeserverUrl!==client.baseUrl)
    throw Error('matrix.outbox_device_binding_changed')
  // A sealed local Matrix credential can remain after PB3 revokes its
  // device binding. Re-check the authenticated authoritative PB3 ledger
  // before SDK sends any encrypted room key or message.
  const remote=await jsonApi<{
    bound:boolean;homeserverUrl:string;matrixUserId:string|null
    deviceBinding?:{contract:string}|null
  }>('/matrix/v1/me')
  same(s)
  if(!remote.bound||remote.homeserverUrl!==binding.contract.homeserverUrl
    ||remote.matrixUserId!==binding.contract.matrixUserId
    ||remote.deviceBinding?.contract!==JSON.stringify(binding.contract))
    throw Error('matrix.outbox_server_binding_revoked')
  if(client.getSyncState()!==SyncState.Syncing
    &&client.getSyncState()!==SyncState.Prepared)
    throw Error('matrix.outbox_sync_not_ready')
  const crypto=client.getCrypto()
  if(!crypto)throw Error('matrix.outbox_rust_crypto_required')
  const room=client.getRoom(x.roomId)
  if(!room||room.getMyMembership()!=='join'
    ||!await crypto.isEncryptionEnabledInRoom(x.roomId)
    ||room.currentState.getStateEvents('m.room.encryption','')
      ?.getContent().algorithm!=='m.megolm.v1.aes-sha2')
    throw Error('matrix.outbox_room_not_encrypted')
  await contactConfirmed(s,x)
  const proof=await inspectVerifiedMatrixDevice(
    x.peerAccountId,x.matrixEd25519,crypto)
  same(s)
  if(proof.capability!=='inspection-only-no-send'
    ||proof.matrixUserId!==x.matrixUserId
    ||proof.matrixEd25519!==x.matrixEd25519)
    throw Error('matrix.outbox_unverified_recipient')
  const server=await client.getJoinedRoomMembers(x.roomId)
  same(s)
  const joined=Object.keys(server.joined??{})
  const allowed=new Set([binding.contract.matrixUserId,x.matrixUserId])
  if(allowed.size!==2||joined.length!==2
    ||joined.some(id=>!allowed.has(id))
    ||room.getJoinedMembers().some(m=>!allowed.has(m.userId))
    ||room.getMembers().some(m=>
      (m.membership==='join'||m.membership==='invite')
      &&!allowed.has(m.userId)))
    throw Error('matrix.outbox_room_membership_changed')
  // The SDK owns encryption and will refuse unsigned devices. Set mode
  // again on the exact SDK client to avoid an injected lax crypto setting.
  crypto.setDeviceIsolationMode(new OnlySignedDevicesIsolationMode())
  same(s)
}
/** Safe retry after an ACK loss reuses EXACTLY the original Matrix txnId;
 * the homeserver, not the client, guarantees idempotent event identity.
 * Does not send automatically from boot or UI.
 */
export async function flushMatrixTextOutbox(client:MatrixClient):Promise<{
  attempted:number;accepted:number;pending:number
}>{
  if(flushing)throw Error('matrix.outbox_flush_in_progress')
  const op=(async()=>{
    const s=requireSession()
    if(!s.online||(typeof navigator!=='undefined'&&navigator.onLine===false))
      return {attempted:0,accepted:0,
        pending:(await localRows(s)).filter(x=>x.state==='queued').length}
    const rows=await localRows(s)
    let attempted=0,accepted=0
    for(const item of rows){
      same(s)
      if(item.state==='server_accepted')continue
      attempted++
      try{
        await preflight(s,item,client)
        same(s)
        // The official Matrix SDK encrypts before sendMessage(). Do not
        // persist a second, plaintext network payload in local storage.
        const response=await client.sendMessage(item.roomId,{
          msgtype:MsgType.Text,body:item.body,
        },item.operationId)
        same(s)
        if(!response?.event_id||!eventRe.test(response.event_id))
          throw Error('matrix.outbox_invalid_ack')
        const remote=await client.fetchRoomEvent(item.roomId,response.event_id)
        same(s)
        if(remote.event_id!==response.event_id
          ||remote.room_id!==item.roomId
          ||remote.sender!==client.getUserId()
          ||remote.type!=='m.room.encrypted'
          ||remote.content?.algorithm!=='m.megolm.v1.aes-sha2'
          ||typeof remote.content.ciphertext!=='string'
          ||remote.content.ciphertext.length<32
          ||Object.prototype.hasOwnProperty.call(remote.content,'body')
          ||Object.prototype.hasOwnProperty.call(remote.content,'msgtype')
          ||(item.body.length>16&&JSON.stringify(remote).includes(item.body)))
          throw Error('matrix.outbox_remote_ciphertext_unverified')
        const updated:PendingText={
          ...item,state:'server_accepted',eventId:response.event_id,
        }
        const sealed=await wrap(s,updated)
        same(s)
        // Conditional CAS: never overwrite a newer state after another
        // tab modifies the same row; the Matrix crypto Web Lock also
        // prevents two legitimate SDK writers for the same device.
        const {key}=await identifiers(s,item.operationId)
        const before=await db.items.get(key)
        if(!before)throw Error('matrix.outbox_local_row_lost')
        const previous=await unwrap(s,before)
        same(s)
        if(previous.state!=='queued'
          ||previous.operationId!==item.operationId)
          throw Error('matrix.outbox_row_changed')
        await db.transaction('rw',db.items,async()=>{
          const current=await db.items.get(key)
          // Do NOT await WebCrypto inside a Dexie transaction: IndexedDB
          // would auto-commit before our CAS/write, losing an ACK.
          if(!current||current.iv!==before.iv
            ||current.ciphertext!==before.ciphertext
            ||current.scope!==before.scope)
            throw Error('matrix.outbox_row_changed')
          await db.items.put(sealed)
        })
        same(s)
        accepted++
      }catch(e){
        // Never turn a network failure, trust refusal or lost ACK into
        // "server_accepted". Keep encrypted intent for an explicit retry.
        if(e instanceof Error&&e.message==='matrix.outbox_session_changed')
          throw e
        break // strict ordering: do not skip a possibly ambiguous ACK.
      }
    }
    return {
      attempted,accepted,
      pending:(await localRows(s)).filter(x=>x.state==='queued').length,
    }
  })()
  flushing=op
  try{return await op}
  finally{if(flushing===op)flushing=null}
}
