import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {MsgType,SyncState,EventStatus,type MatrixClient} from 'matrix-js-sdk'
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
const api=vi.mocked(jsonApi)
const contacts=vi.mocked(listConfirmedContacts)
const local=vi.mocked(getLocalMatrixBindingForPending)
const active=vi.mocked(getBoundMatrixCredentials)
const trust=vi.mocked(inspectVerifiedMatrixDevice)
const lease=vi.mocked(isLeasedMatrixClient)
const mapped=vi.mocked(getMatrixContactMapping)
const mxOwn='@owner:matrix.example.test',mxPeer='@peer:matrix.example.test'
const roomId='!ROOM1:matrix.example.test'
const peerId='22222222-2222-4222-8222-222222222222'
const safety='a'.repeat(64)
const ed25519='Z'.repeat(43)
const plaintext='PB3-SECRET-MATRIX-OUTBOX-PAYLOAD'
let session:Session
let client:MatrixClient
let sent=vi.fn(),fetchEvent=vi.fn(),members=vi.fn()
let synced=vi.fn(),cryptoMode=vi.fn(),encrypted=vi.fn(),currentRoom=vi.fn()
let serverState=vi.fn(),existingEcho=vi.fn(),resend=vi.fn()
const target={peerAccountId:peerId,safetyFingerprint:safety}
const id='MAT_DEV_ONE',eventId='$PB3-EVENT1'
const getRoom=()=>({
  getMyMembership:()=> 'join',
  getEventForTxnId:existingEcho,
  currentState:{getStateEvents:()=>({getContent:()=>({
    algorithm:'m.megolm.v1.aes-sha2',
  })})},
  getJoinedMembers:()=>[
    {userId:mxOwn,membership:'join'},
    {userId:mxPeer,membership:'join'},
  ],
  getMembers:()=>[
    {userId:mxOwn,membership:'join'},
    {userId:mxPeer,membership:'join'},
  ],
})
async function raw(){
  const d=new Dexie('pb3-matrix-text-outbox-v1')
  d.version(1).stores({items:'&key,scope'})
  const rows=await d.table('items').toArray()
  d.close()
  return rows
}
async function setIdentity(accountId=crypto.randomUUID()):Promise<Session>{
  const {pkg}=await freshPackage(accountId)
  return {accountId,deviceId:crypto.randomUUID(),pkg,online:true} as Session
}
beforeEach(async()=>{
  const d=new Dexie('pb3-matrix-text-outbox-v1')
  d.version(1).stores({items:'&key,scope'})
  await d.table('items').clear();d.close()
  vi.clearAllMocks()
  session=await setIdentity()
  activeSession.value=session
  const contract={
    version:1 as const,accountId:session.accountId,pb3DeviceId:session.deviceId,
    homeserverUrl:'https://matrix.example.test',matrixUserId:mxOwn,
    matrixDeviceId:id,operationId:crypto.randomUUID(),
  }
  local.mockResolvedValue(contract)
  active.mockResolvedValue({contract,accessToken:'secret-matrix-token'})
  api.mockResolvedValue({
    bound:true,homeserverUrl:contract.homeserverUrl,
    matrixUserId:contract.matrixUserId,
    deviceBinding:{contract:JSON.stringify(contract)},
  } as never)
  mapped.mockResolvedValue({
    homeserverUrl:contract.homeserverUrl,
    matrixUserId:mxPeer,matrixDeviceId:'REMOTE_DEV_ONE',
    verification:'pb3-account-signed-only',
  })
  lease.mockReturnValue(true)
  trust.mockResolvedValue({
    matrixUserId:mxPeer,matrixDeviceId:'REMOTE_DEV_ONE',
    matrixEd25519:ed25519,crossSigningChecked:true,
    capability:'inspection-only-no-send',
  })
  contacts.mockResolvedValue([{...target,alias:'Peer'}] as never)
  existingEcho=vi.fn().mockReturnValue(undefined)
  resend=vi.fn().mockResolvedValue({event_id:eventId})
  sent=vi.fn().mockResolvedValue({event_id:eventId})
  fetchEvent=vi.fn().mockResolvedValue({
    event_id:eventId,room_id:roomId,sender:mxOwn,
    type:'m.room.encrypted',content:{
      algorithm:'m.megolm.v1.aes-sha2',
      ciphertext:'X'.repeat(70),
    },
  })
  members=vi.fn().mockResolvedValue({joined:{
    [mxOwn]:{},[mxPeer]:{},
  }})
  serverState=vi.fn().mockResolvedValue([
    {type:'m.room.encryption',state_key:'',
      content:{algorithm:'m.megolm.v1.aes-sha2'}},
    {type:'m.room.join_rules',state_key:'',content:{join_rule:'invite'}},
    {type:'m.room.member',state_key:mxOwn,content:{membership:'join'}},
    {type:'m.room.member',state_key:mxPeer,content:{membership:'join'}},
  ])
  synced=vi.fn().mockReturnValue(SyncState.Syncing)
  cryptoMode=vi.fn()
  encrypted=vi.fn().mockResolvedValue(true)
  currentRoom=vi.fn().mockImplementation(getRoom)
  client={
    baseUrl:contract.homeserverUrl,
    getUserId:()=>mxOwn,getDeviceId:()=>id,
    getSyncState:synced,
    getCrypto:()=>({
      isEncryptionEnabledInRoom:encrypted,
      setDeviceIsolationMode:cryptoMode,
    }),
    getRoom:currentRoom,
    getJoinedRoomMembers:members,
    roomState:serverState,
    sendMessage:sent,
    resendEvent:resend,
    fetchRoomEvent:fetchEvent,
  } as unknown as MatrixClient
})
afterEach(()=>{activeSession.value=null})

describe('P2-02E durable Matrix text E2EE outbox',()=>{
  it('queues plaintext ONLY inside account/device-scoped AES-GCM; not as metadata or fake sent status',async()=>{
    const op=await enqueueMatrixText(target,roomId,plaintext,ed25519)
    expect(op).toMatch(/^[a-f0-9-]{36}$/)
    expect(sent).not.toHaveBeenCalled()
    expect(await listMatrixTextOutbox()).toEqual([{
      operationId:op,state:'queued',roomId,body:plaintext,eventId:null,
    }])
    const rows=await raw()
    expect(rows).toHaveLength(1)
    const wire=JSON.stringify(rows)
    for(const secret of [plaintext,roomId,mxPeer,mxOwn,peerId,safety,
      ed25519,session.accountId,session.deviceId,session.pkg.akek])
      expect(wire).not.toContain(secret)
    const second=await setIdentity()
    activeSession.value=second
    expect(await listMatrixTextOutbox()).toEqual([])
    activeSession.value=session
    expect(await listMatrixTextOutbox()).toHaveLength(1)
  })
  it('guards E2EE room, live membership and Matrix cross-signing; verifies remote ciphertext and stores only ACK',async()=>{
    const op=await enqueueMatrixText(target,roomId,plaintext,ed25519)
    await expect(flushMatrixTextOutbox(client)).resolves.toEqual({
      attempted:1,accepted:1,pending:0,
    })
    expect(sent).toHaveBeenCalledTimes(1)
    expect(sent).toHaveBeenCalledWith(roomId,{
      msgtype:MsgType.Text,body:plaintext,
    },op)
    expect(cryptoMode).toHaveBeenCalledTimes(1)
    expect(trust).toHaveBeenCalledWith(peerId,ed25519,
      expect.objectContaining({isEncryptionEnabledInRoom:encrypted}))
    expect(fetchEvent).toHaveBeenCalledWith(roomId,eventId)
    expect(await listMatrixTextOutbox()).toEqual([{
      operationId:op,state:'server_accepted',roomId,body:plaintext,
      eventId,
    }])
    expect(await flushMatrixTextOutbox(client)).toEqual({
      attempted:0,accepted:0,pending:0,
    })
    expect(sent).toHaveBeenCalledTimes(1)
  })
  it('reconciles SDK SENT local echo without duplicating SDK send for same txnId',async()=>{
    const op=await enqueueMatrixText(target,roomId,plaintext,ed25519)
    existingEcho.mockReturnValue({
      getTxnId:()=>op,getRoomId:()=>roomId,getSender:()=>mxOwn,
      getId:()=>eventId,status:EventStatus.SENT,
    })
    expect(await flushMatrixTextOutbox(client)).toEqual({
      attempted:1,accepted:1,pending:0,
    })
    expect(existingEcho).toHaveBeenCalledWith(op)
    expect(sent).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
    expect(fetchEvent).toHaveBeenCalledWith(roomId,eventId)
    expect((await listMatrixTextOutbox())[0]?.eventId).toBe(eventId)
  })
  it('resends a NOT_SENT SDK echo with the exact saved txnId through official resendEvent',async()=>{
    const op=await enqueueMatrixText(target,roomId,plaintext,ed25519)
    const echo={
      getTxnId:()=>op,getRoomId:()=>roomId,getSender:()=>mxOwn,
      getId:()=> '~'+roomId+':'+op,status:EventStatus.NOT_SENT,
    }
    existingEcho.mockReturnValue(echo)
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(1)
    expect(resend).toHaveBeenCalledWith(echo,expect.any(Object))
    expect(sent).not.toHaveBeenCalled()
    expect((await listMatrixTextOutbox())[0]?.state).toBe('server_accepted')
  })
  it('refuses an in-flight or foreign SDK echo without creating a second message',async()=>{
    const op=await enqueueMatrixText(target,roomId,plaintext,ed25519)
    const echo={
      getTxnId:()=>op,getRoomId:()=>roomId,getSender:()=>mxOwn,
      getId:()=> '~'+roomId+':'+op,status:EventStatus.SENDING,
    }
    existingEcho.mockReturnValue(echo)
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(0)
    expect((await listMatrixTextOutbox())[0]?.state).toBe('queued')
    echo.status=EventStatus.SENT
    existingEcho.mockReturnValue({...echo,getSender:()=>mxPeer,getId:()=>eventId})
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(0)
    expect(sent).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
    expect(fetchEvent).not.toHaveBeenCalled()
  })
  it('replays EXACT original txnId after network lost-ACK without losing local ciphertext',async()=>{
    const op=await enqueueMatrixText(target,roomId,plaintext,ed25519)
    let attempts=0
    sent.mockImplementation(async()=>{
      attempts++
      if(attempts===1)throw Error('network.ack_lost')
      return {event_id:eventId}
    })
    expect(await flushMatrixTextOutbox(client)).toEqual({
      attempted:1,accepted:0,pending:1,
    })
    expect((await listMatrixTextOutbox())[0]).toMatchObject({
      operationId:op,state:'queued',eventId:null,
    })
    const persistent=await raw()
    expect(persistent).toHaveLength(1)
    // Simulated reload: a distinct Dexie client still finds the durable row.
    expect(persistent[0].ciphertext).not.toContain(plaintext)
    expect(await flushMatrixTextOutbox(client)).toEqual({
      attempted:1,accepted:1,pending:0,
    })
    expect(sent.mock.calls.map(c=>c[2])).toEqual([op,op])
  })
  it('refuses plaintext event or wrong server ACK; keeps encrypted pending intent',async()=>{
    await enqueueMatrixText(target,roomId,plaintext,ed25519)
    fetchEvent.mockResolvedValue({
      event_id:eventId,room_id:roomId,sender:mxOwn,
      type:'m.room.message',content:{msgtype:'m.text',body:plaintext},
    })
    expect(await flushMatrixTextOutbox(client)).toMatchObject({
      attempted:1,accepted:0,pending:1,
    })
    expect((await listMatrixTextOutbox())[0]?.state).toBe('queued')
    fetchEvent.mockResolvedValue({
      event_id:eventId,room_id:roomId,sender:mxOwn,
      type:'m.room.encrypted',content:{
        algorithm:'m.megolm.v1.aes-sha2',ciphertext:'Z'.repeat(70),
      },
    })
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(1)
  })
  it('blocks fake encryption and expanded room membership before any network send',async()=>{
    await enqueueMatrixText(target,roomId,plaintext,ed25519)
    encrypted.mockResolvedValue(false)
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(0)
    expect(sent).not.toHaveBeenCalled()
    encrypted.mockResolvedValue(true)
    members.mockResolvedValue({joined:{
      [mxOwn]:{},[mxPeer]:{},'@mallory:matrix.example.test':{},
    }})
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(0)
    expect(sent).not.toHaveBeenCalled()
  })
  it('never sends through an unleased or replaced RustCrypto SDK client',async()=>{
    await enqueueMatrixText(target,roomId,plaintext,ed25519)
    lease.mockReturnValue(false)
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(0)
    expect(sent).not.toHaveBeenCalled()
    lease.mockReturnValue(true)
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(1)
    expect(lease).toHaveBeenCalled()
  })
  it('refuses a revoked authoritative PB3 Matrix binding even if local token still exists',async()=>{
    await enqueueMatrixText(target,roomId,plaintext,ed25519)
    api.mockResolvedValue({
      bound:false,homeserverUrl:'https://matrix.example.test',
      matrixUserId:mxOwn,deviceBinding:null,
    } as never)
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(0)
    expect(api).toHaveBeenCalledWith('/matrix/v1/me')
    expect(sent).not.toHaveBeenCalled()
    expect((await listMatrixTextOutbox())[0]?.state).toBe('queued')
  })
  it('refuses pending invited third user or open join policy from authoritative Matrix state',async()=>{
    await enqueueMatrixText(target,roomId,plaintext,ed25519)
    serverState.mockResolvedValue([
      {type:'m.room.encryption',state_key:'',
        content:{algorithm:'m.megolm.v1.aes-sha2'}},
      {type:'m.room.member',state_key:mxOwn,content:{membership:'join'}},
      {type:'m.room.member',state_key:mxPeer,content:{membership:'join'}},
      {type:'m.room.member',state_key:'@mallory:matrix.example.test',
        content:{membership:'invite'}},
    ])
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(0)
    expect(sent).not.toHaveBeenCalled()
    serverState.mockResolvedValue([
      {type:'m.room.encryption',state_key:'',
        content:{algorithm:'m.megolm.v1.aes-sha2'}},
      {type:'m.room.member',state_key:mxOwn,content:{membership:'join'}},
      {type:'m.room.member',state_key:mxPeer,content:{membership:'join'}},
      {type:'m.room.join_rules',state_key:'',content:{join_rule:'public'}},
    ])
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(0)
    expect(sent).not.toHaveBeenCalled()
  })
  it('rejects unsigned/new recipient devices or changed contact key before send',async()=>{
    await enqueueMatrixText(target,roomId,plaintext,ed25519)
    trust.mockRejectedValue(Error('matrix.trust_unverified_device'))
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(0)
    expect(sent).not.toHaveBeenCalled()
    trust.mockResolvedValue({
      matrixUserId:mxPeer,matrixDeviceId:'REMOTE_DEV_ONE',
      matrixEd25519:ed25519,crossSigningChecked:true,
      capability:'inspection-only-no-send',
    })
    contacts.mockResolvedValue([])
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(0)
    expect(sent).not.toHaveBeenCalled()
  })
  it('queues offline but never sends offline or without Matrix device/token',async()=>{
    session={...session,online:false}
    activeSession.value=session
    const id=await enqueueMatrixText(target,roomId,plaintext,ed25519)
    expect(id).toMatch(/^[a-f0-9-]{36}$/)
    expect(await flushMatrixTextOutbox(client)).toEqual({
      attempted:0,accepted:0,pending:1,
    })
    expect(sent).not.toHaveBeenCalled()
    session={...session,online:true}
    activeSession.value=session
    active.mockResolvedValue(null)
    expect((await flushMatrixTextOutbox(client)).accepted).toBe(0)
    expect(sent).not.toHaveBeenCalled()
  })
  it('never queues for nonexistent PB3 contact or incorrect Matrix identity',async()=>{
    contacts.mockResolvedValue([])
    await expect(enqueueMatrixText(target,roomId,plaintext,ed25519))
      .rejects.toThrow('matrix.outbox_contact_changed')
    contacts.mockResolvedValue([{...target}] as never)
    mapped.mockResolvedValue(null)
    await expect(enqueueMatrixText(target,roomId,plaintext,ed25519))
      .rejects.toThrow('matrix.outbox_binding_required')
    expect(await raw()).toHaveLength(0)
  })
  it('corrupted persisted ciphertext is never sent or silently dropped',async()=>{
    await enqueueMatrixText(target,roomId,plaintext,ed25519)
    const d=new Dexie('pb3-matrix-text-outbox-v1')
    d.version(1).stores({items:'&key,scope'})
    const rows=await d.table('items').toArray()
    await d.table('items').put({...rows[0],ciphertext:'corrupted'})
    d.close()
    await expect(listMatrixTextOutbox())
      .rejects.toThrow('matrix.outbox_corrupt_ciphertext')
    await expect(flushMatrixTextOutbox(client))
      .rejects.toThrow('matrix.outbox_corrupt_ciphertext')
    expect(sent).not.toHaveBeenCalled()
  })
})
