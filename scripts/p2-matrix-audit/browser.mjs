/** Independent acceptance. Real PB3 HTTP auth, real browsers, real TLS Synapse.
 * No vi.mock, synthetic session assignment, disabled TLS verification or Send.
 * Usage: node browser.mjs PRODUCT_WORKTREE PRIVATE_RUN_DIRECTORY
 * Exit 0 means observations completed, NOT product acceptance.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import https from 'node:https';
import {setTimeout as sleep} from 'node:timers/promises';
const [product,run]=process.argv.slice(2).map(x=>resolve(x));
const require=createRequire(product+'/package.json');
const {chromium,expect:baseExpect}=require('@playwright/test');
const expect=baseExpect.configure({timeout:25000});
const webRequire=createRequire(product+'/apps/web/package.json');
const sdk=await import(pathToFileURL(webRequire.resolve('matrix-js-sdk')).href);
const {logger}=await import(pathToFileURL(webRequire.resolve('matrix-js-sdk/lib/logger')).href);
logger.setLevel('silent');
const origin='https://matrix.pb3-audit.test';
const baseURL='http://127.0.0.1:5175';
const ca=readFileSync(run+'/tls.crt');
const accounts=JSON.parse(readFileSync(run+'/accounts.json'));
const results=[];
const qa=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const artifact=qa+'/docs/audits/evidence/P2-MATRIX-INDEPENDENT-'+(process.env.PB3_AUDIT_UI_ONLY==='1'?'ui':'runtime')+'-20261111.json';
function record(id,status,details){
 results.push({id,status,...details});
 writeFileSync(artifact,JSON.stringify({product:'e39b619dc9ec36eefc9ac322367e2d4348a1508e',scope:'independent runtime; no full Messenger acceptance',results},null,2)+'\n');
 console.log(id+': '+status);
}
// HTTPS remains verified against this fixture's exact local CA/certificate.
// No NODE_TLS_REJECT_UNAUTHORIZED, Http::fake or replacement PB3 auth.
async function matrixFetch(input,init={}){
 const url=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url);
 assert.equal(url.origin,origin,'Refuse non-disposable Matrix origin');
 return new Promise((resolveResponse,reject)=>{
  const req=https.request({hostname:'127.0.0.1',port:443,servername:url.hostname,
   path:url.pathname+url.search,method:init.method??'GET',ca,
   headers:{...Object.fromEntries(new Headers(init.headers)),Host:url.host}},res=>{
    const chunks=[];res.on('data',x=>chunks.push(x));
    res.on('end',()=>resolveResponse(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
   });
  req.on('error',()=>reject(Error('audit.matrix_transport_unavailable')));
  req.setTimeout(15000,()=>req.destroy(Error('audit.matrix_timeout')));
  init.signal?.addEventListener('abort',()=>req.destroy(),{once:true});
  if(init.body)req.write(init.body);req.end();
 });
}
async function mx(path,token,method='GET',data){
 const r=await matrixFetch(origin+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
 return {status:r.status,data:await r.json()};
}
async function until(fn,label,seconds=40){
 const stop=Date.now()+seconds*1000;
 while(Date.now()<stop){if(await fn())return;await sleep(250);}
 throw Error('audit.timeout_'+label);
}
const clients=[];
const quietLogger={trace(){},debug(){},info(){},warn(){},error(){},log(){},getChild(){return quietLogger;}};
async function matrixLogin(name){
 const login=await mx('/_matrix/client/v3/login',null,'POST',{type:'m.login.password',identifier:{type:'m.id.user',user:name},password:accounts[name].password});
 assert.equal(login.status,200,'Disposable Matrix login');
 const keys=new Map();
 const client=sdk.createClient({baseUrl:origin,userId:login.data.user_id,deviceId:login.data.device_id,accessToken:login.data.access_token,fetchFn:matrixFetch,logger:quietLogger,
  cryptoCallbacks:{getSecretStorageKey:async({keys:offered})=>{for(const id of Object.keys(offered)){if(keys.has(id))return[id,new Uint8Array(keys.get(id))];}return null;},cacheSecretStorageKey:(id,_info,key)=>keys.set(id,new Uint8Array(key))}});
 clients.push(client);
 await client.initRustCrypto({useIndexedDB:false});
 await client.startClient({initialSyncLimit:10});
 await until(()=>[sdk.SyncState.Prepared,sdk.SyncState.Syncing].includes(client.getSyncState()),'matrix_sync');
 return {...login.data,client,keys};
}
const browser=await chromium.launch({headless:true});
const contexts=[];
let nextPb3Request=0;
async function page(){
 const ctx=await browser.newContext({baseURL});contexts.push(ctx);
 // Keep real security limits intact. Several PB3 route groups share the
 // standard throttle bucket; pace real requests rather than fake responses.
 await ctx.route('http://127.0.0.1:5175/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(/^\/(identity\/v2|matrix\/v1|shares\/v1)(?:\/|$)/.test(path)){
   const turn=Math.max(Date.now(),nextPb3Request);nextPb3Request=turn+1850;
   await sleep(Math.max(0,turn-Date.now()));
  }
  await route.continue();
 });
 return ctx.newPage();
}
async function enroll(p){
 await p.goto('/settings');
 await p.getByRole('button',{name:'Создать ключ',exact:true}).click();
 const recovery=await p.locator('#generated-key').inputValue();
 await p.getByLabel('Я сохранил ключ восстановления').check();
 await p.getByRole('button',{name:'Завершить регистрацию'}).click();
 await expect(p.getByText('Подтверждённая сессия')).toBeVisible({timeout:25000});
 const identity=await p.evaluate(async()=>{const {requireSession}=await import('/src/features/identity/application/session.ts');const s=requireSession();return {accountId:s.accountId,deviceId:s.deviceId};});
 return {...identity,recovery};
}
async function restore(p,key){
 await p.goto('/settings');await p.locator('#recovery-key').fill(key);
 await p.getByRole('button',{name:'Восстановить',exact:true}).click();
 await expect(p.getByText('Подтверждённая сессия')).toBeVisible({timeout:25000});
}
async function bind(p,m){
 await p.evaluate(async v=>{const {beginMatrixBinding}=await import('/src/features/messages/application/matrix-binding.ts');await beginMatrixBinding(v);},
  {matrixUserId:m.user_id,matrixDeviceId:m.device_id,accessToken:m.access_token});
}
let stage='enroll';
try{
 if(process.env.PB3_AUDIT_UI_ONLY==='1'){
  const {runUiAudit}=await import('./ui.mjs');
  await runUiAudit({page,enroll,restore,record,expect});
 }else if(process.env.PB3_AUDIT_FOCUSED_ESCROW==='1'){
  const {runEscrowAudit}=await import('./escrow.mjs');
  await runEscrowAudit({page,enroll,restore,bind,matrixLogin,mx,record,run,product,qa,expect});
 }else{
 const A=await page(),B=await page();
 const a=await enroll(A),b=await enroll(B);assert.notEqual(a.accountId,b.accountId);
 const identities=[];
 for(const p of [A,B])identities.push(await p.evaluate(async()=>{
  const {ensureOwnExchangeKey}=await import('/src/features/sharing/key-directory.ts');
  const {directory}=await ensureOwnExchangeKey();return {id:directory.accountId,fingerprint:directory.safetyFingerprint};
 }));
 for(const [p,peer] of [[A,identities[1]],[B,identities[0]]]){
  await p.goto('/contacts');await p.getByTestId('contacts-lookup-id').fill(peer.id);
  await p.getByRole('button',{name:'Проверить ключ'}).click();
  await expect(p.getByTestId('contacts-fingerprint').locator('code')).toHaveText(peer.fingerprint);
  await p.getByTestId('contacts-fingerprint-ack').check();
  await p.getByRole('button',{name:'Подтвердить отпечаток'}).click();
  await p.getByTestId('contacts-alias').fill('Disposable audit peer');
  await p.getByRole('button',{name:'Добавить в контакты'}).click();
  await expect(p.getByTestId('contacts-row-'+peer.id)).toBeVisible();
 }
 record('PB3-A-B-CONTACTS','PASS',{realRegisteredAccounts:2,isolatedBrowserContexts:2,safetyComparedWithOtherAccount:true,authenticationMocked:false});
 stage='matrix_login_and_binding';
 const ma=await matrixLogin('alice'),mb=await matrixLogin('bob');
 await bind(A,ma);await bind(B,mb);
 const cardA=await A.evaluate(async()=>{const m=await import('/src/features/messages/application/matrix-peer-identity.ts');return m.exportOwnMatrixIdentityCard();});
 const cardB=await B.evaluate(async()=>{const m=await import('/src/features/messages/application/matrix-peer-identity.ts');return m.exportOwnMatrixIdentityCard();});
 for(const [p,card,peer,m] of [[A,cardB,identities[1],mb],[B,cardA,identities[0],ma]]){
  await p.evaluate(async({card,peer,mxid})=>{const m=await import('/src/features/messages/application/matrix-peer-identity.ts');await m.acceptMatrixIdentityCard(card,peer.id,peer.fingerprint,mxid);},{card,peer,mxid:m.user_id});
 }
 record('REAL-TLS-WHOAMI-BINDING','PASS',{pb3AccountAndDeviceSignatures:true,realSynapseUsers:2,tlsVerified:true,serverWhoamiMocked:false,mutualSignedCardsAccepted:true,peerMatrixCrossSigningVerified:false});
 stage='ui_gate';
 await A.goto('/messages');await A.getByTestId('messages-compose').click();
 await A.getByTestId('messages-picker-'+b.accountId).click();
 await expect(A.getByRole('button',{name:'Отправить сообщение',exact:true})).toBeDisabled();
 const geometry=[];
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  await A.setViewportSize(viewport);
  geometry.push(await A.getByTestId('messages-thread').evaluate(el=>{const r=el.getBoundingClientRect();return {width:innerWidth,height:innerHeight,coversViewport:r.x===0&&r.y===0&&r.width===innerWidth&&r.height===innerHeight,dockCovered:el.contains(document.elementFromPoint(innerWidth/2,innerHeight-10))};}));
 }
 assert.ok(geometry.every(x=>x.coversViewport&&x.dockCovered));
 await A.keyboard.press('Escape');
 await expect(A.getByTestId('messages-thread')).toHaveCount(0);
 record('M-01-FULL-PB3-MATRIX','BLOCKED',{reason:'BLOCKED BY IMPLEMENTATION: disabled Send; production adapter exposes no synced client or SAS/QR ceremony',sendGateKeptDisabled:true,geometry,focusReturned:await A.getByTestId('messages-picker-'+b.accountId).isVisible().catch(()=>false),fullUserToUserExchangeExecuted:false});
 stage='real_4s_and_escrow';
 const mc=ma.client.getCrypto();
 await mc.bootstrapCrossSigning({authUploadDeviceSigningKeys:async makeRequest=>makeRequest({type:'m.login.password',identifier:{type:'m.id.user',user:'alice'},password:accounts.alice.password})});
 const originalRoot=await mc.getCrossSigningKeyId();assert.ok(originalRoot);
 const seed=await mc.createRecoveryKeyFromPassphrase();
 await mc.bootstrapSecretStorage({createSecretStorageKey:async()=>seed,setupNewKeyBackup:true});
 const keyInfo=await ma.client.secretStorage.getKey();
 assert.ok(await ma.client.secretStorage.checkKey(seed.privateKey,keyInfo[1]));
 await A.evaluate(async bytes=>{
  const m=await import('/src/features/messages/application/matrix-recovery-escrow.ts');
  await m.escrowMatrixSecretStorageKey(new Uint8Array(bytes));
 },Array.from(seed.privateKey));
 const beforeEscrow=await A.evaluate(async()=>{const r=await fetch('/matrix/v1/recovery/ssss');return {status:r.status,data:await r.json()};});
 assert.equal(beforeEscrow.status,200);assert.equal(beforeEscrow.data.present,true);
 const C=await page();await restore(C,a.recovery);
 const recovered=await C.evaluate(async()=>{const m=await import('/src/features/messages/application/matrix-recovery-escrow.ts');return Array.from(await m.recoverMatrixSecretStorageKey());});
 assert.deepEqual(recovered,Array.from(seed.privateKey));
 assert.ok(await ma.client.secretStorage.checkKey(new Uint8Array(recovered),keyInfo[1]));
 record('REAL-PB3-NEW-DEVICE-4S-UNWRAP','PASS',{originalRealSynapse4S:true,realRecoveryKeyLogin:true,newIsolatedContext:true,matchingOriginalSeed:true,matchingOriginalCrossSigningRoot:await mc.getCrossSigningKeyId()===originalRoot,scope:'PB3 escrow transport + real 4S key MAC only; not historical Megolm/browser SDK recovery'});
 stage='offline_outbox_and_reload';
 const created=await mx('/_matrix/client/v3/createRoom',ma.access_token,'POST',{visibility:'private',preset:'private_chat',invite:[mb.user_id],initial_state:[{type:'m.room.encryption',state_key:'',content:{algorithm:'m.megolm.v1.aes-sha2'}}]});
 assert.equal(created.status,200);
 const room=created.data.room_id;
 assert.equal((await mx('/_matrix/client/v3/join/'+encodeURIComponent(room),mb.access_token,'POST',{})).status,200);
 const fingerprint=mb.client.getCrypto().getOwnDeviceKeys? (await mb.client.getCrypto().getOwnDeviceKeys()).ed25519 : await mb.client.getCrypto().getDeviceEd25519Key();
 assert.equal(typeof fingerprint,'string');
 await A.evaluate(()=>import('/src/features/messages/application/matrix-text-outbox.ts').then(()=>true));
 await A.context().setOffline(true);
 const pending=await A.evaluate(async({peer,room,fingerprint})=>{
  const outbox=await import('/src/features/messages/application/matrix-text-outbox.ts');
  const body='PRIVATE_AUDIT_MESSAGE_'+crypto.randomUUID();
  const id=await outbox.enqueueMatrixText({peerAccountId:peer.id,safetyFingerprint:peer.fingerprint},room,body,fingerprint);
  window.auditPrivateBody=body;return id;
 },{peer:identities[1],room,fingerprint});
 const sealedBefore=await A.evaluate(async()=>new Promise((resolve,reject)=>{const r=indexedDB.open('pb3-matrix-text-outbox-v1');r.onerror=()=>reject(Error('idb'));r.onsuccess=()=>{const db=r.result;const t=db.transaction('items');const q=t.objectStore('items').getAll();t.oncomplete=()=>{resolve(JSON.stringify(q.result));db.close();};};}));
 const body=await A.evaluate(()=>window.auditPrivateBody);
 for(const secret of [body,a.accountId,b.accountId,room,ma.access_token,mb.access_token])assert.ok(!sealedBefore.includes(secret),'Outbox must be opaque');
 await A.context().setOffline(false);
 await A.reload();
 await expect.poll(()=>A.evaluate(async()=>{const {requireSession}=await import('/src/features/identity/application/session.ts');try{return requireSession().online;}catch{return false;}})).toBe(true);
 const restored=await A.evaluate(async()=>{const m=await import('/src/features/messages/application/matrix-text-outbox.ts');return m.listMatrixTextOutbox();});
 assert.equal(restored.length,1);assert.equal(restored[0].operationId,pending);assert.equal(restored[0].body,body);assert.equal(restored[0].state,'queued');
 record('M-05-ACTUAL-BROWSER-RELOAD','PASS',{scope:'encrypted queued intent only',realBrowserReload:true,offlineEnqueue:true,sameTxnId:true,ciphertextOnlyIndexedDB:true,pendingPreserved:true,networkSendClaimed:false});
 record('REAL-OUTBOX-DELIVERY-LOST-ACK','BLOCKED',{reason:'M-01: no production synced leased client / SAS ceremony; no replacement PB3 trust or lease fixture injected',existingCiNotRepeated:true});
 stage='membership_race_snapshot';
 const thirdLogin=await mx('/_matrix/client/v3/login',null,'POST',{type:'m.login.password',identifier:{type:'m.id.user',user:'third'},password:accounts.third.password});
 assert.equal(thirdLogin.status,200);
 const stateBefore=await mx('/_matrix/client/v3/rooms/'+encodeURIComponent(room)+'/state',ma.access_token);
 assert.equal(stateBefore.status,200);
 assert.equal((await mx('/_matrix/client/v3/rooms/'+encodeURIComponent(room)+'/invite',ma.access_token,'POST',{user_id:thirdLogin.data.user_id})).status,200);
 const stateAfter=await mx('/_matrix/client/v3/rooms/'+encodeURIComponent(room)+'/state',ma.access_token);
 assert.equal(stateAfter.status,200);
 const thirdInvited=stateAfter.data.some(e=>e.type==='m.room.member'&&e.state_key===thirdLogin.data.user_id&&e.content.membership==='invite');
 assert.ok(thirdInvited);
 record('M-04-ROOM-STATE-TOCTOU','BLOCKED',{liveSynapseStateChangedAfterSnapshot:true,thirdPartyInvited:true,preflightAlgorithmSourceReviewed:true,productionMegolmSendNotReached:true,unauthorizedDecryptionConfirmed:false,reason:'real PB3 synced client/SAS missing; server race window shown, exploit not proven'});
 stage='rotation';
 const rotated=await A.evaluate(async()=>{
  const {requireSession}=await import('/src/features/identity/application/session.ts');
  const c=await import('/src/features/identity/infrastructure/crypto.ts');
  const api=await import('/src/features/identity/infrastructure/api.ts');
  const s=requireSession(),kit=await c.createPB2(),pkg={...s.pkg,revision:s.pkg.revision+1};
  const envelope=await c.sealRecovery(pkg,kit);
  const payload={accountId:s.accountId,deviceId:s.deviceId,envelopeHash:c.hex(await c.digest(new TextEncoder().encode(c.canonical(envelope)))),expectedRevision:String(s.pkg.revision),locator:kit.locator,operationId:c.uuid(),purpose:'rotate'};
  const challenge=await api.jsonApi('/identity/v2/challenges','POST',{payload});
  await c.verifyChallenge(challenge,'rotate',payload);
  const result=await api.jsonApi('/identity/v2/proof','POST',{challengeId:challenge.id,signature:await c.sign(await c.importSigner(s.pkg.accountPkcs8),challenge.message),deviceSignature:await c.sign(s.device.deviceKey,challenge.message),envelope});
  api.resetCsrf();return {key:kit.encoded,purpose:result.purpose};
 });
 assert.equal(rotated.purpose,'rotate');
 const D=await page();await restore(D,rotated.key);
 const revision=await D.evaluate(async()=>{const {requireSession}=await import('/src/features/identity/application/session.ts');return requireSession().pkg.revision;});
 assert.equal(revision,2);
 const readStatus=await D.evaluate(async()=>(await fetch('/matrix/v1/recovery/ssss')).status);
 const reEscrow=await D.evaluate(async(bytes)=>{
  const {requireSession}=await import('/src/features/identity/application/session.ts');
  const c=await import('/src/features/identity/infrastructure/crypto.ts');
  const api=await import('/src/features/identity/infrastructure/api.ts');
  const s=requireSession();const own=await api.jsonApi('/matrix/v1/me');
  const domain='pb3.matrix-ssss-escrow.v1',keyId=c.b64(c.random(16)),iv=c.random(12);
  const context=[domain,s.accountId,s.pkg.revision,own.homeserverUrl,own.matrixUserId,keyId].join('\n');
  const root=await crypto.subtle.importKey('raw',c.unb64(s.pkg.akek,32),'HKDF',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode(domain+'\nssss'),info:new TextEncoder().encode(context)},root,{name:'AES-GCM',length:256},false,['encrypt']);
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,tagLength:128,additionalData:new TextEncoder().encode(context)},key,new Uint8Array(bytes));
  const contract=JSON.stringify({version:1,operationId:c.uuid(),accountId:s.accountId,accountRevision:s.pkg.revision,homeserverUrl:own.homeserverUrl,matrixUserId:own.matrixUserId,purpose:'matrix-ssss-key',keyId,iv:c.b64(iv),ciphertext:c.b64(cipher)});
  const signed={contract,signature:await c.sign(await c.importSigner(s.pkg.accountPkcs8),domain+'\n'+contract)};
  const {csrfToken}=await(await fetch('/identity/v2/csrf')).json();
  const r=await fetch('/matrix/v1/recovery/ssss',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','X-CSRF-TOKEN':csrfToken},body:JSON.stringify(signed)});
  return r.status;
 },Array.from(seed.privateKey));
 assert.equal(readStatus,409);assert.equal(reEscrow,409);
 record('M-02-GENUINE-RECOVERY-KEY-ROTATION','FAIL',{genuineSignedRotateProof:true,newRecoveryKeyNewBrowserLogin:true,revisionBefore:1,revisionAfter:revision,escrowRev1ReadBefore:200,rev2Read:readStatus,validRootSignedRev2ReEscrow:reEscrow,originalCiphertextPreserved:true,scope:'new recovery credential; same account root/AKEK preserved; old Megolm availability not inferred'});
 stage='revoke_route_and_token';
 const revokeStatus=await D.evaluate(async device=>{
  const {csrfToken}=await(await fetch('/identity/v2/csrf')).json();
  return(await fetch('/identity/v2/devices/'+device+'/revoke',{method:'POST',headers:{Accept:'application/json','X-CSRF-TOKEN':csrfToken}})).status;
 },a.deviceId);
 assert.equal(revokeStatus,404);
 const beforeLogout=await ma.client.whoami();assert.equal(beforeLogout.user_id,ma.user_id);
 await D.evaluate(async()=>{const m=await import('/src/features/identity/application/session.ts');await m.logout();});
 const afterLogout=await ma.client.whoami();assert.equal(afterLogout.user_id,ma.user_id);
 record('M-03-REVOKE-PANIC','BLOCKED',{attemptedRevokeHttp:revokeStatus,routeMissing:true,actualPb3RevocationPerformed:false,activeRealMatrixSdkBeforeLogout:true,matrixSdkWhoamiAfterOrdinaryPb3Logout:true,logoutIsNotRemoteRevocation:true,panicExecuted:false,reason:'no routed PB3 revoke or Panic integration; no claim token survived an actual revoke'});
 record('HISTORICAL-MEGOLM-RECOVERY','BLOCKED',{pb34SSeedTransportVerified:true,oldDeviceOfflineMegolmDecryptVerified:false,reason:'M-01; cannot replace full PB3 browser crypto/trust flow with Node-only fixture'});
 record('NATIVE-SAFARI-IOS-ANDROID','NOT TESTED',{reason:'no physical device used; Chromium does not establish hardware acceptance'});
 }
}catch(e){
 writeFileSync(run+'/private-browser-error.log',String(e.stack));
 record('AUDIT-HARNESS','NOT TESTED',{stage,errorClass:e.name,reason:'Harness stopped; private diagnostics retained; no secrets exported'});
 process.exitCode=1;
}finally{
 for(const c of clients)c.stopClient();
 for(const c of contexts)await c.close();
 await browser.close();
}
// Official SDK pollers may retain Node timers after stopClient. All browser
// contexts and clients above have been explicitly stopped; bound this runner.
process.exit(process.exitCode??0);
