/**
 * P2-02C: two REAL Matrix users, real Synapse and official RustCrypto.
 * Disposable CI ONLY. Uses fresh Matrix devices and in-memory crypto so it
 * MUST NOT be used as a production credential or key-backup mechanism.
 *
 * Log no access tokens, room keys, passwords, message bodies or event JSON.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {setTimeout as sleep} from "node:timers/promises";
import {
  createClient, ClientEvent, SyncState, MsgType,
} from "matrix-js-sdk";

const baseUrl=process.env.MATRIX_CI_BASE_URL;
const userA=process.env.MATRIX_CI_ALICE;
const userB=process.env.MATRIX_CI_BOB;
const passA=process.env.MATRIX_CI_ALICE_PASSWORD;
const passB=process.env.MATRIX_CI_BOB_PASSWORD;
const server=process.env.MATRIX_CI_SERVER_NAME;
assert.equal(process.env.MATRIX_CI_DISPOSABLE,"1",
  "Refusing real Matrix E2EE harness outside disposable CI");
assert.equal(baseUrl,"http://127.0.0.1:18008",
  "Harness may contact only dedicated disposable localhost Synapse");
assert.equal(server,"localhost");
for(const value of [userA,userB,passA,passB]) {
  assert.ok(typeof value==="string"&&value.length>=8);
}
assert.notEqual(passA,passB);
assert.notEqual(userA,userB);

const clients=[];
const deadline=(seconds)=>Date.now()+seconds*1000;
async function until(label,condition,seconds=45){
  const stop=deadline(seconds);
  let last;
  while(Date.now()<stop){
    try{
      const result=await condition();
      if(result)return result;
    }catch(e){last=e}
    await sleep(180);
  }
  throw Error("Matrix CI timed out at "+label+(last?" (request not ready)":""));
}
async function login(name,password){
  // No Matrix password, token or response is written to PB3 storage.
  const loginClient=createClient({baseUrl});
  const response=await loginClient.loginRequest({
    type:"m.login.password",
    identifier:{type:"m.id.user",user:name},
    password,
    initial_device_display_name:"PB3-DISPOSABLE-E2EE-CI",
  });
  assert.equal(response.user_id,`@${name}:${server}`);
  assert.ok(typeof response.access_token==="string");
  assert.ok(typeof response.device_id==="string");
  const client=createClient({
    baseUrl,userId:response.user_id,
    deviceId:response.device_id,accessToken:response.access_token,
  });
  clients.push(client);
  await client.initRustCrypto({useIndexedDB:false});
  assert.ok(client.getCrypto(),"Official Rust crypto failed to start");
  return {client,userId:response.user_id,token:response.access_token};
}
async function startReady(client){
  let ready=false;
  client.on(ClientEvent.Sync,state=>{
    if(state===SyncState.Prepared||state===SyncState.Syncing)ready=true;
  });
  await client.startClient({initialSyncLimit:20});
  await until("client prepared sync",()=>ready,60);
}
async function getRawEvent(token,roomId,eventId){
  const path=`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`;
  const response=await fetch(baseUrl+path,{
    headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},
    signal:AbortSignal.timeout(5000),
  });
  assert.equal(response.status,200,"Matrix event fetch failed");
  return response.json();
}
let success=false
try{
  const [alice,bob]=await Promise.all([
    login(userA,passA),login(userB,passB),
  ]);
  const ca=alice.client,cb=bob.client;
  await Promise.all([startReady(ca),startReady(cb)]);

  // Enforce Megolm encryption when creating the room, before any message.
  // Explicit invite is ONLY to a synthetic CI account, not a PB3 Contact.
  const created=await ca.createRoom({
    name:"PB3 Disposable E2EE Fixture",
    visibility:"private",
    invite:[bob.userId],
    initial_state:[{
      type:"m.room.encryption",state_key:"",
      content:{algorithm:"m.megolm.v1.aes-sha2"},
    }],
  });
  const roomId=created.room_id;
  assert.ok(roomId.startsWith("!"));
  await cb.joinRoom(roomId);
  await until("alice sees recipient joined",()=>
    ca.getRoom(roomId)?.getMember(bob.userId)?.membership==="join",60);
  await until("bob sees encrypted room",()=>
    cb.getRoom(roomId)?.currentState.getStateEvents("m.room.encryption","")
      ?.getContent().algorithm==="m.megolm.v1.aes-sha2",60);

  // Unique non-sensitive synthetic sentinel: only its absence in the raw
  // homeserver event matters. Never print it to log.
  const body="PB3_CI_E2EE_SENTINEL_"+randomUUID().replace(/-/g,"");
  const txnId="pb3-ci-"+randomUUID();
  const sent=await ca.sendMessage(roomId,{msgtype:MsgType.Text,body},txnId);
  assert.ok(typeof sent.event_id==="string");

  const raw=await until("remote ciphertext persisted",async()=>{
    try{return await getRawEvent(bob.token,roomId,sent.event_id)}
    catch{return false}
  },45);
  assert.equal(raw.type,"m.room.encrypted","Homeserver received plaintext event");
  assert.equal(raw.content.algorithm,"m.megolm.v1.aes-sha2");
  assert.equal(typeof raw.content.ciphertext,"string");
  assert.ok(raw.content.ciphertext.length>32);
  assert.ok(!JSON.stringify(raw).includes(body),
    "Synthetic plaintext leaked in homeserver event");

  // The recipient must actually decrypt using its distinct RustCrypto device.
  await until("independent recipient decrypted event",()=>{
    const room=cb.getRoom(roomId);
    const event=room?.getLiveTimeline().getEvents()
      .find(e=>e.getId()===sent.event_id);
    return event?.getType()==="m.room.message"
      &&event.getContent().body===body
      &&event.getSender()===alice.userId;
  },90);

  // Lost-ACK replay of the EXACT SAME ciphertext bytes + txnId as
  // the original SDK-authenticated send. A second event ID would mean
  // the server failed the required idempotent transaction contract.
  const replayPath=`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.encrypted/${encodeURIComponent(txnId)}`;
  const replay=await fetch(baseUrl+replayPath,{
    method:"PUT",
    headers:{
      Authorization:`Bearer ${alice.token}`,
      Accept:"application/json",
      "Content-Type":"application/json",
    },
    body:JSON.stringify(raw.content),
    signal:AbortSignal.timeout(7000),
  });
  assert.equal(replay.status,200,"Encrypted Matrix txn replay rejected");
  const same=await replay.json();
  assert.equal(same.event_id,sent.event_id,
    "Lost ACK duplicate yielded a DIFFERENT remote event");

  const matches=cb.getRoom(roomId)?.getLiveTimeline().getEvents()
    .filter(e=>e.getId()===sent.event_id) ?? [];
  assert.equal(matches.length,1,"Duplicate ciphertext reached recipient timeline");

  // A bearer token is mandatory; ciphertext rooms are not public media URLs.
  const anonymous=await fetch(baseUrl+
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(sent.event_id)}`,{
    signal:AbortSignal.timeout(5000),
  });
  assert.equal(anonymous.status,401,
    "An unauthenticated user unexpectedly read a private room event");
  console.log("P2-02C PASS: two Matrix accounts, RustCrypto Megolm ciphertext/decrypt, exact-txn Lost ACK replay, anonymous event rejected");
  success=true
}finally{
  for(const client of clients){
    try{client.stopClient()}catch{ /* disposable process exit */ }
  }
  // Only a completely successful isolated test exits with code zero.
  if(success)process.exit(0)
}
