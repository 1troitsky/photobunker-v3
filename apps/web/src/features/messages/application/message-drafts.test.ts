import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage} from '../../identity/infrastructure/crypto'
import {
  getMessageDraft,listMessageDrafts,saveMessageDraft,
  MAX_MESSAGE_DRAFT_LENGTH,
} from './message-drafts'
import {listConfirmedContacts} from '../../people/application/contact-book'
import type {ConfirmedContact} from '../../people/application/contact-book'

vi.mock('../../people/application/contact-book',()=>({
  listConfirmedContacts:vi.fn(),
}))
const peers=vi.mocked(listConfirmedContacts)
const peerId='22222222-2222-4222-8222-222222222222'
const fingerprint='a'.repeat(64)
const contact:ConfirmedContact={
  version:1,peerAccountId:peerId,safetyFingerprint:fingerprint,
  alias:'PRIVATE MATRiX NAME',createdAt:1,updatedAt:1,
}
let session:Session
async function openDB(){
  const local=new Dexie('pb3-encrypted-messages-drafts-v1')
  local.version(1).stores({drafts:'&key,ownerScope'})
  const rows=await local.table('drafts').toArray()
  local.close()
  return rows as Array<Record<string,unknown>>
}
beforeEach(async()=>{
  const accountId=crypto.randomUUID()
  const {pkg}=await freshPackage(accountId)
  session={accountId,deviceId:crypto.randomUUID(),pkg,online:false} as Session
  activeSession.value=session
  peers.mockReset();peers.mockResolvedValue([contact])
})
afterEach(()=>{activeSession.value=null})

describe('P2-01 account-encrypted messages drafts without Matrix impersonation',()=>{
  it('seals draft text, peer identity and nickname in AES-GCM IndexedDB rows',async()=>{
    const secret='SECRET_PRIVATE_DRAFT_NEVER_SYNC'
    await saveMessageDraft(contact,secret)
    const displayed=await listMessageDrafts()
    expect(displayed).toHaveLength(1)
    expect(displayed[0]?.body).toBe(secret)
    expect(await getMessageDraft(contact)).toBe(secret)
    const rows=await openDB()
    expect(rows).toHaveLength(1)
    const persisted=JSON.stringify(rows)
    for(const forbidden of [
      secret,session.accountId,peerId,contact.alias,
      'peerAccountId','peerFingerprint','updatedAt','body',
    ])expect(persisted).not.toContain(forbidden)
    expect(rows[0]).toHaveProperty('iv')
    expect(rows[0]).toHaveProperty('ciphertext')
    expect(rows[0]).not.toHaveProperty('text')
  })

  it('serializes concurrent edits, empty draft deletion and preserves offline behavior',async()=>{
    await Promise.all([
      saveMessageDraft(contact,'first'),
      saveMessageDraft(contact,'second'),
      saveMessageDraft(contact,'third'),
    ])
    expect(await getMessageDraft(contact)).toBe('third')
    expect(activeSession.value?.online).toBe(false)
    await saveMessageDraft(contact,'')
    expect(await listMessageDrafts()).toHaveLength(0)
    expect(await getMessageDraft(contact)).toBe('')
  })

  it('never exposes owner A drafts to a different account or device-key rotation',async()=>{
    await saveMessageDraft(contact,'owner A only')
    const next=crypto.randomUUID(),{pkg}=await freshPackage(next)
    activeSession.value={
      accountId:next,deviceId:crypto.randomUUID(),pkg,online:false,
    } as Session
    expect(await listMessageDrafts()).toHaveLength(0)
    await saveMessageDraft(contact,'owner B only')
    expect((await listMessageDrafts())[0]?.body).toBe('owner B only')
    activeSession.value=session
    expect((await listMessageDrafts())[0]?.body).toBe('owner A only')
  })

  it('fails closed on a re-keyed or removed contact without deleting sealed data',async()=>{
    await saveMessageDraft(contact,'not for new key')
    peers.mockResolvedValue([{...contact,safetyFingerprint:'b'.repeat(64)}])
    expect(await listMessageDrafts()).toEqual([])
    await expect(saveMessageDraft(contact,'should fail'))
      .rejects.toThrow('messages.recipient_not_confirmed')
    expect(await openDB()).toHaveLength(1)
    peers.mockResolvedValue([])
    await expect(saveMessageDraft(contact,'removed'))
      .rejects.toThrow('messages.recipient_not_confirmed')
  })

  it('refuses oversized, malformed, unauthenticated or corrupted local drafts',async()=>{
    await expect(saveMessageDraft(contact,'z'.repeat(MAX_MESSAGE_DRAFT_LENGTH+1)))
      .rejects.toThrow('messages.invalid_draft_input')
    await expect(saveMessageDraft({...contact,safetyFingerprint:'invalid'},'x'))
      .rejects.toThrow('messages.invalid_draft_input')
    await saveMessageDraft(contact,'authentic draft')
    const rows=await openDB()
    const db=new Dexie('pb3-encrypted-messages-drafts-v1')
    db.version(1).stores({drafts:'&key,ownerScope'})
    await db.table('drafts').update(rows[0]!.key as string,{
      ciphertext:'tampered-base64',
    })
    db.close()
    await expect(listMessageDrafts()).rejects.toThrow(
      'messages.draft_decryption_failed')
  })

  it('does not commit the next queued change after a key-only session switch',async()=>{
    const changed={...contact,alias:'new alias'}
    await saveMessageDraft(contact,'one')
    const other=crypto.randomUUID(),{pkg}=await freshPackage(other)
    activeSession.value={accountId:other,deviceId:crypto.randomUUID(),
      pkg,online:false} as Session
    await expect(saveMessageDraft(changed,'different owner'))
      .rejects.toThrow('messages.recipient_not_confirmed')
  })
})
