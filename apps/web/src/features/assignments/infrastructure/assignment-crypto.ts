import {
  b64, unb64, random, exchangeKey, exportECDHPublic,
} from '../../identity/infrastructure/crypto'
import type { PackageV2 } from '../../identity/infrastructure/crypto'

const encoder=new TextEncoder()
const decoder=new TextDecoder('utf-8',{fatal:true})

export type PrivateAssignment={
  version:1;title:string;instructions:string
}
export type AssignmentEnvelope={
  version:1;iv:string;ciphertext:string
  wrappedKey:{iv:string;ciphertext:string}
}
export type AssignmentInviteEnvelope={
  ephemeralSpki:string;salt:string;iv:string;ciphertext:string
}

function keyScope(ownerAccountId:string,assignmentId:string):Uint8Array<ArrayBuffer> {
  return encoder.encode('pb3.assignment-owner-key.v1\n'+ownerAccountId+'\n'+assignmentId)
}
function contentScope(ownerAccountId:string,assignmentId:string):Uint8Array<ArrayBuffer>{
  return encoder.encode('pb3.assignment-private.v1\n'+ownerAccountId+'\n'+assignmentId)
}
function grantScope(input:{
  assignmentId:string;inviteId:string;ownerAccountId:string
  recipientAccountId:string;role:'contributor';expiresAt:number
}):string{
  return 'pb3.assignment-invite-dek.v1\n'+JSON.stringify({version:1,...input})
}
function validateText(value:PrivateAssignment):void {
  if(value.version!==1||typeof value.title!=='string'
    ||value.title.trim().length<1||value.title.length>120
    ||typeof value.instructions!=='string'||value.instructions.length>4000)
    throw new Error('assignment.invalid_text')
}

async function unwrapOwnerKey<T>(
  owner:PackageV2,assignmentId:string,envelope:AssignmentEnvelope,
  operation:(raw:Uint8Array<ArrayBuffer>)=>Promise<T>,
):Promise<T>{
  if(envelope.version!==1)throw new Error('assignment.invalid_envelope')
  const akek=unb64(owner.akek,32)
  try{
    const key=await crypto.subtle.importKey('raw',akek,
      {name:'AES-GCM'},false,['decrypt'])
    const raw=new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(envelope.wrappedKey.iv,12),
      additionalData:keyScope(owner.accountId,assignmentId),tagLength:128,
    },key,unb64(envelope.wrappedKey.ciphertext,48)))
    try{
      if(raw.byteLength!==32)throw new Error('assignment.invalid_key')
      return await operation(raw)
    }finally{raw.fill(0)}
  }finally{akek.fill(0)}
}

async function openContent(
  raw:Uint8Array<ArrayBuffer>,ownerAccountId:string,assignmentId:string,
  envelope:AssignmentEnvelope,
):Promise<PrivateAssignment>{
  const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt'])
  const plain=await crypto.subtle.decrypt({
    name:'AES-GCM',iv:unb64(envelope.iv,12),
    additionalData:contentScope(ownerAccountId,assignmentId),tagLength:128,
  },key,unb64(envelope.ciphertext))
  const parsed=JSON.parse(decoder.decode(plain)) as PrivateAssignment
  validateText(parsed)
  return parsed
}

export async function sealAssignment(
  owner:PackageV2,assignmentId:string,values:PrivateAssignment,
):Promise<AssignmentEnvelope>{
  validateText(values)
  const raw=random(32),akek=unb64(owner.akek,32)
  try{
    const dek=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt'])
    const wrap=await crypto.subtle.importKey('raw',akek,{name:'AES-GCM'},false,['encrypt'])
    const iv=random(12),wrapIv=random(12)
    const [cipher,wrapped]=await Promise.all([
      crypto.subtle.encrypt({
        name:'AES-GCM',iv,additionalData:contentScope(owner.accountId,assignmentId),tagLength:128,
      },dek,encoder.encode(JSON.stringify(values))),
      crypto.subtle.encrypt({
        name:'AES-GCM',iv:wrapIv,additionalData:keyScope(owner.accountId,assignmentId),tagLength:128,
      },wrap,raw),
    ])
    return {version:1,iv:b64(iv),ciphertext:b64(cipher),
      wrappedKey:{iv:b64(wrapIv),ciphertext:b64(wrapped)}}
  }finally{raw.fill(0);akek.fill(0)}
}

export async function openOwnerAssignment(
  owner:PackageV2,assignmentId:string,envelope:AssignmentEnvelope,
):Promise<PrivateAssignment>{
  return unwrapOwnerKey(owner,assignmentId,envelope,
    raw=>openContent(raw,owner.accountId,assignmentId,envelope))
}

export async function wrapAssignmentForRecipient(
  owner:PackageV2,assignmentId:string,envelope:AssignmentEnvelope,
  invite:{
    inviteId:string;recipientAccountId:string;expiresAt:number;role:'contributor'
  },recipientECDHSpki:string,
):Promise<AssignmentInviteEnvelope>{
  const context={
    assignmentId,inviteId:invite.inviteId,
    ownerAccountId:owner.accountId,recipientAccountId:invite.recipientAccountId,
    role:invite.role,expiresAt:invite.expiresAt,
  }
  const info=grantScope(context)
  return unwrapOwnerKey(owner,assignmentId,envelope,async raw=>{
    const temporary=await crypto.subtle.generateKey(
      {name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
    const salt=random(16),iv=random(12)
    const wrap=await exchangeKey(temporary.privateKey,recipientECDHSpki,info,salt)
    const ciphertext=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:encoder.encode(info),tagLength:128,
    },wrap,raw)
    return {
      ephemeralSpki:await exportECDHPublic(temporary.publicKey),
      salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext),
    }
  })
}

/**
 * Caller MUST verify owner account signature and pinned safety fingerprint
 * before using this decryptor. A plain invite envelope is NOT authentication.
 */
export async function openRecipientAssignment(
  recipientECDHPrivate:CryptoKey,
  context:{
    assignmentId:string;inviteId:string
    ownerAccountId:string;recipientAccountId:string
    role:'contributor';expiresAt:number
  },
  shared:AssignmentInviteEnvelope,
  privateEnvelope:AssignmentEnvelope,
):Promise<PrivateAssignment>{
  const info=grantScope(context)
  const key=await exchangeKey(recipientECDHPrivate,shared.ephemeralSpki,
    info,unb64(shared.salt,16))
  const raw=new Uint8Array(await crypto.subtle.decrypt({
    name:'AES-GCM',iv:unb64(shared.iv,12),
    additionalData:encoder.encode(info),tagLength:128,
  },key,unb64(shared.ciphertext,48)))
  try{
    if(raw.byteLength!==32)throw new Error('assignment.invalid_shared_key')
    return await openContent(raw,context.ownerAccountId,context.assignmentId,privateEnvelope)
  }finally{raw.fill(0)}
}
