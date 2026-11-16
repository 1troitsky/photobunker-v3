import Dexie, {type Table} from 'dexie'
import {activeSession, requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {b64, unb64, random, digest, hex} from '../../identity/infrastructure/crypto'
import {listConfirmedContacts} from '../../people/application/contact-book'
import type {ConfirmedContact} from '../../people/application/contact-book'

const enc=new TextEncoder()
const dec=new TextDecoder('utf-8',{fatal:true})
const scopeDomain='pb3.message-draft-scope.v1\n'
const aadDomain='pb3.message-draft-aead.v1\n'
const uuidRe=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const hashRe=/^[a-f0-9]{64}$/
export const MAX_MESSAGE_DRAFT_LENGTH=4096

export type MessageDraft={
  version:1;peerAccountId:string;peerFingerprint:string
  body:string;updatedAt:number
}
type EncryptedDraftRow={
  key:string;ownerScope:string;iv:string;ciphertext:string
}
class MessageDraftDB extends Dexie{
  drafts!:Table<EncryptedDraftRow,string>
  constructor(){
    super('pb3-encrypted-messages-drafts-v1')
    // Neither the account ID, peer ID, nickname nor message body is an index.
    this.version(1).stores({drafts:'&key,ownerScope'})
  }
}
const db=new MessageDraftDB()
// Serialize edits by the logical account/peer, including overlapping
// encryption tasks and close/reopen writes. Never allow older edits to win.
const pendingWrites=new Map<string,Promise<void>>()

function same(session:Session):void{
  const now=activeSession.value
  if(!now||now.accountId!==session.accountId
    ||now.deviceId!==session.deviceId
    ||now.pkg.akek!==session.pkg.akek
    ||now.pkg.accountSpki!==session.pkg.accountSpki
    ||now.pkg.revision!==session.pkg.revision)
    throw Error('identity.changed')
}
async function digestText(value:string):Promise<string>{
  return hex(await digest(enc.encode(value)))
}
async function ids(accountId:string,peerAccountId:string):Promise<{
  key:string;ownerScope:string
}>{
  return {
    ownerScope:await digestText(scopeDomain+accountId),
    key:await digestText(scopeDomain+accountId+'\n'+peerAccountId),
  }
}
async function localKey(s:Session,usage:KeyUsage):Promise<CryptoKey>{
  const bytes=unb64(s.pkg.akek,32)
  try{
    return await crypto.subtle.importKey('raw',bytes,
      {name:'AES-GCM'},false,[usage])
  }finally{bytes.fill(0)}
}
function aad(row:Pick<EncryptedDraftRow,'ownerScope'|'key'>):Uint8Array<ArrayBuffer>{
  return enc.encode(aadDomain+row.ownerScope+'\n'+row.key)
}
function validate(draft:MessageDraft):void{
  if(!draft||typeof draft!=='object'||Array.isArray(draft)
    ||Object.keys(draft).sort().join('|')
      !=='body|peerAccountId|peerFingerprint|updatedAt|version'
    ||draft.version!==1
    ||typeof draft.peerAccountId!=='string'
    ||!uuidRe.test(draft.peerAccountId)
    ||typeof draft.peerFingerprint!=='string'
    ||!hashRe.test(draft.peerFingerprint)
    ||typeof draft.body!=='string'
    ||draft.body.length===0||draft.body.length>MAX_MESSAGE_DRAFT_LENGTH
    ||!draft.body.trim()
    ||!Number.isSafeInteger(draft.updatedAt)
    ||draft.updatedAt<=0)
    throw Error('messages.invalid_draft')
}
async function openDraft(
  row:EncryptedDraftRow,s:Session,
):Promise<MessageDraft>{
  if(!hashRe.test(row.key)||!hashRe.test(row.ownerScope))
    throw Error('messages.invalid_ciphertext_scope')
  const key=await localKey(s,'decrypt')
  let value:MessageDraft
  try{
    const raw=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(row.iv,12),
      additionalData:aad(row),tagLength:128,
    },key,unb64(row.ciphertext))
    value=JSON.parse(dec.decode(raw)) as MessageDraft
    validate(value)
  }catch{throw Error('messages.draft_decryption_failed')}
  const expected=await ids(s.accountId,value.peerAccountId)
  if(expected.key!==row.key||expected.ownerScope!==row.ownerScope)
    throw Error('messages.invalid_ciphertext_scope')
  same(s)
  return value
}
function matchesContact(draft:MessageDraft,contact:ConfirmedContact):boolean{
  return draft.peerAccountId===contact.peerAccountId
    &&draft.peerFingerprint===contact.safetyFingerprint
}
/** Only drafts for CURRENT fingerprint-confirmed peers are displayed.
 * A revoked/changed contact cannot silently become a new recipient.
 */
export async function listMessageDrafts():Promise<MessageDraft[]>{
  const s=requireSession()
  const contacts=await listConfirmedContacts()
  same(s)
  const {ownerScope}=await ids(s.accountId,'')
  const rows=await db.drafts.where('ownerScope').equals(ownerScope).toArray()
  const results:MessageDraft[]=[]
  for(const row of rows){
    same(s)
    const draft=await openDraft(row,s)
    if(contacts.some(c=>matchesContact(draft,c)))results.push(draft)
  }
  same(s)
  return results.sort((a,b)=>b.updatedAt-a.updatedAt)
}
export async function getMessageDraft(contact:ConfirmedContact):Promise<string>{
  const s=requireSession()
  const matched=(await listMessageDrafts())
    .find(x=>matchesContact(x,contact))
  same(s)
  return matched?.body??''
}
/** A Matrix message is NEVER sent by this API. Only an account-encrypted
 * local draft is committed; no network, Matrix token or plaintext storage.
 */
export async function saveMessageDraft(
  contact:ConfirmedContact,body:string,
):Promise<void>{
  const s=requireSession()
  if(!uuidRe.test(contact.peerAccountId)
    ||contact.peerAccountId===s.accountId
    ||!hashRe.test(contact.safetyFingerprint)
    ||typeof body!=='string'
    ||body.length>MAX_MESSAGE_DRAFT_LENGTH)
    throw Error('messages.invalid_draft_input')
  const identity=s.accountId+'\n'+contact.peerAccountId
  const previous=pendingWrites.get(identity)??Promise.resolve()
  const task=previous.catch(()=>{/* do not discard the newest edit */}).then(async()=>{
    same(s)
    const confirmed=await listConfirmedContacts()
    same(s)
    if(!confirmed.some(x=>matchesContact({
      version:1,peerAccountId:contact.peerAccountId,
      peerFingerprint:contact.safetyFingerprint,
      body:body||' ',updatedAt:Date.now(),
    },x)))throw Error('messages.recipient_not_confirmed')
    const {key,ownerScope}=await ids(s.accountId,contact.peerAccountId)
    same(s)
    if(!body.trim()){
      await db.drafts.delete(key)
      same(s)
      return
    }
    const record:MessageDraft={
      version:1,peerAccountId:contact.peerAccountId,
      peerFingerprint:contact.safetyFingerprint,
      body,updatedAt:Date.now(),
    }
    validate(record)
    const iv=random(12)
    const ciphertext=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:aad({ownerScope,key}),tagLength:128,
    },await localKey(s,'encrypt'),enc.encode(JSON.stringify(record)))
    same(s)
    await db.drafts.put({
      key,ownerScope,iv:b64(iv),ciphertext:b64(ciphertext),
    })
    same(s)
  })
  pendingWrites.set(identity,task)
  try{await task}
  finally{if(pendingWrites.get(identity)===task)pendingWrites.delete(identity)}
}
