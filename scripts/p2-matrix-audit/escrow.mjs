/** Focused second fixture after the general audit's rate-limit diagnostics.
 * One real Matrix login only. No auth, trust, HTTP or key mocks.
 */
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
export async function runEscrowAudit(h){
 const {page,enroll,restore,bind,matrixLogin,mx,record,run,qa,expect}=h;
 const A=await page(),a=await enroll(A);
 const matrixUser=process.env.PB3_AUDIT_MATRIX_USER??'alice';
 const m=await matrixLogin(matrixUser);
 await bind(A,m);
 record('REAL-TLS-WHOAMI-BINDING','PASS',{realPb3Registration:true,realMatrixSdkSync:true,rootAndDeviceSigned:true,realWhoami:true,tlsVerificationEnabled:true,authenticationMocked:false,scope:'one focused account; full two-account Messenger remains blocked'});
 const crypto=m.client.getCrypto();
 const accounts=JSON.parse(readFileSync(run+'/accounts.json'));
 await crypto.bootstrapCrossSigning({authUploadDeviceSigningKeys:async send=>send({type:'m.login.password',identifier:{type:'m.id.user',user:matrixUser},password:accounts[matrixUser].password})});
 const originalRoot=await crypto.getCrossSigningKeyId();assert.ok(originalRoot);
 const generated=await crypto.createRecoveryKeyFromPassphrase();
 await crypto.bootstrapSecretStorage({createSecretStorageKey:async()=>generated,setupNewKeyBackup:true});
 const [,info]=await m.client.secretStorage.getKey();
 assert.equal(await m.client.secretStorage.checkKey(generated.privateKey,info),true);
 assert.equal(await m.client.secretStorage.checkKey(new Uint8Array(randomBytes(32)),info),false);
 await A.evaluate(async raw=>{
  const {escrowMatrixSecretStorageKey}=await import('/src/features/messages/application/matrix-recovery-escrow.ts');
  await escrowMatrixSecretStorageKey(new Uint8Array(raw));
 },Array.from(generated.privateKey));
 const before=await A.evaluate(async()=>{const r=await fetch('/matrix/v1/recovery/ssss');return {status:r.status,json:await r.json()};});
 assert.equal(before.status,200);assert.equal(before.json.present,true);
 const originalHash=createHash('sha256').update(before.json.contract).digest('hex');
 // Actual page reload of production sealed Matrix credential and PB3 identity.
 await A.reload();
 // Playwright 1.56 waitForFunction treats an async predicate's Promise as
 // truthy before hydration. expect.poll awaits the real boolean each time.
 await expect.poll(()=>A.evaluate(async()=>{try{const {requireSession}=await import('/src/features/identity/application/session.ts');return requireSession().online;}catch{return false;}})).toBe(true);
 assert.equal(await A.evaluate(async()=>{const {getBoundMatrixCredentials}=await import('/src/features/messages/application/matrix-binding.ts');return !!await getBoundMatrixCredentials();}),true);
 record('ACTUAL-RELOAD-SEALED-CREDENTIAL','PASS',{actualPageReload:true,pb3OnlineHydration:true,originalBoundCredentialSurvived:true,scope:'credential/identity bootstrap; no Matrix message delivery or PWA cold-offline claim'});
 const C=await page();await restore(C,a.recovery);
 const recovered=await C.evaluate(async()=>{
  const {recoverMatrixSecretStorageKey}=await import('/src/features/messages/application/matrix-recovery-escrow.ts');
  return Array.from(await recoverMatrixSecretStorageKey());
 });
 assert.deepEqual(recovered,Array.from(generated.privateKey));
 assert.equal(await m.client.secretStorage.checkKey(new Uint8Array(recovered),info),true);
 assert.equal(await crypto.getCrossSigningKeyId(),originalRoot);
 const wrong=await C.evaluate(async()=>{
  const {createPB2}=await import('/src/features/identity/infrastructure/crypto.ts');
  const kit=await createPB2();
  const r=await fetch('/identity/v2/recovery/'+kit.locator,{headers:{Accept:'application/json'}});
  return r.status;
 });
 assert.equal(wrong,404);
 record('REAL-PB3-NEW-DEVICE-4S-UNWRAP','PASS',{genuineNewBrowserRecoveryKeyLogin:true,sameOriginalMatrix4SKey:true,original4SMacChecked:true,originalCrossSigningRootUnchanged:true,wrong4SRejected:true,unknownRecoveryLocatorHttp:wrong,scope:'real PB3 escrow transport and live 4S MAC, not old-Megolm/browser-SDK recovery'});
 // Populated down() must refuse and preserve exact ciphertext before rotation.
 const dc=['compose','--env-file',run+'/.env','-f',run+'/compose.json'];
 copyFileSync(qa+'/scripts/p2-matrix-audit/migrations.php',run+'/migrations.php');
 const guards=spawnSync('docker',[...dc,'exec','-T','api','php','/audit/migrations.php'],{encoding:'utf8'});
 assert.equal(guards.status,0,'Populated migration guards');
 const migration=JSON.parse(guards.stdout.trim());
 writeFileSync(qa+'/docs/audits/evidence/P2-MATRIX-INDEPENDENT-migrations-populated-20261111.json',JSON.stringify({...migration,command:'docker compose exec -T api php /audit/migrations.php',exitCode:guards.status},null,2)+'\n');
 record('POPULATED-MATRIX-MIGRATIONS','PASS',migration);
 // Real server rotation. No DB UPDATE or fake Session revision. The owner
 // root/AKEK are intentionally preserved while the recovery credential changes.
 const rotation=await A.evaluate(async()=>{
  const {requireSession}=await import('/src/features/identity/application/session.ts');
  const c=await import('/src/features/identity/infrastructure/crypto.ts');
  const api=await import('/src/features/identity/infrastructure/api.ts');
  const s=requireSession(),kit=await c.createPB2();
  const envelope=await c.sealRecovery({...s.pkg,revision:2},kit);
  const payload={accountId:s.accountId,deviceId:s.deviceId,envelopeHash:c.hex(await c.digest(new TextEncoder().encode(c.canonical(envelope)))),expectedRevision:String(s.pkg.revision),locator:kit.locator,operationId:c.uuid(),purpose:'rotate'};
  const challenge=await api.jsonApi('/identity/v2/challenges','POST',{payload});
  await c.verifyChallenge(challenge,'rotate',payload);
  const proof=await api.jsonApi('/identity/v2/proof','POST',{challengeId:challenge.id,signature:await c.sign(await c.importSigner(s.pkg.accountPkcs8),challenge.message),deviceSignature:await c.sign(s.device.deviceKey,challenge.message),envelope});
  api.resetCsrf();return {key:kit.encoded,purpose:proof.purpose};
 });
 assert.equal(rotation.purpose,'rotate');
 const D=await page();await restore(D,rotation.key);
 const revision=await D.evaluate(async()=>{const {requireSession}=await import('/src/features/identity/application/session.ts');return requireSession().pkg.revision;});
 assert.equal(revision,2);
 const get=await D.evaluate(async()=>(await fetch('/matrix/v1/recovery/ssss')).status);
 const post=await D.evaluate(async bytes=>{
  const {requireSession}=await import('/src/features/identity/application/session.ts');
  const c=await import('/src/features/identity/infrastructure/crypto.ts');
  const {jsonApi}=await import('/src/features/identity/infrastructure/api.ts');
  const s=requireSession(),own=await jsonApi('/matrix/v1/me');
  const domain='pb3.matrix-ssss-escrow.v1',keyId=c.b64(c.random(16)),iv=c.random(12);
  const context=[domain,s.accountId,s.pkg.revision,own.homeserverUrl,own.matrixUserId,keyId].join('\n');
  const root=await crypto.subtle.importKey('raw',c.unb64(s.pkg.akek,32),'HKDF',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode(domain+'\nssss'),info:new TextEncoder().encode(context)},root,{name:'AES-GCM',length:256},false,['encrypt']);
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,tagLength:128,additionalData:new TextEncoder().encode(context)},key,new Uint8Array(bytes));
  const contract=JSON.stringify({version:1,operationId:c.uuid(),accountId:s.accountId,accountRevision:2,homeserverUrl:own.homeserverUrl,matrixUserId:own.matrixUserId,purpose:'matrix-ssss-key',keyId,iv:c.b64(iv),ciphertext:c.b64(encrypted)});
  const signature=await c.sign(await c.importSigner(s.pkg.accountPkcs8),domain+'\n'+contract);
  const {csrfToken}=await(await fetch('/identity/v2/csrf')).json();
  return(await fetch('/matrix/v1/recovery/ssss',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','X-CSRF-TOKEN':csrfToken},body:JSON.stringify({contract,signature})})).status;
 },Array.from(generated.privateKey));
 assert.equal(get,409);assert.equal(post,409);
 const verifyRow='require "vendor/autoload.php"; $a=require "bootstrap/app.php"; $a->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); $r=Illuminate\\Support\\Facades\\DB::table("matrix_recovery_escrows_v1")->where("account_id",$argv[1])->first(); echo json_encode(["revision"=>$r->account_revision,"hash"=>$r->contract_hash]);';
 const check=spawnSync('docker',[...dc,'exec','-T','api','php','-r',verifyRow,a.accountId],{encoding:'utf8'});
 assert.equal(check.status,0);const preserved=JSON.parse(check.stdout);
 assert.equal(preserved.revision,1);assert.equal(preserved.hash,originalHash);
 record('M-02-GENUINE-RECOVERY-KEY-ROTATION','FAIL',{signedRotateAccepted:true,genuineRev2LoginOnNewBrowser:true,revisionBefore:1,revisionAfter:revision,rev1EscrowGet:before.status,rev2EscrowGet:get,validRootSignedRev2Post:post,originalCiphertextHashUnchanged:true,oldRowStillRevision:preserved.revision,noEscrowOverwritePerformed:true,scope:'same root/AKEK, new genuine recovery credential'});
 const revoke=await D.evaluate(async device=>{
  const {csrfToken}=await(await fetch('/identity/v2/csrf')).json();
  return(await fetch('/identity/v2/devices/'+device+'/revoke',{method:'POST',headers:{Accept:'application/json','X-CSRF-TOKEN':csrfToken}})).status;
 },a.deviceId);
 assert.equal(revoke,404);
 await A.evaluate(async()=>{const m=await import('/src/features/messages/application/matrix-binding.ts');await m.clearLocalMatrixCredentials();});
 await A.evaluate(async()=>{const m=await import('/src/features/identity/application/session.ts');await m.logout();});
 assert.equal((await m.client.whoami()).user_id,m.user_id);
 record('M-03-REVOKE-PANIC','BLOCKED',{revokeHttp:revoke,routeMissing:true,actualPb3RevocationPerformed:false,matrixSdkWhoamiAfterBoundBrowserLocalCredentialDeleteAndLogout:true,ordinaryLogoutNotMisreportedAsPanic:true,reason:'No routed revoke/Panic lifecycle; no claim of successful revoke or an exploited token after real revocation'});
 const logs=spawnSync('docker',[...dc,'logs','--no-color','api','synapse'],{encoding:'utf8',maxBuffer:10*1024*1024});
 assert.equal(logs.status,0);
 const privateValues=[a.recovery,rotation.key,m.access_token,Buffer.from(generated.privateKey).toString('base64'),Buffer.from(generated.privateKey).toString('base64url')];
 assert.ok(privateValues.every(s=>!logs.stdout.includes(s)&&!logs.stderr.includes(s)),'No credentials in server logs');
 record('LOCAL-LOG-CREDENTIAL-SCAN','PASS',{sources:['PB3 API stdout/stderr','disposable Synapse stdout/stderr'],matchedRecoveryKeys:0,matchedMatrixAccessTokens:0,matched4SSeeds:0,scope:'exact exercised values; raw logs remain private, no general logging proof'});
 record('M-01-FULL-PB3-MATRIX','BLOCKED',{reason:'UI Send disabled; no public production synced client or SAS/QR ceremony',noTrustMocksInjected:true});
 record('M-04-ACL-RACE','NOT TESTED',{reason:'M-01 prevents production preflight/send; no room-key release or unauthorized decryption claim'});
 record('M-05-OUTBOX-RELOAD-LOST-ACK','BLOCKED',{reason:'Full product Messenger not reachable. Actual credential/identity reload checked separately; existing module-reset CI was not relabelled as browser acceptance.'});
 record('HISTORICAL-MEGOLM-RESTORE','BLOCKED',{reason:'PB3 4S bytes recovered and MAC checked; no browser SDK provisioning/history restore. Node Matrix CI not repeated or called full PB3 recovery.'});
 record('NATIVE-SAFARI-IOS-ANDROID','NOT TESTED',{reason:'No physical mobile hardware or native Safari run in this audit'});
 generated.privateKey.fill(0);recovered.fill(0);
}
