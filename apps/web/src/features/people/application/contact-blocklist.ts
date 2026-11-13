import Dexie, { type Table } from 'dexie'
import { activeSession, requireSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import { b64, unb64, random, digest, hex } from '../../identity/infrastructure/crypto'

const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: true })
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const indexDomain = 'pb3.local-blocklist-index.v1\n'
const aadDomain = 'pb3.local-blocklist-aad.v1\n'

export type LocallyBlockedPeer = {
  version:1
  peerAccountId:string
  blockedAt:number
}
type EncryptedRow = {
  key:string
  ownerScope:string
  iv:string
  ciphertext:string
}
class BlocklistDB extends Dexie {
  blocks!:Table<EncryptedRow,string>
  constructor(){
    super('pb3-encrypted-contact-blocklist-v1')
    this.version(1).stores({blocks:'&key,ownerScope'})
  }
}
const db = new BlocklistDB()

function assertIdentity(session:Session):void {
  const current=activeSession.value
  if(!current || current.accountId!==session.accountId
    || current.deviceId!==session.deviceId
    || current.pkg.akek!==session.pkg.akek
    || current.pkg.accountSpki!==session.pkg.accountSpki
    || current.pkg.revision!==session.pkg.revision)
    throw Error('identity.changed')
}
async function scopedIds(ownerId:string,peerId?:string):Promise<{
  ownerScope:string
  key?:string
}> {
  const ownerScope=hex(await digest(enc.encode(indexDomain+ownerId)))
  return { ownerScope, key:peerId
    ?hex(await digest(enc.encode(indexDomain+ownerId+'\n'+peerId)))
    :undefined }
}
function aad(ownerScope:string,key:string):Uint8Array<ArrayBuffer> {
  return enc.encode(aadDomain+ownerScope+'\n'+key)
}
async function secretKey(session:Session):Promise<CryptoKey> {
  const raw=unb64(session.pkg.akek,32)
  try {return await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,
    ['encrypt','decrypt'])}
  finally {raw.fill(0)}
}
function checkedPeerId(peerAccountId:string,accountId:string):string {
  if(typeof peerAccountId!=='string'
    ||peerAccountId!==peerAccountId.trim().toLowerCase()
    ||!uuidPattern.test(peerAccountId)
    ||peerAccountId===accountId)throw Error('contacts.blocklist_invalid_peer')
  return peerAccountId
}
function validate(value:LocallyBlockedPeer):void {
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).sort().join('|')!=='blockedAt|peerAccountId|version'
    ||value.version!==1||typeof value.peerAccountId!=='string'
    ||!uuidPattern.test(value.peerAccountId)
    ||!Number.isSafeInteger(value.blockedAt)||value.blockedAt<0)
    throw Error('contacts.blocklist_invalid_record')
}
async function open(row:EncryptedRow,ownerScope:string,ownerId:string,
  key:CryptoKey):Promise<LocallyBlockedPeer> {
  if(row.ownerScope!==ownerScope||!/^[a-f0-9]{64}$/.test(row.key))
    throw Error('contacts.blocklist_invalid_record')
  let value:LocallyBlockedPeer
  try {
    const bytes=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(row.iv,12),
      additionalData:aad(row.ownerScope,row.key),tagLength:128,
    },key,unb64(row.ciphertext))
    value=JSON.parse(dec.decode(bytes)) as LocallyBlockedPeer
  } catch {throw Error('contacts.blocklist_unreadable')}
  validate(value)
  const expected=await scopedIds(ownerId,value.peerAccountId)
  if(expected.key!==row.key||value.peerAccountId===ownerId)
    throw Error('contacts.blocklist_scope_mismatch')
  return value
}

/**
 * Local-only privacy/selection preference. NOT an access revocation:
 * existing signed Team/Media grants and already distributed keys survive.
 */
export async function listLocallyBlockedPeers():Promise<LocallyBlockedPeer[]> {
  const session=requireSession()
  const {ownerScope}=await scopedIds(session.accountId)
  const rows=await db.blocks.where('ownerScope').equals(ownerScope).toArray()
  const key=await secretKey(session)
  const blocked:LocallyBlockedPeer[]=[]
  for(const row of rows) {
    assertIdentity(session)
    blocked.push(await open(row,ownerScope,session.accountId,key))
  }
  assertIdentity(session)
  return blocked.sort((a,b)=>a.peerAccountId.localeCompare(b.peerAccountId))
}

/** Persist a local blacklist item even when offline, without plaintext identifiers. */
export async function locallyBlockPeer(peerAccountId:string):Promise<LocallyBlockedPeer> {
  const session=requireSession()
  const id=checkedPeerId(peerAccountId,session.accountId)
  const ids=await scopedIds(session.accountId,id)
  const key=await secretKey(session)
  let blockedAt=Date.now()
  const prior=await db.blocks.get(ids.key!)
  if(prior){
    const old=await open(prior,ids.ownerScope,session.accountId,key)
    blockedAt=old.blockedAt
  }
  const value:LocallyBlockedPeer={version:1,peerAccountId:id,blockedAt}
  validate(value)
  const iv=random(12)
  const encrypted=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,additionalData:aad(ids.ownerScope,ids.key!),tagLength:128,
  },key,enc.encode(JSON.stringify(value)))
  assertIdentity(session)
  await db.blocks.put({key:ids.key!,ownerScope:ids.ownerScope,
    iv:b64(iv),ciphertext:b64(encrypted)})
  assertIdentity(session)
  return value
}

/** Removing a local block NEVER reissues previously revoked server grants. */
export async function locallyUnblockPeer(peerAccountId:string):Promise<void> {
  const session=requireSession()
  const id=checkedPeerId(peerAccountId,session.accountId)
  const ids=await scopedIds(session.accountId,id)
  const key=await secretKey(session)
  const prior=await db.blocks.get(ids.key!)
  if(prior)await open(prior,ids.ownerScope,session.accountId,key)
  assertIdentity(session)
  await db.blocks.delete(ids.key!)
  assertIdentity(session)
}
