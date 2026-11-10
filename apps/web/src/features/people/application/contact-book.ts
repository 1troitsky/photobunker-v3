import Dexie, { type Table } from 'dexie'
import { activeSession, requireSession } from '../../identity/application/session'
import {
  b64, unb64, random, digest, hex,
} from '../../identity/infrastructure/crypto'
import { pinnedPeer } from '../../sharing/key-directory'
import type { SignedDirectory } from '../../sharing/key-directory'

const enc=new TextEncoder()
const dec=new TextDecoder('utf-8',{fatal:true})
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const identityDomain='pb3.contact-index.v1\n'
const aadDomain='pb3.local-contact.v1\n'

export type ConfirmedContact={
  version:1
  peerAccountId:string
  safetyFingerprint:string
  alias:string
  createdAt:number
  updatedAt:number
}
type ContactCipherRow={
  key:string;ownerScope:string;iv:string;ciphertext:string
}
class ContactDB extends Dexie {
  contacts!:Table<ContactCipherRow,string>
  constructor(){
    super('pb3-encrypted-contacts-v1')
    this.version(1).stores({contacts:'&key,ownerScope'})
  }
}
const db=new ContactDB()

function currentIdentity(s:ReturnType<typeof requireSession>):void{
  const actual=activeSession.value
  // A warm offline→online proof may replace the Session object, but never
  // treat a different account, device or key revision as the same identity.
  if(!actual||actual.accountId!==s.accountId
    ||actual.deviceId!==s.deviceId||actual.pkg.akek!==s.pkg.akek
    ||actual.pkg.accountSpki!==s.pkg.accountSpki
    ||actual.pkg.revision!==s.pkg.revision)
    throw Error('identity.changed')
}
async function hash(text:string):Promise<string>{
  return hex(await digest(enc.encode(text)))
}
async function rowIds(accountId:string,peerAccountId?:string):Promise<{
  ownerScope:string;key?:string
}>{
  const ownerScope=await hash(identityDomain+accountId)
  return {ownerScope,
    key:peerAccountId?await hash(identityDomain+accountId+'\n'+peerAccountId):undefined}
}
function aad(ownerScope:string,key:string):Uint8Array<ArrayBuffer>{
  return enc.encode(aadDomain+ownerScope+'\n'+key)
}
function validate(contact:ConfirmedContact):void{
  if(contact.version!==1||typeof contact.peerAccountId!=='string'
    ||!uuidPattern.test(contact.peerAccountId)
    ||typeof contact.safetyFingerprint!=='string'
    ||!/^[a-f0-9]{64}$/.test(contact.safetyFingerprint)
    ||typeof contact.alias!=='string'||contact.alias.length>64
    ||contact.alias!==contact.alias.trim()
    ||!Number.isSafeInteger(contact.createdAt)||contact.createdAt<0
    ||!Number.isSafeInteger(contact.updatedAt)
    ||contact.updatedAt<contact.createdAt
    ||Object.keys(contact).sort().join('|')
      !=='alias|createdAt|peerAccountId|safetyFingerprint|updatedAt|version')
    throw Error('contacts.invalid_record')
}
async function cryptoKey(akek:string,usage:KeyUsage):Promise<CryptoKey>{
  const bytes=unb64(akek,32)
  try{return await crypto.subtle.importKey('raw',bytes,
    {name:'AES-GCM'},false,[usage])}
  finally{bytes.fill(0)}
}
async function openRow(
  row:ContactCipherRow,expectedOwnerScope:string,accountId:string,key:CryptoKey,
):Promise<ConfirmedContact>{
  if(row.ownerScope!==expectedOwnerScope
    ||!row.key||!/^[a-f0-9]{64}$/.test(row.key))
    throw Error('contacts.invalid_record')
  let bytes:ArrayBuffer
  try{
    bytes=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(row.iv,12),
      additionalData:aad(row.ownerScope,row.key),tagLength:128,
    },key,unb64(row.ciphertext))
  }catch{throw Error('contacts.encrypted_record_unreadable')}
  let value:ConfirmedContact
  try{value=JSON.parse(dec.decode(bytes)) as ConfirmedContact;validate(value)}
  catch{throw Error('contacts.invalid_record')}
  const expected=await rowIds(
    // The account ID is intentionally NOT in the indexed ciphertext row.
    // The caller validates row ownership through ownerScope and AEAD.
    accountId,value.peerAccountId)
  if(expected.key!==row.key)throw Error('contacts.invalid_record_scope')
  return value
}

/** Display-only local contacts. A contact is NOT an access grant or a role. */
export async function listConfirmedContacts():Promise<ConfirmedContact[]>{
  const s=requireSession()
  const {ownerScope}=await rowIds(s.accountId)
  const rows=await db.contacts.where('ownerScope').equals(ownerScope).toArray()
  const key=await cryptoKey(s.pkg.akek,'decrypt')
  const contacts:ConfirmedContact[]=[]
  for(const row of rows){
    currentIdentity(s)
    const item=await openRow(row,ownerScope,s.accountId,key)
    const pin=await pinnedPeer(item.peerAccountId,false)
    currentIdentity(s)
    if(pin.safetyFingerprint!==item.safetyFingerprint)
      throw Error('contacts.trusted_key_changed')
    contacts.push(item)
  }
  currentIdentity(s)
  return contacts.sort((a,b)=>(a.alias||a.peerAccountId)
    .localeCompare(b.alias||b.peerAccountId))
}

/** Save only a separately fingerprint-confirmed peer; never trust a server lookup by itself. */
export async function saveConfirmedContact(
  peerAccountId:string,safetyFingerprint:string,alias:string,
):Promise<ConfirmedContact>{
  const s=requireSession()
  const id=peerAccountId.trim().toLowerCase()
  const clean=alias.trim()
  if(!uuidPattern.test(id)||id===s.accountId
    ||clean.length>64||typeof alias!=='string'
    ||!/^[a-f0-9]{64}$/.test(safetyFingerprint))
    throw Error('contacts.invalid_input')
  const pin:SignedDirectory=await pinnedPeer(id,false)
  currentIdentity(s)
  if(pin.safetyFingerprint!==safetyFingerprint
    ||pin.accountId!==id)throw Error('contacts.trusted_key_changed')
  const ids=await rowIds(s.accountId,id)
  const old=await db.contacts.get(ids.key!)
  const key=await cryptoKey(s.pkg.akek,'encrypt')
  const now=Date.now()
  let createdAt=now
  if(old){
    const oldKey=await cryptoKey(s.pkg.akek,'decrypt')
    const existing=await openRow(old,ids.ownerScope,s.accountId,oldKey)
    if(existing.peerAccountId!==id
      ||existing.safetyFingerprint!==safetyFingerprint)
      throw Error('contacts.trusted_key_changed')
    createdAt=existing.createdAt
  }
  const contact:ConfirmedContact={
    version:1,peerAccountId:id,safetyFingerprint,alias:clean,
    createdAt,updatedAt:Math.max(now,createdAt),
  }
  validate(contact)
  const iv=random(12)
  const ciphertext=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,additionalData:aad(ids.ownerScope,ids.key!),
    tagLength:128,
  },key,enc.encode(JSON.stringify(contact)))
  currentIdentity(s)
  await db.contacts.put({
    key:ids.key!,ownerScope:ids.ownerScope,
    iv:b64(iv),ciphertext:b64(ciphertext),
  })
  currentIdentity(s)
  return contact
}

/** Deletion only removes the local encrypted address-book row, not grants or server memberships. */
export async function removeConfirmedContact(peerAccountId:string):Promise<void>{
  const s=requireSession()
  const id=peerAccountId.trim().toLowerCase()
  if(!uuidPattern.test(id))throw Error('contacts.invalid_input')
  const {key}=await rowIds(s.accountId,id)
  currentIdentity(s)
  await db.contacts.delete(key!)
  currentIdentity(s)
}
