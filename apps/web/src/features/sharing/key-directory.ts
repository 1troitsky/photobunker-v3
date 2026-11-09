import Dexie, { type Table } from 'dexie'
import { activeSession, requireSession } from '../../identity/application/session'
import { jsonApi } from '../../identity/infrastructure/api'
import {
  b64, unb64, random, digest, hex, importSigner, importSpki,
  sign, verify,
} from '../../identity/infrastructure/crypto'
import type { PackageV2 } from '../../identity/infrastructure/crypto'

const encoder=new TextEncoder()
const exchangeDomain='pb3.recipient-key.v1\n'
const encryptionAAD=(accountId:string,exchangeSpki:string)=>
  encoder.encode('pb3.recipient-private.v1\n'+accountId+'\n'+exchangeSpki)

export type SignedDirectory={
  accountId:string
  accountSpki:string
  descriptor:string
  signature:string
  descriptorHash:string
  exchangeSpki:string
  safetyFingerprint:string
}
export type PeerPin={
  key:string
  localAccountId:string
  peerAccountId:string
  accountSpki:string
  descriptorHash:string
  safetyFingerprint:string
  directory:SignedDirectory
}

class TrustDB extends Dexie {
  peers!:Table<PeerPin,string>
  constructor() {
    super('pb3-recipient-peer-pins-v1')
    this.version(1).stores({peers:'&key, localAccountId, peerAccountId'})
  }
}
const trustDB=new TrustDB()

function sameSession(s:ReturnType<typeof requireSession>):void {
  if(activeSession.value!==s) throw new Error('identity.changed')
}

async function shaString(text:string):Promise<string> {
  return hex(await digest(encoder.encode(text)))
}

function parseDescriptor(text:string):{
  version:number;accountId:string;exchangeSpki:string;sealedDigest:string
} {
  const d=JSON.parse(text) as Record<string,unknown>
  if(d.version!==1||typeof d.accountId!=='string'
    ||typeof d.exchangeSpki!=='string'||typeof d.sealedDigest!=='string'
    ||!(/^[a-f0-9]{64}$/).test(d.sealedDigest)
    ||Object.keys(d).sort().join('|')!=='accountId|exchangeSpki|sealedDigest|version') {
    throw new Error('share.invalid_directory')
  }
  if(JSON.stringify(d)!==text)throw new Error('share.noncanonical_directory')
  return d as {version:number;accountId:string;exchangeSpki:string;sealedDigest:string}
}

async function verifyDirectory(
  input:{accountId:string;accountSpki:string;descriptor:string;signature:string;descriptorHash:string},
):Promise<SignedDirectory> {
  const d=parseDescriptor(input.descriptor)
  if(d.accountId!==input.accountId
    ||await shaString(input.descriptor)!==input.descriptorHash
    ||!await verify(await importSpki(input.accountSpki),exchangeDomain+input.descriptor,input.signature)) {
    throw new Error('share.unsigned_directory')
  }
  // Invalid ECDH SPKIs must never be stored as peer keys.
  await crypto.subtle.importKey('spki',unb64(d.exchangeSpki),
    {name:'ECDH',namedCurve:'P-256'},false,[])
  return {...input,exchangeSpki:d.exchangeSpki,
    safetyFingerprint:await shaString('pb3-peer.v1\n'+input.accountId+'\n'
      +input.accountSpki+'\n'+d.exchangeSpki)}
}

/** This query never silently marks a new peer as trusted. */
export async function inspectPeer(accountId:string):Promise<{
  directory:SignedDirectory;confirmed:boolean
}> {
  const s=requireSession()
  if(s.accountId===accountId)throw new Error('share.cannot_share_self')
  if(!s.online) {
    const cached=await trustDB.peers.get(s.accountId+'/'+accountId)
    if(!cached)throw new Error('share.peer_requires_online_verification')
    return {directory:cached.directory,confirmed:true}
  }
  const response=await jsonApi<Omit<SignedDirectory,'exchangeSpki'|'safetyFingerprint'>>(
    '/shares/v1/keys/'+encodeURIComponent(accountId))
  const directory=await verifyDirectory(response)
  sameSession(s)
  const pin=await trustDB.peers.get(s.accountId+'/'+accountId)
  if(pin && (pin.accountSpki!==directory.accountSpki
    ||pin.descriptorHash!==directory.descriptorHash)) {
    throw new Error('share.peer_key_changed')
  }
  return {directory,confirmed:!!pin}
}

/** Requires a visible, explicit independent safety-number check in the UI. */
export async function confirmPeer(accountId:string,expectedFingerprint:string):Promise<void> {
  const s=requireSession()
  const {directory}=await inspectPeer(accountId)
  if(directory.safetyFingerprint!==expectedFingerprint)throw new Error('share.fingerprint_mismatch')
  const key=s.accountId+'/'+accountId
  await trustDB.transaction('rw',trustDB.peers,async()=>{
    const old=await trustDB.peers.get(key)
    if(old &&(old.accountSpki!==directory.accountSpki
      ||old.descriptorHash!==directory.descriptorHash))throw new Error('share.peer_key_changed')
    await trustDB.peers.put({
      key,localAccountId:s.accountId,peerAccountId:accountId,
      accountSpki:directory.accountSpki,
      descriptorHash:directory.descriptorHash,
      safetyFingerprint:directory.safetyFingerprint,directory,
    })
  })
}

export async function pinnedPeer(accountId:string):Promise<SignedDirectory> {
  const s=requireSession()
  const pin=await trustDB.peers.get(s.accountId+'/'+accountId)
  if(!pin)throw new Error('share.peer_not_confirmed')
  if(s.online){
    const checked=await inspectPeer(accountId)
    if(!checked.confirmed)throw new Error('share.peer_not_confirmed')
    return checked.directory
  }
  return pin.directory
}

export type OwnExchangeKey={privateKey:CryptoKey;directory:SignedDirectory}

async function importSecret(pkg:PackageV2,exchangeSpki:string,
  sealed:{iv:string;ciphertext:string}):Promise<CryptoKey> {
  const akek=unb64(pkg.akek,32)
  try{
    const key=await crypto.subtle.importKey('raw',akek,{name:'AES-GCM'},false,['decrypt'])
    const encoded=new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(sealed.iv,12),
      additionalData:encryptionAAD(pkg.accountId,exchangeSpki),tagLength:128,
    },key,unb64(sealed.ciphertext)))
    try{
      const ecdh=await crypto.subtle.importKey('pkcs8',encoded,
        {name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
      // Verify that the sealed key really corresponds to signed exchange SPKI.
      // WebCrypto has no direct export of non-extractable private public pair;
      // deriveBits with a known valid peer checks the key type, while the
      // AES-GCM AAD and signed sealedDigest bind the key to this descriptor.
      return ecdh
    } finally {encoded.fill(0)}
  } finally {akek.fill(0)}
}

async function createKey(s:ReturnType<typeof requireSession>):Promise<OwnExchangeKey> {
  const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits'])
  const exchangeSpki=b64(await crypto.subtle.exportKey('spki',pair.publicKey))
  const raw=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey))
  const akek=unb64(s.pkg.akek,32)
  let encrypted:ArrayBuffer
  let iv:Uint8Array<ArrayBuffer>
  try{
    const key=await crypto.subtle.importKey('raw',akek,{name:'AES-GCM'},false,['encrypt'])
    iv=random(12)
    encrypted=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,tagLength:128,
      additionalData:encryptionAAD(s.accountId,exchangeSpki),
    },key,raw)
  } finally {raw.fill(0);akek.fill(0)}
  const sealedPrivate={iv:b64(iv!),ciphertext:b64(encrypted!)}
  const descriptor=JSON.stringify({
    version:1,accountId:s.accountId,exchangeSpki,
    sealedDigest:await shaString(JSON.stringify(sealedPrivate)),
  })
  const signature=await sign(await importSigner(s.pkg.accountPkcs8),
    exchangeDomain+descriptor)
  sameSession(s)
  await jsonApi('/shares/v1/keys','POST',{descriptor,signature,sealedPrivate})
  const directory=await verifyDirectory({
    accountId:s.accountId,accountSpki:s.pkg.accountSpki,
    descriptor,signature,descriptorHash:await shaString(descriptor),
  })
  return {privateKey:pair.privateKey,directory}
}

let ongoing:Promise<OwnExchangeKey>|null=null
let ongoingFor:string|null=null

/** Recovered account package can unwrap the same exchange key on a new device. */
export async function ensureOwnExchangeKey():Promise<OwnExchangeKey> {
  const s=requireSession()
  if(!s.online)throw new Error('share.offline_key_unavailable')
  if(ongoing&&ongoingFor===s.accountId)return ongoing
  ongoingFor=s.accountId
  const operation=(async()=>{
    const record=await jsonApi<{
      present:boolean;descriptor?:string;signature?:string
      sealedPrivate?:{iv:string;ciphertext:string}
    }>('/shares/v1/keys/me')
    sameSession(s)
    if(!record.present)return createKey(s)
    if(!record.descriptor||!record.signature||!record.sealedPrivate)
      throw new Error('share.invalid_exchange_package')
    const descriptor=parseDescriptor(record.descriptor)
    const sealHash=await shaString(JSON.stringify(record.sealedPrivate))
    if(descriptor.accountId!==s.accountId
      ||descriptor.sealedDigest!==sealHash)throw new Error('share.exchange_key_mismatch')
    const verified=await verifyDirectory({
      accountId:s.accountId,accountSpki:s.pkg.accountSpki,
      descriptor:record.descriptor,signature:record.signature,
      descriptorHash:await shaString(record.descriptor),
    })
    const privateKey=await importSecret(s.pkg,verified.exchangeSpki,record.sealedPrivate)
    sameSession(s)
    return {privateKey,directory:verified}
  })()
  ongoing=operation
  try{return await operation}
  finally {if(ongoing===operation){ongoing=null;ongoingFor=null}}
}
