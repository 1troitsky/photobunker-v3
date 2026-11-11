/** Separate UI/identity-switch probe. Draft persistence is not Matrix send. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
export async function runUiAudit({page,enroll,restore,record,expect}){
 const A=await page(),B=await page();
 const a=await enroll(A),b=await enroll(B);
 assert.notEqual(a.accountId,b.accountId);
 const peers=[];
 for(const p of [A,B])peers.push(await p.evaluate(async()=>{
  const {ensureOwnExchangeKey}=await import('/src/features/sharing/key-directory.ts');
  const {directory}=await ensureOwnExchangeKey();
  return {id:directory.accountId,fingerprint:directory.safetyFingerprint};
 }));
 await A.goto('/contacts');await A.getByTestId('contacts-lookup-id').fill(b.accountId);
 await A.getByRole('button',{name:'Проверить ключ'}).click();
 await expect(A.getByTestId('contacts-fingerprint').locator('code')).toHaveText(peers[1].fingerprint);
 await A.getByTestId('contacts-fingerprint-ack').check();
 await A.getByRole('button',{name:'Подтвердить отпечаток'}).click();
 await A.getByTestId('contacts-alias').fill('Independent temporary peer');
 await A.getByRole('button',{name:'Добавить в контакты'}).click();
 await expect(A.getByTestId('contacts-row-'+b.accountId)).toBeVisible();
 await A.goto('/messages');await A.getByTestId('messages-compose').click();
 await A.getByTestId('messages-picker-'+b.accountId).click();
 await expect(A.getByTestId('messages-thread')).toBeVisible();
 await expect(A.getByRole('button',{name:'Отправить сообщение',exact:true})).toBeDisabled();
 const sizes=[];
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  await A.setViewportSize(viewport);
  await A.getByTestId('messages-thread').evaluate(async el=>{
   await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));
  });
  const geometry=await A.getByTestId('messages-thread').evaluate(el=>{
   const r=el.getBoundingClientRect();return {width:innerWidth,height:innerHeight,actual:{x:r.x,y:r.y,width:r.width,height:r.height},coversViewport:r.x===0&&r.y===0&&r.width===innerWidth&&r.height===innerHeight,dockCovered:el.contains(document.elementFromPoint(innerWidth/2,innerHeight-10))};
  });
  assert.ok(geometry.coversViewport&&geometry.dockCovered);sizes.push(geometry);
 }
 record('MESSAGES-OVERLAY-GATE','PASS',{twoRealPb3Accounts:true,independentlyComparedSafetyNumber:true,viewportGeometry:sizes,sendStillDisabled:true,scope:'functional Chromium desktop/narrow viewport; aesthetic parity and hardware unverified'});
 const body='PRIVATE_LOCAL_DRAFT_'+randomBytes(24).toString('hex');
 await A.context().setOffline(true);
 await A.getByTestId('messages-editor').fill(body);
 await A.keyboard.press('Escape');
 await expect(A.getByTestId('messages-thread')).toHaveCount(0);
 await A.context().setOffline(false);
 const sealed=await A.evaluate(async()=>new Promise((resolve,reject)=>{
  const r=indexedDB.open('pb3-encrypted-messages-drafts-v1');
  r.onerror=()=>reject(Error('audit.idb_read_failed'));
  r.onsuccess=()=>{const db=r.result,t=db.transaction('drafts');const q=t.objectStore('drafts').getAll();t.oncomplete=()=>{resolve(JSON.stringify(q.result));db.close();};};
 }));
 for(const forbidden of [body,a.accountId,b.accountId])assert.ok(!sealed.includes(forbidden));
 await A.reload();
 await expect(A.getByTestId('messages-draft-'+b.accountId)).toContainText(body);
 await A.getByTestId('messages-draft-'+b.accountId).click();
 await expect(A.getByTestId('messages-editor')).toHaveValue(body);
 await A.keyboard.press('Escape');
 await expect(A.getByTestId('messages-draft-'+b.accountId)).toBeFocused();
 record('OFFLINE-DRAFT-ACTUAL-RELOAD','PASS',{localEncryptedDraft:true,actualPageReload:true,originalBodyRestored:true,plaintextAndAccountIdsAbsentFromRawDraftRow:true,escapeAndFocusRestore:true,scope:'local draft only; not Matrix outbox, server ACK, delivery or historical recovery'});
 // New behavior beyond the existing basic two-tab CI: document destruction
 // must release the browser's real exclusive Web Lock, then a second tab wins.
 const tab=await A.context().newPage();await tab.goto('/messages');
 const scope='pb3-matrix-'+randomBytes(32).toString('hex');
 await A.evaluate(async scope=>{const {acquireMatrixCryptoLease}=await import('/src/features/messages/application/matrix-crypto-lease.ts');window.auditLease=await acquireMatrixCryptoLease(scope);},scope);
 const before=await tab.evaluate(async scope=>{
  const {acquireMatrixCryptoLease}=await import('/src/features/messages/application/matrix-crypto-lease.ts');
  try{const lock=await acquireMatrixCryptoLease(scope);await lock.release();return 'wrongly_acquired';}catch(e){return e.message;}
 },scope);
 assert.equal(before,'matrix.crypto_store_in_use');
 await A.reload();
 await tab.evaluate(async scope=>{const {acquireMatrixCryptoLease}=await import('/src/features/messages/application/matrix-crypto-lease.ts');const lock=await acquireMatrixCryptoLease(scope);await lock.release();},scope);
 await tab.close();
 record('BROWSER-LEASE-RELOAD','PASS',{secondTabRefused:true,documentReloadReleasedRealWebLock:true,secondTabThenAcquired:true,scope:'actual Web Lock helper only; no fabricated SDK lease or concurrent SDK sender'});
 await expect.poll(()=>A.evaluate(async()=>{const {requireSession}=await import('/src/features/identity/application/session.ts');try{return requireSession().online;}catch{return false;}})).toBe(true);
 await A.evaluate(async()=>{const {logout}=await import('/src/features/identity/application/session.ts');await logout();});
 await restore(A,b.recovery);await A.goto('/messages');
 await expect(A.getByText(body)).toHaveCount(0);
 await expect(A.getByTestId('messages-draft-'+b.accountId)).toHaveCount(0);
 record('REAL-ACCOUNT-SWITCH-LOCAL-DRAFT','PASS',{genuineLogoutAndRecoveryKeyLogin:true,otherAccountDraftNotDisplayed:true,scope:'draft/UI isolation; send and Matrix crypto account-switch gate remain blocked'});
}
