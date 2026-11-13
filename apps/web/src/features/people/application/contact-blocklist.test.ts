import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { freshPackage, b64, random, digest, hex } from '../../identity/infrastructure/crypto'
import { activeSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import {
  listLocallyBlockedPeers, locallyBlockPeer, locallyUnblockPeer,
  excludeLocallyBlockedContacts,
} from './contact-blocklist'

const peerId='22222222-2222-4222-8222-222222222222'
const otherPeer='33333333-3333-4333-8333-333333333333'
let accountId=''
async function login(id:string):Promise<Session>{
  const {pkg}=await freshPackage(id)
  const s={accountId:id,deviceId:crypto.randomUUID(),pkg,online:false} as unknown as Session
  activeSession.value=s
  return s
}
async function rows(){
  const raw=new Dexie('pb3-encrypted-contact-blocklist-v1')
  raw.version(1).stores({blocks:'&key,ownerScope'})
  const values=await raw.table('blocks').toArray() as Array<{
    key:string;ownerScope:string;iv:string;ciphertext:string
  }>
  raw.close()
  return values
}
async function ownRaw(){
  const scope=hex(await digest(new TextEncoder().encode(
    'pb3.local-blocklist-index.v1\n'+accountId)))
  const raw=new Dexie('pb3-encrypted-contact-blocklist-v1')
  raw.version(1).stores({blocks:'&key,ownerScope'})
  return {raw,row:await raw.table('blocks').where('ownerScope').equals(scope).first() as
    {key:string;ownerScope:string;iv:string;ciphertext:string}|undefined}
}
beforeEach(()=>{accountId=crypto.randomUUID()})
afterEach(()=>{activeSession.value=null;vi.clearAllMocks()})

describe('P2 #210 encrypted Local-First blocked-contact selection',()=>{
  it('blocks offline without plaintext peer/owner IDs or AKEK in IndexedDB',async()=>{
    const s=await login(accountId)
    const stored=await locallyBlockPeer(peerId)
    expect(stored).toMatchObject({version:1,peerAccountId:peerId})
    expect((await listLocallyBlockedPeers()).map(x=>x.peerAccountId)).toEqual([peerId])
    const all=JSON.stringify(await rows())
    expect(all).not.toContain(peerId)
    expect(all).not.toContain(accountId)
    expect(all).not.toContain(s.pkg.akek)
    expect(all).not.toContain('blockedAt')
  })
  it('keeps blocks over offline reload and isolates account and AKEK',async()=>{
    const alice=await login(accountId)
    const first=await locallyBlockPeer(peerId)
    await locallyBlockPeer(peerId)
    expect((await listLocallyBlockedPeers())[0]?.blockedAt).toBe(first.blockedAt)
    const bob=await login(crypto.randomUUID())
    expect(await listLocallyBlockedPeers()).toEqual([])
    activeSession.value=alice
    expect(await listLocallyBlockedPeers()).toHaveLength(1)
    await login(accountId)
    await expect(listLocallyBlockedPeers()).rejects.toThrow('contacts.blocklist_unreadable')
    activeSession.value=alice
    await locallyUnblockPeer(peerId)
    expect(await listLocallyBlockedPeers()).toEqual([])
    activeSession.value=bob
    expect(await listLocallyBlockedPeers()).toEqual([])
  })
  it('supports several blocked peers and only removes explicitly selected block',async()=>{
    await login(accountId)
    await locallyBlockPeer(peerId)
    await locallyBlockPeer(otherPeer)
    expect((await listLocallyBlockedPeers()).map(x=>x.peerAccountId))
      .toEqual([peerId,otherPeer])
    await locallyUnblockPeer(peerId)
    expect((await listLocallyBlockedPeers()).map(x=>x.peerAccountId))
      .toEqual([otherPeer])
    await locallyUnblockPeer(peerId)
    expect(await listLocallyBlockedPeers()).toHaveLength(1)
  })
  it('rejects own ID, arbitrary peer strings and missing session',async()=>{
    await login(accountId)
    for(const bad of [accountId,'127.0.0.1','',peerId.toUpperCase(),' '+peerId]){
      await expect(locallyBlockPeer(bad)).rejects.toThrow('contacts.blocklist_invalid_peer')
      await expect(locallyUnblockPeer(bad)).rejects.toThrow('contacts.blocklist_invalid_peer')
    }
    activeSession.value=null
    await expect(listLocallyBlockedPeers()).rejects.toThrow()
    await expect(locallyBlockPeer(peerId)).rejects.toThrow()
  })
  it('rejects ciphertext mutation instead of silently treating blocked peer as allowed',async()=>{
    await login(accountId)
    await locallyBlockPeer(peerId)
    const {raw,row}=await ownRaw()
    expect(row).toBeDefined()
    if(!row)throw Error('missing test block')
    await raw.table('blocks').put({...row,iv:b64(random(12))})
    await expect(listLocallyBlockedPeers()).rejects.toThrow('contacts.blocklist_unreadable')
    await expect(locallyUnblockPeer(peerId)).rejects.toThrow('contacts.blocklist_unreadable')
    raw.close()
  })
  it('rejects row-key swapping instead of resolving the wrong peer as blocked',async()=>{
    await login(accountId)
    await locallyBlockPeer(peerId)
    await locallyBlockPeer(otherPeer)
    const {raw,row}=await ownRaw()
    if(!row)throw Error('missing test block')
    await raw.table('blocks').put({...row,key:'f'.repeat(64)})
    await expect(listLocallyBlockedPeers()).rejects.toThrow('contacts.blocklist_unreadable')
    raw.close()
  })
  it('filters local blocks out of both visible Contacts and Team invite choices',async()=>{
    await login(accountId)
    await locallyBlockPeer(peerId)
    const contacts=[
      {peerAccountId:peerId,alias:'Blocked'},
      {peerAccountId:otherPeer,alias:'Allowed'},
    ]
    const available=excludeLocallyBlockedContacts(contacts,await listLocallyBlockedPeers())
    expect(available).toEqual([{peerAccountId:otherPeer,alias:'Allowed'}])
    expect(contacts).toHaveLength(2)
    await locallyUnblockPeer(peerId)
    expect(excludeLocallyBlockedContacts(contacts,await listLocallyBlockedPeers()))
      .toEqual(contacts)
  })
  it('never touches server grant or invitation APIs when adding/removing local blocks',async()=>{
    await login(accountId)
    const fetchSpy=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{
      throw Error('forbidden network call')
    })
    await locallyBlockPeer(peerId)
    await locallyUnblockPeer(peerId)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
  it('never shows the previous account local blocks after identity switch',async()=>{
    const alice=await login(accountId)
    const prior=await locallyBlockPeer(peerId)
    expect(prior.peerAccountId).toBe(peerId)
    activeSession.value=await login(crypto.randomUUID())
    expect(await listLocallyBlockedPeers()).toEqual([])
    activeSession.value=alice
    expect(await listLocallyBlockedPeers()).toHaveLength(1)
  })
})
