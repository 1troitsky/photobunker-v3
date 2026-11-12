/** Narrow runtime re-acceptance of exact PR81. No PB3 auth/Session mocks. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export async function runReacceptance(h){
 const {page,enroll,restore,bind,matrixLogin,mx,record,run,expect}=h;
 const dc=['compose','--env-file',run+'/.env','-f',run+'/compose.json'];
 const snapshot=(id)=>{
  const code='require "vendor/autoload.php"; $a=require "bootstrap/app.php"; $a->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); $q=Illuminate\\Support\\Facades\\DB::table("matrix_recovery_escrows_v1")->where("account_id",$argv[1])->first(); $v=Illuminate\\Support\\Facades\\DB::table("matrix_recovery_escrow_revisions_v2")->where("account_id",$argv[1])->orderBy("account_revision")->get(); echo json_encode(["legacyHash"=>$q?hash("sha256",json_encode($q)):null,"legacyContractHash"=>$q?->contract_hash,"revisions"=>$v->map(fn($r)=>["revision"=>$r->account_revision,"parent"=>$r->parent_contract_hash,"hash"=>$r->contract_hash,"rowHash"=>hash("sha256",json_encode($r))])->all()]);';
  const r=spawnSync('docker',[...dc,'exec','-T','api','php','-r',code,id],{encoding:'utf8'});
  assert.equal(r.status,0,'Read-only disposable escrow snapshot');return JSON.parse(r.stdout);
 };
 async function rotate(p,changedAkek=false){
  return p.evaluate(async changed=>{
   const {requireSession}=await import('/src/features/identity/application/session.ts');
   const c=await import('/src/features/identity/infrastructure/crypto.ts');
   const api=await import('/src/features/identity/infrastructure/api.ts');
   const s=requireSession(),kit=await c.createPB2();
   const pkg={...s.pkg,revision:s.pkg.revision+1,...(changed?{akek:c.b64(c.random(32))}:{})};
   const envelope=await c.sealRecovery(pkg,kit);
   const payload={accountId:s.accountId,deviceId:s.deviceId,envelopeHash:c.hex(await c.digest(new TextEncoder().encode(c.canonical(envelope)))),expectedRevision:String(s.pkg.revision),locator:kit.locator,operationId:c.uuid(),purpose:'rotate'};
   const ch=await api.jsonApi('/identity/v2/challenges','POST',{payload});await c.verifyChallenge(ch,'rotate',payload);
   const proof=await api.jsonApi('/identity/v2/proof','POST',{challengeId:ch.id,signature:await c.sign(await c.importSigner(s.pkg.accountPkcs8),ch.message),deviceSignature:await c.sign(s.device.deviceKey,ch.message),envelope});
   api.resetCsrf();if(proof.purpose!=='rotate')throw Error('audit.rotate_not_accepted');
   return {key:kit.encoded,revision:pkg.revision};
  },changedAkek);
 }
 async function online(p){await expect.poll(()=>p.evaluate(async()=>{const {activeSession}=await import('/src/features/identity/application/session.ts');return activeSession.value?.online===true;})).toBe(true);}
 async function revokeUi(p,target,notice){
  await p.goto('/settings');await online(p);
  p.once('dialog',d=>d.accept());
  await p.getByRole('button',{name:'Отключить от PB3 устройство '+target,exact:true}).click();
  await expect(p.getByRole('status')).toContainText(notice,{timeout:40000});
 }
 async function denied(p){return p.evaluate(async()=>{
  const [a,b]=await Promise.all([fetch('/identity/v2/me',{headers:{Accept:'application/json'}}),fetch('/matrix/v1/me',{headers:{Accept:'application/json'}})]);
  const {activeSession}=await import('/src/features/identity/application/session.ts');
  return {identity:a.status,matrix:b.status,locallyLocked:activeSession.value===null};
 });}
 const A=await page(),a=await enroll(A),ma=await matrixLogin('alice');
 await bind(A,ma);
 record('VITE-ROUTING','PASS',{stockViteConfig:true,stockPorts:[5173,8000],qaMatrixProxyAdded:false,realSignedBindingViaMatrixRoute:true,tlsWhoamiReal:true});
 // Pre-enrol a foreign real signing root; later it signs only adversarial
 // previous-receipt test data. It is never installed as A's Session/root.
 const B=await page(),b=await enroll(B),mb=await matrixLogin('bob');await bind(B,mb);
 let D=null;
 try{
  const crypt=ma.client.getCrypto();
  const accounts=JSON.parse((await import('node:fs')).readFileSync(run+'/accounts.json'));
  await crypt.bootstrapCrossSigning({authUploadDeviceSigningKeys:async send=>send({type:'m.login.password',identifier:{type:'m.id.user',user:'alice'},password:accounts.alice.password})});
  const originalRoot=await crypt.getCrossSigningKeyId();assert.ok(originalRoot);
  const seed=await crypt.createRecoveryKeyFromPassphrase();
  await crypt.bootstrapSecretStorage({createSecretStorageKey:async()=>seed,setupNewKeyBackup:true});
  const [,keyInfo]=await ma.client.secretStorage.getKey();
  assert.equal(await ma.client.secretStorage.checkKey(seed.privateKey,keyInfo),true);
  await A.evaluate(async bytes=>{const m=await import('/src/features/messages/application/matrix-recovery-escrow.ts');await m.escrowMatrixSecretStorageKey(new Uint8Array(bytes));},Array.from(seed.privateKey));
  const legacy=snapshot(a.accountId);assert.equal(legacy.revisions.length,0);
  const rotated=await rotate(A);assert.equal(rotated.revision,2);
  const C=await page();await restore(C,rotated.key);
  let originalPost=null,acceptedStatus=null,ackDropped=false,replayStatus=null,replaySame=false;
  await C.route('**/matrix/v1/recovery/ssss',async route=>{
   if(route.request().method()!=='POST'){await route.fallback();return;}
   originalPost=route.request().postData();
   const response=await route.fetch();acceptedStatus=response.status();
   assert.equal(acceptedStatus,201,'Genuine server accepted rev2 before lost ACK');
   ackDropped=true;await route.abort('failed');
  });
  const loss=await C.evaluate(async()=>{try{const m=await import('/src/features/messages/application/matrix-recovery-escrow.ts');await m.recoverMatrixSecretStorageKey();return 'unexpected_success';}catch{return 'network_failure';}});
  assert.equal(loss,'network_failure');assert.equal(ackDropped,true);
  const committed=snapshot(a.accountId);
  assert.equal(committed.legacyHash,legacy.legacyHash);assert.equal(committed.revisions.length,1);
  assert.equal(committed.revisions[0].revision,2);assert.equal(committed.revisions[0].parent,legacy.legacyContractHash);
  assert.equal(committed.revisions[0].hash,createHash('sha256').update(JSON.parse(originalPost).contract).digest('hex'));
  const pending=await C.evaluate(async()=>{const m=await import('/src/features/messages/application/matrix-recovery-escrow.ts');return m.matrixRecoveryPending();});assert.equal(pending,true);
  await C.unroute('**/matrix/v1/recovery/ssss');
  await C.reload();await online(C);
  await C.route('**/matrix/v1/recovery/ssss',async route=>{
   if(route.request().method()!=='POST'){await route.fallback();return;}
   replaySame=route.request().postData()===originalPost;
   const response=await route.fetch();replayStatus=response.status();
   await route.fulfill({response});
  });
  const recovered=await C.evaluate(async()=>{
   const m=await import('/src/features/messages/application/matrix-recovery-escrow.ts');
   await m.retryMatrixRecoveryEscrow();
   return {key:Array.from(await m.recoverMatrixSecretStorageKey()),pending:await m.matrixRecoveryPending()};
  });
  assert.equal(replayStatus,200);assert.equal(replaySame,true);assert.equal(recovered.pending,false);
  assert.deepEqual(recovered.key,Array.from(seed.privateKey));
  assert.equal(await ma.client.secretStorage.checkKey(new Uint8Array(recovered.key),keyInfo),true);
  assert.equal(await crypt.getCrossSigningKeyId(),originalRoot);
  assert.deepEqual(snapshot(a.accountId),committed);
  await C.unroute('**/matrix/v1/recovery/ssss');
  record('M-02-ROTATION-RECOVERY-LOST-ACK','PASS',{genuineSignedRotate:true,newBrowserRecoveryLogin:true,revision:2,realOriginal4SMac:true,originalCrossSigningRootUnchanged:true,oldCiphertextUnchanged:true,appendOnlyRev2Rows:1,parentHashVerified:true,firstPostAcceptedBeforeAckLost:acceptedStatus,actualPageReloadBeforeReplay:true,identicalPostReplay:replaySame,replayHttp:replayStatus,noDuplicateRows:true,pendingDurableThenCleared:true});
  const third=await rotate(C,true);assert.equal(third.revision,3);
  D=await page();await restore(D,third.key);
  const wrongAkek=await D.evaluate(async()=>{try{const m=await import('/src/features/messages/application/matrix-recovery-escrow.ts');await m.recoverMatrixSecretStorageKey();return 'unexpected_success';}catch(e){return e.message;}});
  assert.equal(wrongAkek,'matrix.recovery_unwrap_failed');assert.deepEqual(snapshot(a.accountId),committed);
  const previous=await D.evaluate(async()=>await(await fetch('/matrix/v1/recovery/ssss/previous')).json());
  const foreignSignature=await B.evaluate(async contract=>{
   const {requireSession}=await import('/src/features/identity/application/session.ts');const c=await import('/src/features/identity/infrastructure/crypto.ts');
   return c.sign(await c.importSigner(requireSession().pkg.accountPkcs8),'pb3.matrix-ssss-escrow.v2\n'+contract);
  },previous.contract);
  await D.route('**/matrix/v1/recovery/ssss/previous',async route=>{
   const real=await route.fetch();const body=await real.json();
   await route.fulfill({response:real,json:{...body,signature:foreignSignature}});
  });
  const wrongRoot=await D.evaluate(async()=>{try{const m=await import('/src/features/messages/application/matrix-recovery-escrow.ts');await m.recoverMatrixSecretStorageKey();return 'unexpected_success';}catch(e){return e.message;}});
  await D.unroute('**/matrix/v1/recovery/ssss/previous');
  assert.equal(wrongRoot,'matrix.recovery_untrusted_receipt');assert.deepEqual(snapshot(a.accountId),committed);
  record('M-02-CHANGED-AKEK-ROOT','PASS',{changedAkekViaGenuineSignedRevision3:true,newBrowserRealLogin:true,changedAkekError:wrongAkek,foreignRealRootReceiptError:wrongRoot,scopeOfRootNegative:'adversarial previous receipt re-signed by separate real PB3 account, not a supported root migration',noRev3Append:true,legacyAndRev2Unchanged:true,authOrSessionMocked:false});
 }catch(e){record('M-02','FAIL',{reason:'Independent assertion failed; private diagnostic saved',errorClass:e.name});(await import('node:fs')).writeFileSync(run+'/private-m02.log',String(e.stack),{mode:0o600});}
 // Independent scenarios continue if recovery failed; no product fixes.
 if(D){
  try{
   await revokeUi(D,a.deviceId,'Отзыв Matrix-токена другого устройства на homeserver не выполнен');
   const target=await denied(A);assert.equal(target.identity,401);assert.equal(target.matrix,401);
   const independent=await mx('/_matrix/client/v3/account/whoami',ma.access_token);assert.equal(independent.status,200);
   record('OTHER-DEVICE-REVOKE','PASS',{genuineSignedOtherDeviceRevoke:true,targetSameCookieIdentity:target.identity,targetSameCookiePb3Matrix:target.matrix,independentMatrixTokenHttp:independent.status,uiExplicitlySaysMatrixRevokeNotPerformed:true});
  }catch(e){record('OTHER-DEVICE-REVOKE','FAIL',{reason:'Independent assertion failed',errorClass:e.name});(await import('node:fs')).writeFileSync(run+'/private-other.log',String(e.stack),{mode:0o600});}
 }else record('OTHER-DEVICE-REVOKE','BLOCKED',{reason:'No recovered actor available after M02 failure'});
 try{
  const timeline=[];
  B.on('response',r=>{
   const u=new URL(r.url());
   if(u.pathname.endsWith('/revoke'))timeline.push({service:'PB3',operation:'signed-revoke',status:r.status()});
   if(u.origin==='https://matrix.pb3-audit.test'&&(u.pathname.endsWith('/whoami')||u.pathname.endsWith('/logout')))timeline.push({service:'Matrix',operation:u.pathname.endsWith('/whoami')?'whoami':'logout',status:r.status()});
  });
  assert.equal((await mx('/_matrix/client/v3/account/whoami',mb.access_token)).status,200);
  await revokeUi(B,b.deviceId,'Matrix-токен этого устройства отозван на homeserver и проверен повторным запросом');
  const rejected=await mx('/_matrix/client/v3/account/whoami',mb.access_token);assert.equal(rejected.status,401);
  const local=await denied(B);assert.deepEqual(local,{identity:401,matrix:401,locallyLocked:true});
  assert.deepEqual(timeline.filter(x=>x.operation==='signed-revoke'||x.operation==='logout'||x.operation==='whoami').map(x=>[x.operation,x.status]),[['signed-revoke',200],['whoami',200],['logout',200],['whoami',401]]);
  mb.client.stopClient();
  record('M-03B-SELF-REVOKE-MATRIX-LOGOUT','PASS',{productionUiConfirmed:true,genuineRootAndDeviceSignedPb3Revoke:true,timeline,samePreviousMatrixTokenHttp:rejected.status,localPb3Locked:local.locallyLocked,pb3ApiHttp:local.identity,pb3MatrixApiHttp:local.matrix,scope:'own device/token only; not Panic or other-device Matrix revocation'});
 }catch(e){record('M-03B-SELF-REVOKE-MATRIX-LOGOUT','FAIL',{reason:'Independent assertion failed',errorClass:e.name});(await import('node:fs')).writeFileSync(run+'/private-self.log',String(e.stack),{mode:0o600});}
 try{
  const F=await page(),f=await enroll(F),mf=await matrixLogin('third');await bind(F,mf);
  let aborted=0;
  await F.route('https://matrix.pb3-audit.test/_matrix/client/v3/logout',async route=>{aborted++;await route.abort('failed');});
  await revokeUi(F,f.deviceId,'Удалённый отзыв Matrix-токена этого устройства НЕ подтверждён');
  assert.equal(aborted,1);
  const local=await denied(F);assert.deepEqual(local,{identity:401,matrix:401,locallyLocked:true});
  const remote=await mx('/_matrix/client/v3/account/whoami',mf.access_token);assert.equal(remote.status,200);
  const rows=await F.evaluate(async()=>new Promise((resolve,reject)=>{const r=indexedDB.open('pb3-sealed-matrix-credentials-v1');r.onerror=()=>reject(Error('idb'));r.onsuccess=()=>{const db=r.result;if(!db.objectStoreNames.contains('credentials')){db.close();reject(Error('audit.credentials_store_missing'));return;}const tx=db.transaction('credentials');const q=tx.objectStore('credentials').count();tx.oncomplete=()=>{resolve(q.result);db.close();};};}));
  assert.equal(rows,0);
  record('M-03B-MATRIX-FAILURE-LOCAL-LOCK','PASS',{fault:'browser aborts only real Matrix logout transport after signed PB3 commit',logoutAborted:aborted,pb3IdentityHttp:local.identity,pb3MatrixHttp:local.matrix,locallyLocked:local.locallyLocked,oldMatrixTokenHttp:remote.status,uiUnconfirmedNoFalseRemoteClaim:true,localCredentialRows:rows});
 }catch(e){record('M-03B-MATRIX-FAILURE-LOCAL-LOCK','FAIL',{reason:'Independent assertion failed',errorClass:e.name});(await import('node:fs')).writeFileSync(run+'/private-failure.log',String(e.stack),{mode:0o600});}
 record('EXCLUDED-GATES','BLOCKED',{m01FullMessaging:false,m04AclRaces:false,fullPanic:false,reason:'Explicitly outside this bounded re-acceptance; not owner accepted'});
}
