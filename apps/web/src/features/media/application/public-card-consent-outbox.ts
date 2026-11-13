import Dexie,{type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {
  b64,unb64,random,digest,hex,importSigner,importSpki,sign,verify,
} from '../../identity/infrastructure/crypto'
import {
  inspectFlattenedSafeJpeg,PUBLIC_JPEG_MAX_OUTPUT_BYTES,
} from './public-card-safe-jpeg'
import type {PreparedSafePublicJpeg} from './public-card-safe-jpeg'

/**
 * Private Local-First PREPUBLICATION consent journal, intentionally offline-only.
 * Signing a contributor declaration does NOT grant or upload anything.
 * A future server MUST independently authenticate signed submission provenance,
 * safe bytes, live account/ACL and revocation. This journal is never a grant.
 *
 * Only ciphertext and opaque scoped hashes are persisted in IndexedDB. The
 * actual JPEG is NOT persisted here, even encrypted. Every real future publish
 * action must reobtain and recheck the exact bytes and true public consent.
 */
const DOMAIN='pb3.public-card-contributor-consent-preflight.v1\n'
const INDEX='pb3.public-card-prepared-consent-index.v1\n'
const AAD='pb3.public-card-prepared-consent-aead.v1\n'
const enc=new TextEncoder()
const dec=new TextDecoder('utf-8',{fatal:true})
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const digestPattern=/^[a-f0-9]{64}$/
const FIELDS=['description','capturedAt','updatedAt','tags',
  'authorTeam','gps','metadata'] as const
const CONTRACT=['version','consentId','operationId','contributorAccountId',
  'assignmentId','submissionId','submissionContractHash','sourceMediaId',
  'sourceContractHash','safeMediaId','safeDerivativeSha256',
  'reviewDeclaration','scope','action','expiresAt','fields'] as const
const MAX_PREPARED_TTL_MS=24*60*60*1000

export type ConsentField=typeof FIELDS[number]
export type ConsentFields=Record<ConsentField,boolean>
export type ConsentBinding={
  assignmentId:string;submissionId:string;submissionContractHash:string
  sourceMediaId:string;sourceContractHash:string;safeMediaId:string
  sourceExpiresAt:number;safeExpiresAt:number;assignmentExpiresAt:number
}
export type PreparedConsentContract={
  version:1;consentId:string;operationId:string
  contributorAccountId:string;assignmentId:string;submissionId:string
  submissionContractHash:string;sourceMediaId:string
  sourceContractHash:string;safeMediaId:string
  safeDerivativeSha256:string
  reviewDeclaration:'reviewed-exact-safe-jpeg-sha256'
  scope:'safe-jpeg-view-only-v1'
  action:'prepare-consent'
  expiresAt:number;fields:ConsentFields
}
export type LocalPreparedConsent={
  contract:PreparedConsentContract;signature:string
  state:'prepared'|'expired'
  published:false;publicAuthorized:false
  imageBytesStored:false;localWithdrawalOnly:true
}
type CipherRow={key:string;ownerScope:string;iv:string;ciphertext:string}
type RevokedRow={key:string;ownerScope:string;withdrawnAt:number}
class ConsentDb extends Dexie{
  prepared!:Table<CipherRow,string>
  withdrawals!:Table<RevokedRow,string>
  constructor(){
    super('pb3-public-card-prepared-consent-v1')
    this.version(1).stores({
      prepared:'&key,ownerScope',
      withdrawals:'&key,ownerScope',
    })
  }
}
const db=new ConsentDb()

function exact(value:unknown,keys:readonly string[]):boolean{
  return !!value&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).sort().join('|')
      ===[...keys].sort().join('|')
}
function validHash(v:unknown):v is string{
  return typeof v==='string'&&digestPattern.test(v)
}
function checkIdentity(s:Session):void{
  const now=activeSession.value
  // Even same-account reauthentication during sign/encrypt is an explicit
  // retry, not an implicit authorization continuation.
  if(now!==s||now.accountId!==s.accountId||now.deviceId!==s.deviceId
    ||now.pkg.akek!==s.pkg.akek
    ||now.pkg.revision!==s.pkg.revision
    ||now.pkg.accountSpki!==s.pkg.accountSpki)
    throw Error('public_card.consent_identity_changed')
}
async function scopeFor(accountId:string):Promise<string>{
  return hex(await digest(enc.encode(INDEX+accountId)))
}
async function keyFor(accountId:string,submissionId:string):Promise<string>{
  return hex(await digest(enc.encode(INDEX+accountId+'\n'+submissionId)))
}
function additionalData(scope:string,key:string):Uint8Array<ArrayBuffer>{
  return enc.encode(AAD+scope+'\n'+key)
}
async function secret(akek:string,usage:KeyUsage):Promise<CryptoKey>{
  const raw=unb64(akek,32)
  try{return await crypto.subtle.importKey('raw',raw,{
    name:'AES-GCM',
  },false,[usage])}
  finally{raw.fill(0)}
}
function checkedContract(raw:unknown):PreparedConsentContract{
  if(!exact(raw,CONTRACT))throw Error('public_card.consent_invalid')
  const c=raw as PreparedConsentContract
  if(c.version!==1||c.scope!=='safe-jpeg-view-only-v1'
    ||c.action!=='prepare-consent'
    ||c.reviewDeclaration!=='reviewed-exact-safe-jpeg-sha256'
    ||![c.consentId,c.operationId,c.contributorAccountId,
      c.assignmentId,c.submissionId,c.sourceMediaId,c.safeMediaId]
      .every(id=>typeof id==='string'&&uuid.test(id))
    ||c.sourceMediaId===c.safeMediaId
    ||![c.sourceContractHash,c.submissionContractHash,
      c.safeDerivativeSha256].every(validHash)
    ||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=0
    ||!exact(c.fields,FIELDS)
    ||FIELDS.some(field=>typeof c.fields[field]!=='boolean')
    ||FIELDS.some(field=>!['description','capturedAt'].includes(field)
      &&c.fields[field]!==false))
    throw Error('public_card.consent_invalid')
  return c
}
function checkedBinding(binding:ConsentBinding,accountId:string):void{
  if(!binding||![binding.assignmentId,binding.submissionId,
    binding.sourceMediaId,binding.safeMediaId,accountId]
      .every(x=>typeof x==='string'&&uuid.test(x))
    ||binding.sourceMediaId===binding.safeMediaId
    ||![binding.submissionContractHash,binding.sourceContractHash]
      .every(validHash))
    throw Error('public_card.consent_invalid_binding')
  const now=Date.now()
  for(const expires of [
    binding.sourceExpiresAt,binding.safeExpiresAt,binding.assignmentExpiresAt
  ]){
    if(!Number.isSafeInteger(expires)||expires<=now)
      throw Error('public_card.consent_expired_binding')
  }
}

async function decodedImageMatches(
  prepared:PreparedSafePublicJpeg,
  expectedDigest:string,
):Promise<void>{
  if(!prepared||prepared.published!==false
    ||prepared.humanReviewRequired!==true
    ||!prepared.blob||prepared.blob.type!=='image/jpeg'
    ||prepared.blob.size<32
    ||prepared.blob.size>PUBLIC_JPEG_MAX_OUTPUT_BYTES
    ||!validHash(prepared.sha256)
    ||prepared.sha256!==expectedDigest)
    throw Error('public_card.consent_unverified_jpeg')
  const raw=new Uint8Array(await prepared.blob.arrayBuffer())
  const inspected=inspectFlattenedSafeJpeg(raw)
  const actual=hex(await digest(new Uint8Array(raw)))
  if(actual!==expectedDigest
    ||inspected.width!==prepared.width
    ||inspected.height!==prepared.height)
    throw Error('public_card.consent_jpeg_changed')
  if(typeof createImageBitmap!=='function')
    throw Error('public_card.consent_decoder_missing')
  let bitmap:ImageBitmap
  try{bitmap=await createImageBitmap(prepared.blob)}
  catch{throw Error('public_card.consent_decode_failed')}
  try{
    if(bitmap.width!==inspected.width||bitmap.height!==inspected.height)
      throw Error('public_card.consent_decode_changed')
  }finally{bitmap.close()}
}

async function unpack(
  row:CipherRow,scope:string,s:Session,
):Promise<LocalPreparedConsent>{
  if(row.ownerScope!==scope||!validHash(row.key)
    ||typeof row.iv!=='string'||typeof row.ciphertext!=='string')
    throw Error('public_card.consent_ciphertext_invalid')
  let decrypted:ArrayBuffer
  try{
    const key=await secret(s.pkg.akek,'decrypt')
    decrypted=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(row.iv,12),
      additionalData:additionalData(row.ownerScope,row.key),tagLength:128,
    },key,unb64(row.ciphertext))
  }catch{throw Error('public_card.consent_ciphertext_unreadable')}
  let content:{contract:string;signature:string}
  let contract:PreparedConsentContract
  try{
    content=JSON.parse(dec.decode(decrypted)) as typeof content
    if(!exact(content,['contract','signature'])
      ||typeof content.contract!=='string'
      ||typeof content.signature!=='string')
      throw Error('invalid')
    contract=checkedContract(JSON.parse(content.contract))
    if(content.contract!==JSON.stringify(contract)
      ||contract.contributorAccountId!==s.accountId
      ||await keyFor(s.accountId,contract.submissionId)!==row.key
      ||!(await verify(await importSpki(s.pkg.accountSpki),
        DOMAIN+content.contract,content.signature)))
      throw Error('invalid')
  }catch{throw Error('public_card.consent_encrypted_record_invalid')}
  checkIdentity(s)
  return {
    contract,signature:content.signature,
    state:contract.expiresAt<=Date.now()?'expired':'prepared',
    published:false,publicAuthorized:false,
    imageBytesStored:false,localWithdrawalOnly:true,
  }
}

/**
 * Called ONLY in response to a future explicit per-image review UI action.
 * "reviewedSha256" is an assertion by the user, not proof of visual safety.
 * Input binding is NOT authoritative server provenance; a future real issuer
 * must independently verify it, the current safe media and every ACL.
 */
export async function prepareReviewedContributorConsent(
  binding:ConsentBinding,prepared:PreparedSafePublicJpeg,
  reviewed:{visiblePixelsReviewed:true;reviewedSha256:string},
  fields:ConsentFields,expiresAt:number,
):Promise<string>{
  const s=requireSession()
  checkedBinding(binding,s.accountId)
  if(!reviewed||reviewed.visiblePixelsReviewed!==true
    ||!validHash(reviewed.reviewedSha256))
    throw Error('public_card.consent_review_required')
  if(!Number.isSafeInteger(expiresAt)
    ||expiresAt<=Date.now()
    ||expiresAt>Date.now()+MAX_PREPARED_TTL_MS
    ||expiresAt>Math.min(binding.sourceExpiresAt,
      binding.safeExpiresAt,binding.assignmentExpiresAt))
    throw Error('public_card.consent_expired')
  if(!exact(fields,FIELDS))throw Error('public_card.consent_invalid_fields')
  const contract:PreparedConsentContract={
    version:1,consentId:crypto.randomUUID(),operationId:crypto.randomUUID(),
    contributorAccountId:s.accountId,
    assignmentId:binding.assignmentId,
    submissionId:binding.submissionId,
    submissionContractHash:binding.submissionContractHash,
    sourceMediaId:binding.sourceMediaId,
    sourceContractHash:binding.sourceContractHash,
    safeMediaId:binding.safeMediaId,
    safeDerivativeSha256:reviewed.reviewedSha256,
    reviewDeclaration:'reviewed-exact-safe-jpeg-sha256',
    scope:'safe-jpeg-view-only-v1',
    action:'prepare-consent',expiresAt,
    fields:{...fields},
  }
  checkedContract(contract)
  await decodedImageMatches(prepared,reviewed.reviewedSha256)
  checkIdentity(s)
  const raw=JSON.stringify(contract)
  const signature=await sign(await importSigner(s.pkg.accountPkcs8),DOMAIN+raw)
  checkIdentity(s)
  const ownerScope=await scopeFor(s.accountId)
  const rowKey=await keyFor(s.accountId,binding.submissionId)
  const cipherKey=await secret(s.pkg.akek,'encrypt')
  const iv=random(12)
  const ciphertext=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,
    additionalData:additionalData(ownerScope,rowKey),tagLength:128,
  },cipherKey,enc.encode(JSON.stringify({contract:raw,signature})))
  checkIdentity(s)
  await db.transaction('rw',db.prepared,db.withdrawals,async()=>{
    // Atomic exclusion: no stale async sign can overwrite withdrawn entry.
    if(await db.withdrawals.get(rowKey))
      throw Error('public_card.consent_withdrawn')
    if(await db.prepared.get(rowKey))
      throw Error('public_card.consent_already_prepared')
    checkIdentity(s)
    await db.prepared.add({
      key:rowKey,ownerScope,iv:b64(iv),ciphertext:b64(ciphertext),
    })
  })
  checkIdentity(s)
  return contract.consentId
}

/** Returns signed, decrypted owner-private declarations; NO public capability. */
export async function listPreparedContributorConsents():Promise<LocalPreparedConsent[]>{
  const s=requireSession()
  const scope=await scopeFor(s.accountId)
  const rows=await db.prepared.where('ownerScope').equals(scope).toArray()
  checkIdentity(s)
  const items:LocalPreparedConsent[]=[]
  for(const row of rows){
    // A stale/deleted row or reimported ciphertext must not override a
    // durable revocation marker, including after offline reload.
    if(await db.withdrawals.get(row.key))
      throw Error('public_card.consent_withdrawn_record')
    items.push(await unpack(row,scope,s))
  }
  checkIdentity(s)
  return items.sort((a,b)=>a.contract.expiresAt-b.contract.expiresAt)
}

/** Local tombstone ONLY. Never claim a remote/public grant was revoked. */
export async function withdrawPreparedContributorConsent(
  submissionId:string,
):Promise<{withdrawn:true;localOnly:true;publicGrantRevoked:false}>{
  const s=requireSession()
  if(!uuid.test(submissionId))
    throw Error('public_card.consent_invalid_submission')
  const scope=await scopeFor(s.accountId)
  const rowKey=await keyFor(s.accountId,submissionId)
  checkIdentity(s)
  await db.transaction('rw',db.prepared,db.withdrawals,async()=>{
    const previous=await db.withdrawals.get(rowKey)
    if(previous){
      if(previous.ownerScope!==scope)
        throw Error('public_card.consent_wrong_scope')
      return
    }
    const row=await db.prepared.get(rowKey)
    if(!row||row.ownerScope!==scope)
      throw Error('public_card.consent_not_prepared')
    checkIdentity(s)
    await db.withdrawals.add({
      key:rowKey,ownerScope:scope,withdrawnAt:Date.now(),
    })
    await db.prepared.delete(rowKey)
  })
  checkIdentity(s)
  return {withdrawn:true,localOnly:true,publicGrantRevoked:false}
}
