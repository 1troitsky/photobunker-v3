import Dexie,{type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {
  b64,unb64,digest,hex,random,importSigner,importSpki,sign,verify,
} from '../../identity/infrastructure/crypto'
import {listConfirmedContacts} from '../../people/application/contact-book'
import {pinnedPeer} from '../../sharing/key-directory'
import {getBoundMatrixCredentials} from './matrix-binding'
import type {MatrixBindingContract} from './matrix-binding'

/**
 * P2-02D2: a strictly PB3-root-signed contact -> Matrix-ID mapping card.
 * A verified PB3 account signature is NOT Matrix cross-signing, a verified
 * Matrix ed25519 device, current Matrix ACL or permission to send.
 */
const enc=new TextEncoder()
const dec=new TextDecoder('utf-8',{fatal:true})
const trustDomain='pb3.matrix-peer-card.v1\n'
const localDomain='pb3.local-matrix-peer-pin.v1'
const prefix='PB3MX1.'
const uuidRe=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const mxidRe=/^@[a-zA-Z0-9._=+\/-]{1,120}:[a-zA-Z0-9.-]{1,100}$/
const mxDeviceRe=/^[\x21-\x7e]{1,128}$/
const originRe=/^https:\/\/[a-z0-9][a-z0-9.-]*(?::443)?$/
const shaRe=/^[a-f0-9]{64}$/

type MatrixCard={
  version:1
  accountId:string
  accountRevision:number
  accountSpki:string
  pb3DeviceId:string
  pb3DeviceSpki:string
  bindingContract:string
  bindingAccountSignature:string
  bindingDeviceSignature:string
}
type SignedCard={version:1;card:string;signature:string}
type AcceptedPin={
  version:1;peerAccountId:string;peerFingerprint:string
  approvedMatrixUserId:string;signedCard:string
}
type CipherPin={scope:string;key:string;iv:string;ciphertext:string}
class MatrixPeerDB extends Dexie{
  peers!:Table<CipherPin,string>
  constructor(){
    super('pb3-encrypted-matrix-peer-pins-v1')
    this.version(1).stores({peers:'&key,scope'})
  }
}
const db=new MatrixPeerDB()
let queue:Promise<void>=Promise.resolve()
function serial<T>(op:()=>Promise<T>):Promise<T>{
  const promise=queue.catch(()=>{}).then(op)
  queue=promise.then(()=>{},()=>{})
  return promise
}
function current(s:Session):void{
  const now=activeSession.value
  if(!now||now.accountId!==s.accountId||now.deviceId!==s.deviceId
    ||now.pkg.accountSpki!==s.pkg.accountSpki||now.pkg.akek!==s.pkg.akek
    ||now.pkg.revision!==s.pkg.revision)
    throw Error('matrix.contact_account_changed')
}
function requireLive():Session{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&navigator.onLine===false))
    throw Error('matrix.contact_online_verification_required')
  return s
}
async function hash(text:string):Promise<string>{
  return hex(await digest(enc.encode(text)))
}
async function identifiers(accountId:string,peerId:string):Promise<{
  scope:string;key:string
}>{
  return {
    scope:await hash(localDomain+'\n'+accountId),
    key:await hash(localDomain+'\n'+accountId+'\n'+peerId),
  }
}
async function localAes(s:Session,key:string,usage:KeyUsage):Promise<CryptoKey>{
  const bytes=unb64(s.pkg.akek,32)
  let root:CryptoKey
  try{root=await crypto.subtle.importKey('raw',bytes,'HKDF',false,['deriveKey'])}
  finally{bytes.fill(0)}
  return crypto.subtle.deriveKey({
    name:'HKDF',hash:'SHA-256',salt:enc.encode(localDomain),
    info:enc.encode(key),
  },root,{name:'AES-GCM',length:256},false,[usage])
}
function aad(scope:string,key:string):Uint8Array<ArrayBuffer>{
  return enc.encode(localDomain+'\n'+scope+'\n'+key)
}
function parseExact(v:unknown,keys:string[],code:string):Record<string,unknown>{
  if(!v||typeof v!=='object'||Array.isArray(v))
    throw Error(code)
  const data=v as Record<string,unknown>
  if(Object.keys(data).sort().join('|')!==keys.sort().join('|'))
    throw Error(code)
  return data
}
function binding(value:unknown):MatrixBindingContract{
  const x=parseExact(value,[
    'version','operationId','accountId','pb3DeviceId',
    'homeserverUrl','matrixUserId','matrixDeviceId',
  ],'matrix.contact_invalid_binding')
  if(x.version!==1||typeof x.accountId!=='string'||!uuidRe.test(x.accountId)
    ||typeof x.pb3DeviceId!=='string'||!uuidRe.test(x.pb3DeviceId)
    ||typeof x.operationId!=='string'||!uuidRe.test(x.operationId)
    ||typeof x.homeserverUrl!=='string'||!originRe.test(x.homeserverUrl)
    ||typeof x.matrixUserId!=='string'||!mxidRe.test(x.matrixUserId)
    ||typeof x.matrixDeviceId!=='string'||!mxDeviceRe.test(x.matrixDeviceId))
    throw Error('matrix.contact_invalid_binding')
  return x as MatrixBindingContract
}
function parseCard(raw:string):MatrixCard{
  if(typeof raw!=='string'||raw.length>4096)
    throw Error('matrix.contact_invalid_card')
  let obj:unknown
  try{obj=JSON.parse(raw)}
  catch{throw Error('matrix.contact_invalid_card')}
  const c=parseExact(obj,[
    'version','accountId','accountRevision','accountSpki',
    'pb3DeviceId','pb3DeviceSpki','bindingContract',
    'bindingAccountSignature','bindingDeviceSignature',
  ],'matrix.contact_invalid_card')
  if(c.version!==1||typeof c.accountId!=='string'||!uuidRe.test(c.accountId)
    ||!Number.isSafeInteger(c.accountRevision)||(c.accountRevision as number)<1
    ||typeof c.accountSpki!=='string'
    ||typeof c.pb3DeviceId!=='string'||!uuidRe.test(c.pb3DeviceId)
    ||typeof c.pb3DeviceSpki!=='string'
    ||typeof c.bindingContract!=='string'
    ||typeof c.bindingAccountSignature!=='string'
    ||typeof c.bindingDeviceSignature!=='string'
    ||JSON.stringify(c)!==raw)
    throw Error('matrix.contact_invalid_card')
  return c as MatrixCard
}
function readSigned(value:string):SignedCard{
  if(!value.startsWith(prefix)||value.length>8000||value.length<32)
    throw Error('matrix.contact_invalid_card')
  let decoded:unknown
  try{decoded=JSON.parse(dec.decode(unb64(value.slice(prefix.length))))}
  catch{throw Error('matrix.contact_invalid_card')}
  const x=parseExact(decoded,['version','card','signature'],
    'matrix.contact_invalid_card')
  if(x.version!==1||typeof x.card!=='string'
    ||typeof x.signature!=='string'
    ||JSON.stringify(x)!==dec.decode(unb64(value.slice(prefix.length))))
    throw Error('matrix.contact_invalid_card')
  return x as SignedCard
}
async function verifyCard(signed:SignedCard,peerId:string,
  peerSpki:string):Promise<{card:MatrixCard;binding:MatrixBindingContract}>{
  const card=parseCard(signed.card)
  if(card.accountId!==peerId||card.accountSpki!==peerSpki
    ||card.pb3DeviceId===undefined)
    throw Error('matrix.contact_pinned_account_mismatch')
  let real:MatrixBindingContract
  try{real=binding(JSON.parse(card.bindingContract))}
  catch{throw Error('matrix.contact_invalid_binding')}
  if(JSON.stringify(real)!==card.bindingContract
    ||real.accountId!==card.accountId
    ||real.pb3DeviceId!==card.pb3DeviceId)
    throw Error('matrix.contact_invalid_binding')
  try{
    const root=await importSpki(card.accountSpki)
    const device=await importSpki(card.pb3DeviceSpki)
    const verified=await Promise.all([
      verify(root,trustDomain+signed.card,signed.signature),
      verify(root,'pb3.matrix-binding.v1\n'+card.bindingContract,
        card.bindingAccountSignature),
      verify(device,'pb3.matrix-binding.v1\n'+card.bindingContract,
        card.bindingDeviceSignature),
    ])
    if(verified.some(ok=>!ok))throw Error('matrix.contact_invalid_signature')
  }catch{throw Error('matrix.contact_invalid_signature')}
  return {card,binding:real}
}
async function requireContact(s:Session,peerAccountId:string,
  fingerprint:string):Promise<void>{
  const contacts=await listConfirmedContacts()
  current(s)
  if(!contacts.some(c=>c.peerAccountId===peerAccountId
    &&c.safetyFingerprint===fingerprint))
    throw Error('matrix.contact_not_confirmed')
  const pin=await pinnedPeer(peerAccountId,true)
  current(s)
  if(pin.safetyFingerprint!==fingerprint)
    throw Error('matrix.contact_fingerprint_changed')
}
async function encryptPin(s:Session,record:AcceptedPin):Promise<void>{
  const {scope,key}=await identifiers(s.accountId,record.peerAccountId)
  const iv=random(12)
  const ciphertext=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,tagLength:128,additionalData:aad(scope,key),
  },await localAes(s,key,'encrypt'),enc.encode(JSON.stringify(record)))
  current(s)
  await db.transaction('rw',db.peers,async()=>{
    const old=await db.peers.get(key)
    if(old)throw Error('matrix.contact_already_pinned')
    await db.peers.put({
      key,scope,iv:b64(iv),ciphertext:b64(ciphertext),
    })
  })
  current(s)
}
async function decryptPin(s:Session,peerId:string):Promise<AcceptedPin|null>{
  const {scope,key}=await identifiers(s.accountId,peerId)
  const row=await db.peers.get(key)
  current(s)
  if(!row)return null
  if(row.scope!==scope||row.key!==key
    ||!shaRe.test(row.scope)||!shaRe.test(row.key))
    throw Error('matrix.contact_ciphertext_corrupt')
  let pin:AcceptedPin
  try{
    const bytes=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(row.iv,12),tagLength:128,
      additionalData:aad(scope,key),
    },await localAes(s,key,'decrypt'),unb64(row.ciphertext))
    pin=JSON.parse(dec.decode(bytes)) as AcceptedPin
  }catch{throw Error('matrix.contact_ciphertext_corrupt')}
  if(!pin||pin.version!==1||pin.peerAccountId!==peerId
    ||typeof pin.peerFingerprint!=='string'||!shaRe.test(pin.peerFingerprint)
    ||typeof pin.approvedMatrixUserId!=='string'
    ||typeof pin.signedCard!=='string'
    ||Object.keys(pin).sort().join('|')!==
      'approvedMatrixUserId|peerAccountId|peerFingerprint|signedCard|version')
    throw Error('matrix.contact_ciphertext_corrupt')
  return pin
}

/** Export only the existing verified PB3 account↔Matrix binding. */
export async function exportOwnMatrixIdentityCard():Promise<string>{
  const s=requireLive()
  const bound=await getBoundMatrixCredentials()
  current(s)
  if(!bound)throw Error('matrix.contact_own_binding_required')
  const mine=await jsonApi<{
    bound:boolean;homeserverUrl:string;matrixUserId:string|null
    deviceBinding?:{
      contract:string;accountSignature:string;deviceSignature:string
    }|null
  }>('/matrix/v1/me')
  current(s)
  const c=bound.contract
  if(!mine.bound||mine.homeserverUrl!==c.homeserverUrl
    ||mine.matrixUserId!==c.matrixUserId
    ||mine.deviceBinding?.contract!==JSON.stringify(c)
    ||!mine.deviceBinding?.accountSignature
    ||!mine.deviceBinding?.deviceSignature
    ||c.accountId!==s.accountId||c.pb3DeviceId!==s.deviceId)
    throw Error('matrix.contact_own_binding_mismatch')
  const card:MatrixCard={
    version:1,accountId:s.accountId,accountRevision:s.pkg.revision,
    accountSpki:s.pkg.accountSpki,pb3DeviceId:s.deviceId,
    pb3DeviceSpki:s.device.deviceSpki,
    bindingContract:mine.deviceBinding.contract,
    bindingAccountSignature:mine.deviceBinding.accountSignature,
    bindingDeviceSignature:mine.deviceBinding.deviceSignature,
  }
  const serialized=JSON.stringify(card)
  await verifyCard({version:1,card:serialized,
    signature:await sign(await importSigner(s.pkg.accountPkcs8),
      trustDomain+serialized)},s.accountId,s.pkg.accountSpki)
  current(s)
  const signed:SignedCard={
    version:1,card:serialized,
    signature:await sign(await importSigner(s.pkg.accountPkcs8),
      trustDomain+serialized),
  }
  return prefix+b64(enc.encode(JSON.stringify(signed)))
}

/** Explicit fingerprint and MXID confirmation is REQUIRED by the caller.
 * This stores a PB3-account-attested mapping, not Matrix device trust.
 */
export async function acceptMatrixIdentityCard(
  text:string,peerAccountId:string,expectedFingerprint:string,
  approvedMatrixUserId:string,
):Promise<void>{
  return serial(async()=>{
    const s=requireLive()
    if(!uuidRe.test(peerAccountId)||peerAccountId===s.accountId
      ||!shaRe.test(expectedFingerprint)||!mxidRe.test(approvedMatrixUserId))
      throw Error('matrix.contact_invalid_confirmation')
    const signed=readSigned(text)
    const peer=await pinnedPeer(peerAccountId,true)
    current(s)
    if(peer.accountId!==peerAccountId
      ||peer.safetyFingerprint!==expectedFingerprint)
      throw Error('matrix.contact_fingerprint_changed')
    await requireContact(s,peerAccountId,expectedFingerprint)
    const {binding:verified}=await verifyCard(
      signed,peerAccountId,peer.accountSpki)
    if(verified.matrixUserId!==approvedMatrixUserId)
      throw Error('matrix.contact_mxid_not_confirmed')
    const me=await jsonApi<{
      configured:boolean;homeserverUrl:string
    }>('/matrix/v1/me')
    current(s)
    if(!me.configured||me.homeserverUrl!==verified.homeserverUrl)
      throw Error('matrix.contact_foreign_homeserver')
    const old=await decryptPin(s,peerAccountId)
    if(old){
      if(old.signedCard===text
        &&old.peerFingerprint===expectedFingerprint
        &&old.approvedMatrixUserId===approvedMatrixUserId)return
      throw Error('matrix.contact_mapping_changed')
    }
    await encryptPin(s,{
      version:1,peerAccountId,peerFingerprint:expectedFingerprint,
      approvedMatrixUserId,signedCard:text,
    })
  })
}

/** Only an account-signed local mapping, NOT proof of current Matrix device
 * ed25519 identity, membership or eligibility for an E2EE room/send.
 */
export async function getMatrixContactMapping(peerAccountId:string):Promise<{
  matrixUserId:string;matrixDeviceId:string;homeserverUrl:string
  verification:'pb3-account-signed-only'
}|null>{
  const s=requireSession()
  if(!uuidRe.test(peerAccountId))throw Error('matrix.contact_invalid_peer')
  const record=await decryptPin(s,peerAccountId)
  if(!record)return null
  const contact=(await listConfirmedContacts())
    .find(c=>c.peerAccountId===peerAccountId
      &&c.safetyFingerprint===record.peerFingerprint)
  current(s)
  if(!contact)throw Error('matrix.contact_fingerprint_changed')
  const directory=await pinnedPeer(peerAccountId,false)
  current(s)
  if(directory.safetyFingerprint!==record.peerFingerprint)
    throw Error('matrix.contact_fingerprint_changed')
  const signed=readSigned(record.signedCard)
  const {binding:verified}=await verifyCard(
    signed,peerAccountId,directory.accountSpki)
  if(verified.matrixUserId!==record.approvedMatrixUserId)
    throw Error('matrix.contact_mapping_changed')
  return {
    matrixUserId:verified.matrixUserId,
    matrixDeviceId:verified.matrixDeviceId,
    homeserverUrl:verified.homeserverUrl,
    verification:'pb3-account-signed-only',
  }
}
/** Local-only forget; cannot revoke Matrix membership, peer devices or keys. */
export async function forgetMatrixContactMapping(peerAccountId:string):Promise<void>{
  const s=requireSession()
  if(!uuidRe.test(peerAccountId))throw Error('matrix.contact_invalid_peer')
  const {key}=await identifiers(s.accountId,peerAccountId)
  current(s)
  await db.peers.delete(key)
  current(s)
}
