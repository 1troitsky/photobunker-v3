/**
 * P2-02D3 disposable Matrix v44 RustCrypto secret-storage/key-backup gate.
 *
 * This is a protocol proof, NOT PB3 production provisioning, verification,
 * or PB3 Recovery Key transport. All credentials/accounts are ephemeral.
 * Never print passwords, access tokens, secret-storage seeds, room keys,
 * room IDs, message bodies, or unredacted exception object dumps.
 */
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {setTimeout as sleep} from 'node:timers/promises'
import {createClient,ClientEvent,SyncState,MsgType} from 'matrix-js-sdk'

assert.equal(process.env.MATRIX_CI_DISPOSABLE,'1')
const origin=process.env.MATRIX_CI_BASE_URL
assert.equal(origin,'http://127.0.0.1:18008')
assert.equal(process.env.MATRIX_CI_SERVER_NAME,'localhost')
const aliceName=process.env.MATRIX_CI_ALICE
const bobName=process.env.MATRIX_CI_BOB
const alicePassword=process.env.MATRIX_CI_ALICE_PASSWORD
const bobPassword=process.env.MATRIX_CI_BOB_PASSWORD
for(const value of [aliceName,bobName,alicePassword,bobPassword])
  assert.ok(typeof value==='string' &&value.length>=8)
assert.notEqual(aliceName,bobName)
assert.notEqual(alicePassword,bobPassword)

const clients=[]
async function until(label,condition,seconds=60){
  const end=Date.now()+seconds*1000
  while(Date.now()<end){
    try{const val=await condition();if(val)return val}catch{}
    await sleep(200)
  }
  throw Error('PB3 Matrix 4S integration timeout: '+label)
}
async function createDevice(username,password,preloadedKeys=new Map()){
  // Keyring lives only in the disposable Node process. Production uses
  // PB3 AKEK-sealed escrow after PB3 Recovery Key login instead.
  const keys=new Map(preloadedKeys)
  const identity=createClient({baseUrl:origin})
  const login=await identity.loginRequest({
    type:'m.login.password',
    identifier:{type:'m.id.user',user:username},
    password,initial_device_display_name:'PB3-CI-4S-EPHEMERAL',
  })
  const client=createClient({
    baseUrl:origin,userId:login.user_id,deviceId:login.device_id,
    accessToken:login.access_token,
    cryptoCallbacks:{
      getSecretStorageKey:async({keys:offered})=>{
        for(const keyId of Object.keys(offered)){
          const key=keys.get(keyId)
          if(key)return [keyId,new Uint8Array(key)]
        }
        return null
      },
      cacheSecretStorageKey:(keyId,_info,secret)=>{
        keys.set(keyId,new Uint8Array(secret))
      },
    },
  })
  clients.push(client)
  await client.initRustCrypto({useIndexedDB:false})
  assert.ok(client.getCrypto(),'Rust Crypto was not initialized')
  return {client,token:login.access_token,deviceId:login.device_id,
    userId:login.user_id,keys}
}
async function ready(client){
  let started=false
  client.on(ClientEvent.Sync,state=>{
    if(state===SyncState.Prepared||state===SyncState.Syncing)
      started=true
  })
  await client.startClient({initialSyncLimit:35})
  await until('initial Matrix sync',()=>started,60)
}
async function accountPasswordAuth(username,password){
  return async makeRequest=>{
    await makeRequest({
      type:'m.login.password',
      identifier:{type:'m.id.user',user:username},
      password,
    })
  }
}
async function api(token,path){
  const response=await fetch(origin+path,{
    headers:{Authorization:'Bearer '+token,Accept:'application/json'},
    signal:AbortSignal.timeout(8000),
  })
  if(!response.ok) return null
  return response.json()
}
function countBackupSessions(payload){
  if(!payload||typeof payload!=='object')return 0
  return Object.values(payload.rooms??{}).reduce(
    (total,room)=>total+Object.keys(room?.sessions??{}).length,0)
}
try{
  const [alice,bob]=await Promise.all([
    createDevice(aliceName,alicePassword),
    createDevice(bobName,bobPassword),
  ])
  const a=alice.client,b=bob.client
  await Promise.all([ready(a),ready(b)])
  const c=a.getCrypto()
  assert.ok(c)
  await c.bootstrapCrossSigning({
    authUploadDeviceSigningKeys:
      await accountPasswordAuth(aliceName,alicePassword),
  })
  assert.equal(await c.isCrossSigningReady(),true,
    'New main-device cross-signing must be ready')
  const master=await c.getCrossSigningKeyId()
  assert.ok(master&&master.length>20,
    'Main-device master cross-signing key missing')
  const generated=await c.createRecoveryKeyFromPassphrase()
  assert.equal(generated.privateKey.length,32)

  await c.bootstrapSecretStorage({
    createSecretStorageKey:async()=>generated,
    setupNewKeyBackup:true,
  })
  const stored=await a.secretStorage.getKey()
  assert.ok(stored?.[0]&&stored?.[1],
    'No active default secret-storage key after bootstrap')
  const [keyId,keyInfo]=stored
  assert.equal(await a.secretStorage.checkKey(generated.privateKey,keyInfo),true)
  assert.equal(await c.isSecretStorageReady(),true,
    'Cross-signing and backup secrets must be in server secret storage')
  const info=await until('trusted remote Matrix backup',async()=>{
    const check=await c.checkKeyBackupAndEnable()
    return check?.info?.version?check.info:null
  },45)
  const version=info.version
  assert.equal(await c.getActiveSessionBackupVersion(),version)

  // A second account sends a genuine encrypted event to Alice, so Alice's
  // RustCrypto receives an inbound Megolm session eligible for backup.
  const created=await a.createRoom({
    visibility:'private',invite:[bob.userId],
    name:'PB3 Disposable Matrix Key Recovery',
    initial_state:[{type:'m.room.encryption',state_key:'',
      content:{algorithm:'m.megolm.v1.aes-sha2'}}],
  })
  const roomId=created.room_id
  await b.joinRoom(roomId)
  await until('Bob sees Alice in encrypted room',()=>
    b.getRoom(roomId)?.getMember(alice.userId)?.membership==='join')
  await until('Bob sees encryption enabled',()=>
    b.getRoom(roomId)?.currentState
      .getStateEvents('m.room.encryption','')
      ?.getContent().algorithm==='m.megolm.v1.aes-sha2')
  await until('Alice sees Bob join',()=>
    a.getRoom(roomId)?.getMember(bob.userId)?.membership==='join')
  const body='PB3_CI_BACKUP_SENTINEL_'+randomUUID().replace(/-/g,'')
  const sent=await b.sendMessage(roomId,{msgtype:MsgType.Text,body},
    'pb3-ci-4s-'+randomUUID())
  assert.ok(sent.event_id)
  await until('Alice receives and decrypts Megolm',()=>{
    const event=a.getRoom(roomId)?.getLiveTimeline().getEvents()
      .find(e=>e.getId()===sent.event_id)
    return event?.getType()==='m.room.message'
      &&event.getContent().body===body
  },90)
  await until('server has encrypted Megolm key backup',async()=>{
    const backup=await api(alice.token,
      '/_matrix/client/v3/room_keys/keys?version='+encodeURIComponent(version))
    if(!backup)return false
    assert.ok(!JSON.stringify(backup).includes(body),
      'Server key backup exposed message plaintext')
    return countBackupSessions(backup)>0
  },100)

  // NEW device: no local Matrix crypto store and no original cross-signing
  // private keys. The only transferred material is the 32-byte SSSS seed;
  // the PB3 production transport must be AKEK sealed (P2-02D1).
  const second=await createDevice(aliceName,alicePassword,
    new Map([[keyId,generated.privateKey]]))
  const next=second.client
  await ready(next)
  const nc=next.getCrypto()
  assert.ok(nc)
  const newDefault=await next.secretStorage.getKey()
  assert.equal(newDefault?.[0],keyId)
  assert.equal(await next.secretStorage.checkKey(generated.privateKey,
    newDefault[1]),true)
  const remoteKeys=await nc.getUserCrossSigningKeys(alice.userId)
  assert.ok(remoteKeys?.master_key?.keys,
    'Missing original public cross-signing identity from homeserver')

  await nc.bootstrapCrossSigning({
    authUploadDeviceSigningKeys:
      await accountPasswordAuth(aliceName,alicePassword),
  })
  assert.equal(await nc.getCrossSigningKeyId(),master,
    'New device MUST NOT rotate existing cross-signing trust root')
  assert.equal(await nc.isCrossSigningReady(),true,
    'Recovered 4S did not restore cross-signing')
  await nc.loadSessionBackupPrivateKeyFromSecretStorage()
  const restored=await nc.restoreKeyBackup()
  assert.ok(restored.total>0,
    'Fresh device restored zero historic Megolm sessions')
  assert.equal((await nc.getKeyBackupInfo())?.version,version,
    'Fresh device did not use original backup')

  // Negative: invented/rotated private 4S secret must not validate against
  // server key metadata. This does not depend on a second Matrix password.
  const forged=new Uint8Array(32)
  forged.fill(0xf3)
  assert.equal(await next.secretStorage.checkKey(forged,newDefault[1]),false)
  forged.fill(0)

  console.log('P2-02D3 PASS: real Matrix 4S cross-signing root persisted, encrypted Megolm backup, recovered SAME root and historic session on NEW device, forged 4S denied')
  generated.privateKey.fill(0)
}finally{
  for(const c of clients){
    try{c.stopClient()}catch{}
  }
}
