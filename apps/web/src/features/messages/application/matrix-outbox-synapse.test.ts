/// <reference types="node" />
/**
 * P2-02E2: run the REAL PB3 encrypted Dexie outbox and the REAL official
 * Matrix SDK/RustCrypto against disposable Synapse.
 *
 * The PB3 identity service, peer-card verification and crypto Web Lock
 * are intentionally stubbed here; they have their own unit/endpoint gates.
 * This proves WIRE/RETRY/STORAGE, not full production device trust.
 *
 * This file is skipped by ordinary Vitest jobs. The disposable Matrix
 * workflow runs it with MATRIX_CI_DISPOSABLE=1 and loopback server only.
 * Never log a token, room secret, event contents or message body.
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {randomUUID} from 'node:crypto'
import {setTimeout as sleep} from 'node:timers/promises'
import {
  describe,it,beforeAll,afterAll,vi,
} from 'vitest'
import {
  createClient,ClientEvent,SyncState,MsgType,
  type MatrixClient,
} from 'matrix-js-sdk'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage} from '../../identity/infrastructure/crypto'
import {jsonApi} from '../../identity/infrastructure/api'
import {listConfirmedContacts} from '../../people/application/contact-book'
import {
  getLocalMatrixBindingForPending,getBoundMatrixCredentials,
} from './matrix-binding'
import {getMatrixContactMapping} from './matrix-peer-identity'
import {inspectVerifiedMatrixDevice} from './matrix-verified-device'
import {isLeasedMatrixClient} from './matrix-rust-adapter'
import {
  enqueueMatrixText,listMatrixTextOutbox,flushMatrixTextOutbox,
} from './matrix-text-outbox'

vi.mock('../../identity/infrastructure/api',()=>({jsonApi:vi.fn()}))
vi.mock('../../people/application/contact-book',
  ()=>({listConfirmedContacts:vi.fn()}))
vi.mock('./matrix-binding',()=>({
  getLocalMatrixBindingForPending:vi.fn(),
  getBoundMatrixCredentials:vi.fn(),
}))
vi.mock('./matrix-peer-identity',()=>({getMatrixContactMapping:vi.fn()}))
vi.mock('./matrix-verified-device',()=>({inspectVerifiedMatrixDevice:vi.fn()}))
vi.mock('./matrix-rust-adapter',()=>({isLeasedMatrixClient:vi.fn()}))

const enabled=process.env.MATRIX_CI_DISPOSABLE==='1'
const api=vi.mocked(jsonApi)
const contacts=vi.mocked(listConfirmedContacts)
const local=vi.mocked(getLocalMatrixBindingForPending)
const bound=vi.mocked(getBoundMatrixCredentials)
const peer=vi.mocked(getMatrixContactMapping)
const trust=vi.mocked(inspectVerifiedMatrixDevice)
const lease=vi.mocked(isLeasedMatrixClient)
const host='http://127.0.0.1:18008'
const accountId='11111111-1111-4111-8111-111111111111'
const pb3Device='33333333-3333-4333-8333-333333333333'
const peerId='22222222-2222-4222-8222-222222222222'
const fingerprint='a'.repeat(64)
const approvedEd='b'.repeat(43)
const contact={peerAccountId:peerId,safetyFingerprint:fingerprint}
const text='PB3_OUTBOX_WIRE_PROOF_'+randomUUID().replace(/-/g,'')
const clients:MatrixClient[]=[]
let alice!:MatrixClient
let bob!:MatrixClient
let aliceUser='',bobUser='',roomId=''
let session!:Session
let senderDevice='',peerDevice=''
let sentEvent=''

async function until(label:string,condition:()=>Promise<boolean>|boolean,
  seconds=60):Promise<void>{
  const end=Date.now()+seconds*1000
  while(Date.now()<end){
    try{if(await condition())return}catch{/* still syncing */}
    await sleep(220)
  }
  throw Error('pb3.matrix.outbox.integration_timeout_'+label)
}
async function loginWithBoundedRetry(identity:MatrixClient,
  name:string,password:string){
  for(let attempt=0;attempt<9;attempt++){
    try{
      return await identity.loginRequest({
        type:'m.login.password',
        identifier:{type:'m.id.user',user:name},
        password,initial_device_display_name:'PB3-CI-OUTBOX',
      })
    }catch(e){
      const err=e as {
        httpStatus?:number;errcode?:string
        data?:{retry_after_ms?:number}
      }
      // Previous gates legitimately use the SAME disposable Synapse login
      // rate-limit bucket. Obey 429; do not disable the server's controls.
      if(err.httpStatus!==429&&err.errcode!=='M_LIMIT_EXCEEDED')
        throw Error('pb3.matrix.ci.login_failed')
      if(attempt===8)throw Error('pb3.matrix.ci.login_rate_limit_exhausted')
      const ms=err.data?.retry_after_ms
      const delay=typeof ms==='number'&&Number.isFinite(ms)&&ms>=0
        ? Math.max(1800,Math.min(16000,ms+500))
        : Math.min(16000,4000+attempt*1500)
      await sleep(delay)
    }
  }
  throw Error('pb3.matrix.ci.login_rate_limit_exhausted')
}
async function register(name:string,password:string){
  const identity=createClient({baseUrl:host})
  const login=await loginWithBoundedRetry(identity,name,password)
  const client=createClient({
    baseUrl:host,userId:login.user_id,deviceId:login.device_id,
    accessToken:login.access_token,
  })
  clients.push(client)
  await client.initRustCrypto({useIndexedDB:false})
  if(!client.getCrypto())
    throw Error('pb3.matrix.outbox.no_rust_crypto')
  return {client,login}
}
async function sync(client:MatrixClient){
  let started=false
  client.on(ClientEvent.Sync,(state)=>{
    if(state===SyncState.Prepared||state===SyncState.Syncing)
      started=true
  })
  await client.startClient({initialSyncLimit:25})
  await until('sync_ready',()=>started)
}
async function crossSign(client:MatrixClient,name:string,password:string){
  const crypto=client.getCrypto()
  if(!crypto)throw Error('pb3.matrix.outbox.no_crypto')
  await crypto.bootstrapCrossSigning({
    authUploadDeviceSigningKeys:async makeRequest=>{
      await makeRequest({
        type:'m.login.password',
        identifier:{type:'m.id.user',user:name},
        password,
      })
    },
  })
  if(!await crypto.isCrossSigningReady())
    throw Error('pb3.matrix.outbox.cross_signing_not_ready')
}
async function rawRows(){
  const d=new Dexie('pb3-matrix-text-outbox-v1')
  d.version(1).stores({items:'&key,scope'})
  const rows=await d.table('items').toArray()
  d.close()
  return rows as Array<{scope:string;key:string;iv:string;ciphertext:string}>
}
function failUnless(value:unknown,reason:string):asserts value{
  if(!value)throw Error('pb3.matrix.outbox.'+reason)
}
function matchingRecipientEvents(eventId:string){
  return bob.getRoom(roomId)?.getLiveTimeline().getEvents()
    .filter(x=>x.getId()===eventId)??[]
}

describe.runIf(enabled)('P2-02E2 real PB3 encrypted outbox → Synapse → RustCrypto',()=>{
  beforeAll(async()=>{
    // NEVER run against an arbitrary URL or a non-disposable account.
    failUnless(process.env.MATRIX_CI_BASE_URL===host,
      'unexpected_matrix_server')
    failUnless(process.env.MATRIX_CI_SERVER_NAME==='localhost',
      'wrong_matrix_server_name')
    const nameA=process.env.MATRIX_CI_ALICE
    const nameB=process.env.MATRIX_CI_BOB
    const passA=process.env.MATRIX_CI_ALICE_PASSWORD
    const passB=process.env.MATRIX_CI_BOB_PASSWORD
    failUnless(nameA&&nameB&&passA&&passB
      &&nameA!==nameB&&passA!==passB,'missing_disposable_credentials')

    const d=new Dexie('pb3-matrix-text-outbox-v1')
    d.version(1).stores({items:'&key,scope'})
    await d.table('items').clear()
    d.close()

    // Do not burst two additional logins while the preceding E2EE/4S
    // protocol gates are still inside Synapse's login rate limit window.
    const identities=[
      await register(nameA,passA),await register(nameB,passB),
    ]
    alice=identities[0]!.client
    bob=identities[1]!.client
    aliceUser=identities[0]!.login.user_id
    bobUser=identities[1]!.login.user_id
    senderDevice=identities[0]!.login.device_id
    peerDevice=identities[1]!.login.device_id
    await Promise.all([sync(alice),sync(bob)])
    await Promise.all([
      crossSign(alice,nameA,passA),crossSign(bob,nameB,passB),
    ])
    const created=await alice.createRoom({
      preset:'private_chat' as Parameters<MatrixClient['createRoom']>[0]['preset'],
      visibility:'private' as Parameters<MatrixClient['createRoom']>[0]['visibility'],
      invite:[bobUser],
      initial_state:[{
        type:'m.room.encryption',state_key:'',
        content:{algorithm:'m.megolm.v1.aes-sha2'},
      }],
    })
    roomId=created.room_id
    await bob.joinRoom(roomId)
    await until('alice_member',()=>
      alice.getRoom(roomId)?.getMember(bobUser)?.membership==='join')
    await until('bob_encryption',()=>
      bob.getRoom(roomId)?.hasEncryptionStateEvent()===true)
    await until('bob_device_visible',async()=>{
      const result=await alice.getCrypto()?.getUserDeviceInfo([bobUser],true)
      return result?.get(bobUser)?.has(peerDevice)===true
    })

    session={
      accountId,deviceId:pb3Device,
      pkg:(await freshPackage(accountId)).pkg,
      online:true,
    } as Session
    activeSession.value=session
    const contract={
      version:1 as const,accountId,pb3DeviceId:pb3Device,
      homeserverUrl:host,matrixUserId:aliceUser,
      matrixDeviceId:senderDevice,operationId:randomUUID(),
    }
    const receipt={
      contract,accessToken:'not-used-by-the-escrow-test',
    }
    local.mockResolvedValue(contract)
    bound.mockResolvedValue(receipt)
    contacts.mockResolvedValue([{
      ...contact,alias:'PB3 disposable verified peer',
    }] as never)
    peer.mockResolvedValue({
      homeserverUrl:host,matrixUserId:bobUser,
      matrixDeviceId:peerDevice,
      verification:'pb3-account-signed-only',
    })
    api.mockImplementation(async path=>{
      if(path!=='/matrix/v1/me')
        throw Error('pb3.matrix.outbox.unexpected_pb3_request')
      return {
        bound:true,homeserverUrl:host,matrixUserId:aliceUser,
        deviceBinding:{contract:JSON.stringify(contract)},
      } as never
    })
    trust.mockResolvedValue({
      matrixUserId:bobUser,matrixDeviceId:peerDevice,
      matrixEd25519:approvedEd,crossSigningChecked:true,
      capability:'inspection-only-no-send',
    })
    lease.mockImplementation(candidate=>candidate===alice)
  },140000)
  afterAll(()=>{
    activeSession.value=null
    for(const client of clients){try{client.stopClient()}catch{}}
  })
  it('commits only ciphertext when offline; original Matrix txnId survives a simulated lost ACK and recipient decrypts exactly one event',async()=>{
    activeSession.value={...session,online:false}
    const txn=await enqueueMatrixText(contact,roomId,text,approvedEd)
    const sealed=await rawRows()
    failUnless(sealed.length===1,'queue_not_durable')
    const serialized=JSON.stringify(sealed)
    for(const forbidden of [
      text,roomId,aliceUser,bobUser,accountId,pb3Device,
      fingerprint,approvedEd,peerId,
    ])failUnless(!serialized.includes(forbidden),'local_plaintext_leak')
    const queued=await listMatrixTextOutbox()
    failUnless(queued.length===1&&queued[0]?.state==='queued'
      &&queued[0].operationId===txn,'queued_status_false')
    // Offline queue never reaches Matrix, regardless of SDK readiness.
    const offline=await flushMatrixTextOutbox(alice)
    failUnless(offline.accepted===0&&offline.pending===1,
      'offline_send_not_denied')
    activeSession.value=session

    // Force real server acceptance BUT lose the SDK return value. The exact
    // same PB3 txnId must be reused on explicit retry, never a new UUID.
    const original=alice.sendMessage.bind(alice) as (
      room:string,content:{msgtype:MsgType;body:string},txnId:string
    )=>Promise<{event_id:string}>
    const observed:string[]=[]
    const spy=vi.spyOn(alice,'sendMessage')
    spy.mockImplementationOnce(async(...args)=>{
      const [room,payload,transaction]=args as unknown as [
        string,{msgtype:MsgType;body:string},string,
      ]
      observed.push(transaction)
      const receipt=await original(room,payload,transaction)
      sentEvent=receipt.event_id
      throw Error('pb3.ci.synthetic_ack_loss')
    })
    let first=await flushMatrixTextOutbox(alice)
    failUnless(first.attempted===1&&first.accepted===0
      &&first.pending===1&&sentEvent,'lost_ack_not_preserved')

    // Restore original SDK method but still observe txnId used on retry.
    spy.mockRestore()
    const secondSpy=vi.spyOn(alice,'sendMessage')
    secondSpy.mockImplementationOnce(async(...args)=>{
      const [room,payload,transaction]=args as unknown as [
        string,{msgtype:MsgType;body:string},string,
      ]
      observed.push(transaction)
      return original(room,payload,transaction)
    })
    const retried=await flushMatrixTextOutbox(alice)
    secondSpy.mockRestore()
    failUnless(retried.attempted===1&&retried.accepted===1
      &&retried.pending===0,'outbox_lost_ack_replay_failed')
    failUnless(observed.length===2
      &&observed[0]===txn&&observed[1]===txn,
      'transaction_id_changed')
    const current=await listMatrixTextOutbox()
    failUnless(current.length===1
      &&current[0]?.state==='server_accepted'
      &&current[0].eventId===sentEvent,
      'server_receipt_mismatch')
    const raw=await alice.fetchRoomEvent(roomId,sentEvent)
    failUnless(raw.type==='m.room.encrypted'
      &&raw.content?.algorithm==='m.megolm.v1.aes-sha2'
      &&typeof raw.content?.ciphertext==='string'
      &&!JSON.stringify(raw).includes(text),
      'server_stored_plaintext')
    await until('bob_decrypted',()=>{
      const event=matchingRecipientEvents(sentEvent)[0]
      return event?.getType()==='m.room.message'
        &&event.getContent().body===text
    },90)
    failUnless(matchingRecipientEvents(sentEvent).length===1,
      'double_delivery_to_recipient')
    const noMore=await flushMatrixTextOutbox(alice)
    failUnless(noMore.attempted===0&&noMore.accepted===0,
      'accepted_message_replayed')
  },180000)
})
