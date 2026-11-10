import { describe, expect, it } from 'vitest'
import { freshPackage, exportECDHPublic } from '../../identity/infrastructure/crypto'
import {
  sealAssignment, openOwnerAssignment, resealOwnerAssignment,
  wrapAssignmentForRecipient, openRecipientAssignment,
} from './assignment-crypto'

const ownerId='11111111-1111-4111-8111-111111111111'
const recipientId='22222222-2222-4222-8222-222222222222'
const assignmentId='33333333-3333-4333-8333-333333333333'
const inviteId='44444444-4444-4444-8444-444444444444'

describe('P1-04 assignment envelope and recipient DEK',()=>{
  it('seals private title and instructions and fails closed on owner/AAD tampering',async()=>{
    const owner=(await freshPackage(ownerId)).pkg
    const other=(await freshPackage(ownerId)).pkg
    const payload={version:1 as const,title:'30 photographs',instructions:'Capture encrypted evidence'}
    const envelope=await sealAssignment(owner,assignmentId,payload)
    expect(envelope.ciphertext).not.toContain(payload.title)
    expect(envelope.ciphertext).not.toContain(payload.instructions)
    expect(await openOwnerAssignment(owner,assignmentId,envelope)).toEqual(payload)
    await expect(openOwnerAssignment(other,assignmentId,envelope)).rejects.toThrow()
    await expect(openOwnerAssignment(owner,inviteId,envelope)).rejects.toThrow()
    await expect(openOwnerAssignment(owner,assignmentId,{
      ...envelope,iv:envelope.wrappedKey.iv,
    })).rejects.toThrow()
  })
  it('wraps each assignment DEK to one ECDH recipient with grant-scoped AES-GCM AAD',async()=>{
    const owner=(await freshPackage(ownerId)).pkg
    const envelope=await sealAssignment(owner,assignmentId,{
      version:1,title:'Photo assignment',instructions:'Make 30 photos',
    })
    const recipient=await crypto.subtle.generateKey(
      {name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
    const other=await crypto.subtle.generateKey(
      {name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
    const invite={
      inviteId,recipientAccountId:recipientId,expiresAt:Date.now()+86400000,
      role:'contributor' as const,
    }
    const sealed=await wrapAssignmentForRecipient(owner,assignmentId,envelope,
      invite,await exportECDHPublic(recipient.publicKey))
    expect(sealed.ciphertext.length).toBeGreaterThan(40)
    const ctx={
      assignmentId,inviteId,
      ownerAccountId:ownerId,recipientAccountId:recipientId,
      role:'contributor' as const,expiresAt:invite.expiresAt,
    }
    expect(await openRecipientAssignment(recipient.privateKey,ctx,sealed,envelope))
      .toMatchObject({title:'Photo assignment'})
    await expect(openRecipientAssignment(other.privateKey,ctx,sealed,envelope)).rejects.toThrow()
    await expect(openRecipientAssignment(recipient.privateKey,
      {...ctx,recipientAccountId:ownerId},sealed,envelope)).rejects.toThrow()
    await expect(openRecipientAssignment(recipient.privateKey,
      {...ctx,expiresAt:ctx.expiresAt+1},sealed,envelope)).rejects.toThrow()
    await expect(openRecipientAssignment(recipient.privateKey,ctx,{
      ...sealed,iv:sealed.salt,
    },envelope)).rejects.toThrow()
  })
})

describe('P1-19 unchanged DEK preserves accepted E2EE recipients across private text revisions',()=>{
  it('same owner-invite key decrypts a freshly sealed title, never a rotated key',async()=>{
    const owner=(await freshPackage(ownerId)).pkg
    const original=await sealAssignment(owner,assignmentId,{
      version:1,title:'OLD PRIVATE TITLE',instructions:'Original instructions',
    })
    const recipient=await crypto.subtle.generateKey(
      {name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
    const ctx={
      assignmentId,inviteId,ownerAccountId:ownerId,recipientAccountId:recipientId,
      role:'contributor' as const,expiresAt:Date.now()+86400000,
    }
    const invite=await wrapAssignmentForRecipient(owner,assignmentId,original,{
      inviteId,recipientAccountId:recipientId,expiresAt:ctx.expiresAt,
      role:'contributor',
    },await exportECDHPublic(recipient.publicKey))
    const revised=await resealOwnerAssignment(owner,assignmentId,original,{
      version:1,title:'UPDATED HIDDEN TITLE',instructions:'Private new instructions',
    })
    expect(revised.wrappedKey).toEqual(original.wrappedKey)
    expect(revised.iv).not.toBe(original.iv)
    expect(revised.ciphertext).not.toBe(original.ciphertext)
    for(const secret of ['UPDATED HIDDEN TITLE','Private new instructions']){
      expect(JSON.stringify(revised)).not.toContain(secret)
    }
    expect(await openOwnerAssignment(owner,assignmentId,original,revised))
      .toEqual({version:1,title:'UPDATED HIDDEN TITLE',
        instructions:'Private new instructions'})
    expect(await openRecipientAssignment(recipient.privateKey,ctx,invite,revised))
      .toEqual({version:1,title:'UPDATED HIDDEN TITLE',
        instructions:'Private new instructions'})
    expect(await openRecipientAssignment(recipient.privateKey,ctx,invite,original))
      .toMatchObject({title:'OLD PRIVATE TITLE'})
    const rotated=await sealAssignment(owner,assignmentId,{
      version:1,title:'MUST NOT ROTATE',instructions:'',
    })
    await expect(openOwnerAssignment(owner,assignmentId,original,rotated))
      .rejects.toThrow('assignment.private_key_rotation_forbidden')
    await expect(openRecipientAssignment(recipient.privateKey,ctx,invite,rotated))
      .rejects.toThrow()
    await expect(openOwnerAssignment(owner,inviteId,original,revised)).rejects.toThrow()
  })
})
