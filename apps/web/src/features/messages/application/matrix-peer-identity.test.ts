import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {
  b64,unb64,exportSpki,freshPackage,importSigner,newSigning,sign,
} from '../../identity/infrastructure/crypto'
import {jsonApi} from '../../identity/infrastructure/api'
import {listConfirmedContacts} from '../../people/application/contact-book'
import {pinnedPeer} from '../../sharing/key-directory'
import {getBoundMatrixCredentials} from './matrix-binding'
import {
  exportOwnMatrixIdentityCard,acceptMatrixIdentityCard,
  getMatrixContactMapping,forgetMatrixContactMapping,
} from './matrix-peer-identity'

vi.mock('../../identity/infrastructure/api',()=>({jsonApi:vi.fn()}))
vi.mock('../../people/application/contact-book',
  ()=>({listConfirmedContacts:vi.fn()}))
vi.mock('../../sharing/key-directory',()=>({pinnedPeer:vi.fn()}))
vi.mock('./matrix-binding',()=>({getBoundMatrixCredentials:vi.fn()}))
const api=vi.mocked(jsonApi)
const contacts=vi.mocked(listConfirmedContacts)
const peer=vi.mocked(pinnedPeer)
const creds=vi.mocked(getBoundMatrixCredentials)
const home='https://matrix.example.test'
const mxid='@alice:matrix.example.test'
const fp='a'.repeat(64)
let alice:Session,bob:Session
let rawBinding:string
let accountSignature:string,deviceSignature:string

async function user():Promise<Session>{
  const id=crypto.randomUUID()
  const pkg=(await freshPackage(id)).pkg
  const device=await newSigning(false)
  return {accountId:id,deviceId:crypto.randomUUID(),pkg,online:true,
    device:{deviceKey:device.privateKey,
      deviceSpki:await exportSpki(device.publicKey)},
  } as unknown as Session
}
async function encryptedRows(){
  const d=new Dexie('pb3-encrypted-matrix-peer-pins-v1')
  d.version(1).stores({peers:'&key,scope'})
  const rows=await d.table('peers').toArray()
  d.close()
  return rows
}
function switchTo(s:Session):void{activeSession.value=s}
function fakeDirectory(){
  peer.mockImplementation(async id=>{
    const isAlice=id===alice.accountId
    return {
      accountId:id,
      accountSpki:isAlice?alice.pkg.accountSpki:bob.pkg.accountSpki,
      safetyFingerprint:fp,
    } as Awaited<ReturnType<typeof pinnedPeer>>
  })
}
beforeEach(async()=>{
  const d=new Dexie('pb3-encrypted-matrix-peer-pins-v1')
  d.version(1).stores({peers:'&key,scope'})
  await d.table('peers').clear();d.close()
  alice=await user();bob=await user()
  const binding={
    version:1 as const,operationId:crypto.randomUUID(),
    accountId:alice.accountId,pb3DeviceId:alice.deviceId,
    homeserverUrl:home,matrixUserId:mxid,matrixDeviceId:'MATRIX_DEVICE_A',
  }
  rawBinding=JSON.stringify(binding)
  const message='pb3.matrix-binding.v1\n'+rawBinding
  accountSignature=await sign(
    await importSigner(alice.pkg.accountPkcs8),message)
  deviceSignature=await sign(alice.device.deviceKey,message)
  switchTo(alice)
  vi.clearAllMocks()
  fakeDirectory()
  contacts.mockImplementation(async()=>activeSession.value?.accountId===bob.accountId?[
    {version:1,peerAccountId:alice.accountId,
      safetyFingerprint:fp,alias:'Alice',
      createdAt:1,updatedAt:1},
  ]:[])
  creds.mockImplementation(async()=>activeSession.value?.accountId===alice.accountId
    ?{contract:binding,accessToken:'opaque-not-in-card'}
    :null)
  api.mockImplementation(async path=>{
    if(path!=='/matrix/v1/me')throw Error('unexpected network')
    if(activeSession.value?.accountId===alice.accountId)
      return {configured:true,bound:true,homeserverUrl:home,
        matrixUserId:mxid,deviceBinding:{
          contract:rawBinding,accountSignature,deviceSignature,
        }} as never
    return {configured:true,bound:false,homeserverUrl:home,
      matrixUserId:null,deviceBinding:null} as never
  })
})
afterEach(()=>{activeSession.value=null})

describe('P2-02D2 PB3-root-signed Matrix contact mapping',()=>{
  it('signs both PB3 identities, requires explicit peer safety number and MXID consent, stores only ciphertext',async()=>{
    const card=await exportOwnMatrixIdentityCard()
    expect(card).toMatch(/^PB3MX1\.[A-Za-z0-9_-]+$/)
    expect(card).not.toContain('opaque-not-in-card')
    switchTo(bob)
    await acceptMatrixIdentityCard(card,alice.accountId,fp,mxid)
    expect(await getMatrixContactMapping(alice.accountId)).toEqual({
      matrixUserId:mxid,matrixDeviceId:'MATRIX_DEVICE_A',
      homeserverUrl:home,verification:'pb3-account-signed-only',
    })
    const rows=await encryptedRows()
    expect(rows).toHaveLength(1)
    const raw=JSON.stringify(rows)
    for(const secret of [alice.accountId,bob.accountId,mxid,'MATRIX_DEVICE_A',
      fp,bob.pkg.akek,'opaque-not-in-card'])
      expect(raw).not.toContain(secret)
    await acceptMatrixIdentityCard(card,alice.accountId,fp,mxid)
    expect(await encryptedRows()).toHaveLength(1)
  })
  it('rejects changed MXID or safety fingerprint, even with valid issuer signature',async()=>{
    switchTo(alice)
    const card=await exportOwnMatrixIdentityCard()
    switchTo(bob)
    await expect(acceptMatrixIdentityCard(
      card,alice.accountId,fp,'@mallory:matrix.example.test'))
      .rejects.toThrow('matrix.contact_mxid_not_confirmed')
    await expect(acceptMatrixIdentityCard(
      card,alice.accountId,'b'.repeat(64),mxid))
      .rejects.toThrow('matrix.contact_fingerprint_changed')
    expect(await encryptedRows()).toHaveLength(0)
  })
  it('rejects a modified binding, tampered root signature or forged device signature',async()=>{
    switchTo(alice)
    const original=await exportOwnMatrixIdentityCard()
    const decoded=JSON.parse(new TextDecoder().decode(
      unb64(original.slice('PB3MX1.'.length)))) as {
        version:1;card:string;signature:string
      }
    const changed=JSON.parse(decoded.card) as Record<string,unknown>
    const claimed=JSON.parse(changed.bindingContract as string)
    claimed.matrixUserId='@attacker:matrix.example.test'
    changed.bindingContract=JSON.stringify(claimed)
    const forged='PB3MX1.'+b64(new TextEncoder().encode(JSON.stringify({
      ...decoded,card:JSON.stringify(changed),
    })))
    switchTo(bob)
    await expect(acceptMatrixIdentityCard(forged,alice.accountId,fp,mxid))
      .rejects.toThrow('matrix.contact_invalid_signature')
    switchTo(alice)
    deviceSignature=b64(new Uint8Array(64))
    await expect(exportOwnMatrixIdentityCard())
      .rejects.toThrow('matrix.contact_invalid_signature')
  })
  it('fails closed on foreign configured homeserver and absent confirmed contact',async()=>{
    switchTo(alice)
    const card=await exportOwnMatrixIdentityCard()
    switchTo(bob)
    api.mockResolvedValue({configured:true,homeserverUrl:'https://other.example.test'} as never)
    await expect(acceptMatrixIdentityCard(card,alice.accountId,fp,mxid))
      .rejects.toThrow('matrix.contact_foreign_homeserver')
    contacts.mockResolvedValue([])
    await expect(acceptMatrixIdentityCard(card,alice.accountId,fp,mxid))
      .rejects.toThrow('matrix.contact_not_confirmed')
  })
  it('rejects stale pin and card replacement; offline local display is not Matrix device trust',async()=>{
    switchTo(alice)
    const original=await exportOwnMatrixIdentityCard()
    const second=await exportOwnMatrixIdentityCard()
    switchTo(bob)
    await acceptMatrixIdentityCard(original,alice.accountId,fp,mxid)
    await expect(acceptMatrixIdentityCard(second,alice.accountId,fp,mxid))
      .rejects.toThrow('matrix.contact_mapping_changed')
    switchTo({...bob,online:false})
    expect((await getMatrixContactMapping(alice.accountId))?.verification)
      .toBe('pb3-account-signed-only')
    await expect(acceptMatrixIdentityCard(original,alice.accountId,fp,mxid))
      .rejects.toThrow('matrix.contact_online_verification_required')
    peer.mockImplementation(async id=>({
      accountId:id,accountSpki:alice.pkg.accountSpki,
      safetyFingerprint:'f'.repeat(64),
    } as Awaited<ReturnType<typeof pinnedPeer>>))
    await expect(getMatrixContactMapping(alice.accountId))
      .rejects.toThrow('matrix.contact_fingerprint_changed')
  })
  it('isolates another PB3 account, detects ciphertext corruption and local forget',async()=>{
    switchTo(alice)
    const original=await exportOwnMatrixIdentityCard()
    switchTo(bob)
    await acceptMatrixIdentityCard(original,alice.accountId,fp,mxid)
    const foreign=await user()
    switchTo(foreign)
    expect(await getMatrixContactMapping(alice.accountId)).toBeNull()
    switchTo(bob)
    await forgetMatrixContactMapping(alice.accountId)
    expect(await getMatrixContactMapping(alice.accountId)).toBeNull()
    await acceptMatrixIdentityCard(original,alice.accountId,fp,mxid)
    const d=new Dexie('pb3-encrypted-matrix-peer-pins-v1')
    d.version(1).stores({peers:'&key,scope'})
    const [row]=await d.table('peers').toArray()
    await d.table('peers').put({...row,ciphertext:'bad-authentication-tag'})
    d.close()
    await expect(getMatrixContactMapping(alice.accountId))
      .rejects.toThrow('matrix.contact_ciphertext_corrupt')
  })
})
