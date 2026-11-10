import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { freshPackage, b64, random } from '../../identity/infrastructure/crypto'
import { activeSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import { pinnedPeer } from '../../sharing/key-directory'
import {
  listConfirmedContacts, saveConfirmedContact, removeConfirmedContact,
} from './contact-book'

vi.mock('../../sharing/key-directory',()=>({pinnedPeer:vi.fn()}))
const peerId='22222222-2222-4222-8222-222222222222'
const ownerId='11111111-1111-4111-8111-111111111111'
const outsiderId='33333333-3333-4333-8333-333333333333'
const fingerprint='a'.repeat(64)
const trusted=vi.mocked(pinnedPeer)
async function account(id:string){
  const {pkg}=await freshPackage(id)
  const session={
    accountId:id,deviceId:'99999999-9999-4999-8999-999999999999',
    pkg,online:false,
  } as unknown as Session
  activeSession.value=session
  return session
}
function restore(s:Session):void{activeSession.value=s}
async function rawRows(){
  const raw=new Dexie('pb3-encrypted-contacts-v1')
  raw.version(1).stores({contacts:'&key,ownerScope'})
  const rows=await raw.table('contacts').toArray()
  raw.close()
  return rows as Array<{key:string;ownerScope:string;iv:string;ciphertext:string}>
}
beforeEach(()=>{
  trusted.mockImplementation(async id=>({
    accountId:id,safetyFingerprint:fingerprint,
  } as Awaited<ReturnType<typeof pinnedPeer>>))
})
afterEach(()=>{activeSession.value=null;vi.clearAllMocks()})

describe('P1-25 encrypted fingerprint-confirmed contact book',()=>{
  it('stores no cleartext contact IDs, aliases, fingerprints or AKEK in IndexedDB',async()=>{
    await account(ownerId)
    await expect(saveConfirmedContact(peerId,fingerprint,'Private Alias'))
      .resolves.toMatchObject({peerAccountId:peerId,alias:'Private Alias'})
    const contacts=await listConfirmedContacts()
    expect(contacts).toHaveLength(1)
    expect(contacts[0]).toMatchObject({version:1,peerAccountId:peerId,
      alias:'Private Alias',safetyFingerprint:fingerprint})
    const rows=await rawRows()
    expect(rows).toHaveLength(1)
    const json=JSON.stringify(rows)
    expect(json).not.toContain(ownerId)
    expect(json).not.toContain(peerId)
    expect(json).not.toContain('Private Alias')
    expect(json).not.toContain(fingerprint)
    expect(rows[0]!.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(rows[0]!.iv).toMatch(/^[A-Za-z0-9_-]+$/)
  })
  it('remains local-first after offline reload, isolated by account and key',async()=>{
    const alice=await account(ownerId)
    await saveConfirmedContact(peerId,fingerprint,'Source 1')
    const bob=await account(outsiderId)
    expect(await listConfirmedContacts()).toEqual([])
    restore(alice)
    expect((await listConfirmedContacts())[0]?.alias).toBe('Source 1')
    await account(ownerId)
    await expect(listConfirmedContacts())
      .rejects.toThrow('contacts.encrypted_record_unreadable')
    restore(alice)
    await saveConfirmedContact(peerId,fingerprint,'Source renamed')
    const renamed=await listConfirmedContacts()
    expect(renamed).toHaveLength(1)
    expect(renamed[0]?.alias).toBe('Source renamed')
    await removeConfirmedContact(peerId)
    expect(await listConfirmedContacts()).toEqual([])
    restore(bob)
    expect(await listConfirmedContacts()).toEqual([])
  })
  it('rejects unconfirmed or rotated peer identity and invalid aliases',async()=>{
    await account(ownerId)
    trusted.mockRejectedValueOnce(Error('share.peer_not_confirmed'))
    await expect(saveConfirmedContact(peerId,fingerprint,'Do not add'))
      .rejects.toThrow('share.peer_not_confirmed')
    expect(await listConfirmedContacts()).toEqual([])
    trusted.mockImplementation(async id=>({
      accountId:id,safetyFingerprint:'b'.repeat(64),
    } as Awaited<ReturnType<typeof pinnedPeer>>))
    await expect(saveConfirmedContact(peerId,fingerprint,'Do not add'))
      .rejects.toThrow('contacts.trusted_key_changed')
    trusted.mockImplementation(async id=>({
      accountId:id,safetyFingerprint:fingerprint,
    } as Awaited<ReturnType<typeof pinnedPeer>>))
    await expect(saveConfirmedContact(ownerId,fingerprint,'self'))
      .rejects.toThrow('contacts.invalid_input')
    await expect(saveConfirmedContact(peerId,fingerprint,'x'.repeat(65)))
      .rejects.toThrow('contacts.invalid_input')
    await saveConfirmedContact(peerId,fingerprint,'Kept')
    trusted.mockImplementation(async id=>({
      accountId:id,safetyFingerprint:'c'.repeat(64),
    } as Awaited<ReturnType<typeof pinnedPeer>>))
    await expect(listConfirmedContacts()).rejects.toThrow('contacts.trusted_key_changed')
    await expect(saveConfirmedContact(peerId,'c'.repeat(64),'overwrite'))
      .rejects.toThrow('contacts.trusted_key_changed')
  })
  it('refuses tampering, cross-record swapping and ciphertext corruption',async()=>{
    await account(ownerId)
    await saveConfirmedContact(peerId,fingerprint,'Sensitive')
    const raw=new Dexie('pb3-encrypted-contacts-v1')
    raw.version(1).stores({contacts:'&key,ownerScope'})
    const [original]=await raw.table('contacts').toArray() as Array<{
      key:string;ownerScope:string;iv:string;ciphertext:string
    }>
    const row=original!
    await raw.table('contacts').put({...row,iv:b64(random(12))})
    await expect(listConfirmedContacts())
      .rejects.toThrow('contacts.encrypted_record_unreadable')
    await raw.table('contacts').put({...row,key:'f'.repeat(64)})
    await expect(listConfirmedContacts())
      .rejects.toThrow('contacts.encrypted_record_unreadable')
    await raw.table('contacts').delete('f'.repeat(64))
    await raw.table('contacts').put(row)
    expect((await listConfirmedContacts())[0]?.alias).toBe('Sensitive')
    raw.close()
  })
})
