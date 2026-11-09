import {test,expect,type Page} from '@playwright/test'
import {execFileSync} from 'node:child_process'
import {snapshot} from './helpers'
import {enroll,pin,create,invite,capture,refresh,amend,sync,state,history,assignmentPath,photoPath,preflightPath,grantPath} from './round3-helpers'
const fixture=(...args:string[])=>Number(execFileSync('python3',['scripts/local-acceptance/round3-fixture.py',...args],{encoding:'utf8'}).trim())
async function pair(browser:any){
  const owner=await browser.newContext(),contributor=await browser.newContext({permissions:['camera','geolocation']})
  const A=await owner.newPage(),B=await contributor.newPage()
  const aId=await enroll(A),bId=await enroll(B);await pin(A,bId);await pin(B,aId)
  const id=await create(A);await invite(A,B,id,bId)
  return {owner,contributor,A,B,aId,bId,id}
}
async function strictFixture(browser:any){
  const f=await pair(browser)
  await f.B.route('**/photos/v1/reserve',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}))
  const old1=await capture(f.B,f.id)
  await amend(f.A,f.id);await refresh(f.B)
  const history2=await history(f.B,f.id)
  const old2=await capture(f.B,f.id)
  await amend(f.A,f.id,true);await refresh(f.B)
  await f.B.unroute('**/photos/v1/reserve');await sync(f.B)
  await expect.poll(()=>state(f.B,old1.photoId)).toEqual({state:'synced',error:null})
  await expect.poll(()=>state(f.B,old2.photoId)).toEqual({state:'synced',error:null})
  return {...f,old1,old2,history2}
}
async function openTarget(page:Page,id:string){
  await page.goto('/assignments')
  await page.locator('.assignment-card').filter({hasText:id.slice(0,8)}).getByRole('button',{name:'Открыть',exact:true}).click()
  await page.getByRole('button',{name:'Проверить ключ владельца'}).click()
  await expect(page.getByText('Владелец подтверждён')).toBeVisible()
}

test('R3 signed historical v1/v2 reservation, local requirement gates and zero-knowledge metadata',async({browser},info)=>{
  test.setTimeout(120000)
  const f=await strictFixture(browser),{A,B,id,owner,contributor}=f
  try{
    const historicalBefore=await snapshot(B)
    expect(historicalBefore).toHaveLength(2)
    expect([f.old1.policyRevision,f.old2.policyRevision]).toEqual([1,2])
    // Actual camera UI must reject before durable ciphertext is added.
    await B.goto('/camera?assignmentId='+id)
    await expect.poll(()=>B.locator('video').evaluate(e=>(e as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
    await expect(B.locator('#camera-assignment')).toHaveValue(id)
    const count=historicalBefore.length
    const errors:string[]=[]
    for(const [field,value,error] of [['','','assignment.category_required'],['#camera-category','Synthetic category','assignment.description_too_short'],['#camera-description','Synthetic description sufficient','assignment.gps_required']]){
      if(field)await B.locator(field).fill(value)
      await B.getByRole('button',{name:'Сделать снимок'}).click()
      await expect(B.getByRole('alert')).toContainText(error)
      expect(await snapshot(B)).toHaveLength(count);errors.push(error)
    }
    // Random synthetic private canaries stay in this browser/private run only.
    const privateFields=await B.evaluate(()=>({category:'R3-'+crypto.randomUUID(),description:'R3-private-'+crypto.randomUUID(),latitude:20+Math.random(),longitude:30+Math.random()}))
    await contributor.setGeolocation({latitude:privateFields.latitude,longitude:privateFields.longitude,accuracy:7})
    await B.locator('#camera-category').fill(privateFields.category)
    await B.locator('#camera-description').fill(privateFields.description)
    await B.getByRole('button',{name:'Получить GPS'}).click();await expect(B.getByText(/GPS получен/)).toBeVisible()
    let plaintextOnWire=false
    const canaries=Object.values(privateFields).map(String)
    B.on('request',r=>{const raw=r.postData()??'';if(canaries.some(v=>raw.includes(v)))plaintextOnWire=true})
    await contributor.setOffline(true)
    await B.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(B.getByText(/Зашифровано и сохранено локально/)).toBeVisible()
    const local=await B.evaluate(async({photoPath,privateFields})=>{
      const m=await import(photoPath),rows=await m.listLocalPhotos(),p=rows.find((p:any)=>p.capture?.policyRevision===3)
      const metadata=await m.readLocalPhotoMetadata(p.photoId)
      const serialized=JSON.stringify(p)
      const values=Object.values(privateFields).map(String)
      const cipherTexts=await Promise.all(p.assets.map(async(a:any)=>new TextDecoder().decode(await a.blob.arrayBuffer())))
      return {photoId:p.photoId,correct:metadata.category===privateFields.category&&metadata.description===privateFields.description&&metadata.gps.latitude===privateFields.latitude&&metadata.gps.longitude===privateFields.longitude,
        rowPrivateAbsent:!values.some(v=>serialized.includes(v)),cipherPrivateAbsent:!values.some(v=>cipherTexts.some(s=>s.includes(v))),
        aes:p.assets.every((a:any)=>a.manifest.algorithm==='AES-256-GCM'),digest:p.assets.map((a:any)=>a.sha256),
        contractPrivateAbsent:!values.some(v=>m.signedPhotoContract(p).includes(v))}
    },{photoPath,privateFields})
    expect(local.correct&&local.rowPrivateAbsent&&local.cipherPrivateAbsent&&local.aes&&local.contractPrivateAbsent).toBe(true)
    await contributor.setOffline(false);await sync(B)
    await expect.poll(()=>state(B,local.photoId)).toEqual({state:'synced',error:null})
    const remote=await B.evaluate(async({photoPath,id,privateFields})=>{
      const m=await import(photoPath),meta=await m.readCloudPhotoMetadata(id),p=(await m.listLocalPhotos()).find((x:any)=>x.photoId===id)
      const values=Object.values(privateFields).map(String)
      const bodies=await Promise.all(p.assets.map(async(a:any)=>{
        const r=await fetch('/photos/v1/'+id+'/objects/'+a.assetId);return {status:r.status,text:new TextDecoder().decode(await r.arrayBuffer())}
      }))
      return {correct:meta.category===privateFields.category&&meta.description===privateFields.description&&meta.gps.latitude===privateFields.latitude&&meta.gps.longitude===privateFields.longitude,
        garagePrivateAbsent:!values.some(v=>bodies.some(x=>x.text.includes(v))),statuses:bodies.map(x=>x.status),digest:p.assets.map((a:any)=>a.sha256)}
    },{photoPath,id:local.photoId,privateFields})
    expect(remote.correct&&remote.garagePrivateAbsent&&!plaintextOnWire).toBe(true)
    expect(remote.statuses).toEqual([200,200]);expect(remote.digest).toEqual(local.digest)
    // Owner can still decrypt older already-valid effective revisions after stricter amendment.
    const checks=await B.evaluate(async({preflightPath,id,ids,aId})=>{
      const m=await import(preflightPath),results=[]
      for(const photoId of ids)results.push(await m.preflightAssignmentPhotoGrant(id,photoId,aId))
      return results.map(x=>x.policyRevision)
    },{preflightPath,id,ids:[f.old1.photoId,f.old2.photoId],aId:f.aId})
    expect(checks).toEqual([1,2])
    const {writeFileSync}=await import('node:fs')
    writeFileSync(process.env.PB3_ACCEPTANCE_ARTIFACTS+'/private-canaries.json',JSON.stringify(canaries),{mode:0o600})
    await info.attach('round3-metadata-proof',{contentType:'application/json',body:JSON.stringify({
      assignmentId:id,historicalRevisions:checks,oldPhotosSynced:true,failedCaptureErrors:errors,noCiphertextBeforeRequirements:true,
      localMetadataDecrypted:true,cloudMetadataDecrypted:true,plaintextAbsentFromRowContractWireGarage:true,
      aesGcm:true,unchangedCiphertext:true,garageStatuses:remote.statuses,
    })})
  }finally{await owner.close();await contributor.close()}
})

test('R3 no additional grant or DEK envelope before failed preflight; personal v1 explicit consent',async({browser},info)=>{
  test.setTimeout(120000)
  const {A,B,id,aId,bId,owner,contributor}=await pair(browser)
  try{
    await amend(A,id,true);await refresh(B)
    const invalid=await capture(B),other=await create(B,'Unrelated assignment'),unrelated=await capture(B,other)
    await sync(B)
    expect((await state(B,invalid.photoId)).state).toBe('synced');expect((await state(B,unrelated.photoId)).state).toBe('synced')
    const grantCount=()=>B.evaluate(async path=>(await(await import(path)).listOutgoingGrants()).length,grantPath)
    const before=await grantCount(),serverBefore=fixture('grant-count',bId)
    let uploads=0
    B.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/shares/v1/grants')uploads++})
    await openTarget(B,id)
    const invalidRow=B.locator('.photo-row').filter({hasText:invalid.photoId.slice(0,8)})
    await invalidRow.getByRole('button',{name:'Отправить в задание'}).click()
    await expect(B.getByRole('alert')).toContainText('assignment.category_required')
    expect(await grantCount()).toBe(before);expect(fixture('grant-count',bId)).toBe(serverBefore);expect(uploads).toBe(0)
    // Official UI filters unrelated assignment rows; its exported gate must also reject direct input.
    await expect(B.locator('.photo-row').filter({hasText:unrelated.photoId.slice(0,8)})).toHaveCount(0)
    const wrong=await B.evaluate(async({preflightPath,id,photoId,aId})=>{try{await(await import(preflightPath)).preflightAssignmentPhotoGrant(id,photoId,aId);return 'accepted'}catch(e){return (e as Error).message}}, {preflightPath,id,photoId:unrelated.photoId,aId})
    expect(wrong).toBe('assignment.capture_scope_mismatch')
    expect(await grantCount()).toBe(before);expect(fixture('grant-count',bId)).toBe(serverBefore);expect(uploads).toBe(0)
    // Fully compliant personal v1 photo: cancel must not enqueue, explicit consent must deliver.
    const good=await B.evaluate(async({photoPath})=>{
      const m=await import(photoPath),c=document.createElement('canvas');c.width=96;c.height=96;c.getContext('2d')!.fillRect(0,0,96,96)
      const jpeg=await new Promise<Blob>(resolve=>c.toBlob(b=>resolve(b!),'image/jpeg')),now=Date.now()
      const row=await m.captureEncrypted(jpeg,undefined,{category:'Synthetic category',description:'Synthetic sufficient description',gps:{latitude:20+Math.random(),longitude:30+Math.random(),accuracyMeters:7,recordedAt:now}})
      await m.flushOutbox();return {photoId:row.photoId,version:JSON.parse(m.signedPhotoContract(row)).version}
    },{photoPath})
    expect(good.version).toBe(1)
    await B.getByRole('button',{name:'Синхронизировать'}).click()
    const row=B.locator('.photo-row').filter({hasText:good.photoId.slice(0,8)})
    await expect(row).toContainText('synced')
    const prompts:string[]=[]
    B.once('dialog',async d=>{prompts.push(d.message());await d.dismiss()})
    await row.getByRole('button',{name:'Отправить в задание'}).click()
    expect(await grantCount()).toBe(before);expect(fixture('grant-count',bId)).toBe(serverBefore);expect(uploads).toBe(0)
    B.once('dialog',async d=>{prompts.push(d.message());await d.accept()})
    await row.getByRole('button',{name:'Отправить в задание'}).click()
    await expect.poll(grantCount).toBe(before+1)
    await B.getByRole('button',{name:'Синхронизировать'}).click()
    await expect.poll(()=>fixture('grant-count',bId)).toBe(serverBefore+1)
    expect(prompts.length).toBe(2);expect(prompts.every(s=>s.includes('личное фото')&&s.includes('метаданным'))).toBe(true)
    const received=await A.evaluate(async({assignmentPath,grantPath,id})=>{const m=await import(assignmentPath),s=await import(grantPath),r=await m.listAssignmentSubmissions(id);return {count:r.length,bytes:(await s.readReceivedPhoto(r[0].photoGrantId)).size}}, {assignmentPath,grantPath,id})
    expect(received.count).toBe(1);expect(received.bytes).toBeGreaterThan(128)
    await info.attach('round3-pregrant-proof',{contentType:'application/json',body:JSON.stringify({
      assignmentId:id,contributorAccountId:bId,invalidPersonalError:'assignment.category_required',wrongAssignmentError:wrong,
      failedLocalGrantDelta:0,failedServerGrantDelta:0,failedGrantUploads:0,cancelledConsentGrantDelta:0,
      personalContractVersion:1,explicitConsentPrompts:2,approvedGrantDelta:1,recipientDecrypted:true,
    })})
  }finally{await owner.close();await contributor.close()}
})

test('R3 policy-history ACL, complete signature chain and account-scoped offline cache fail closed',async({browser},info)=>{
  test.setTimeout(120000)
  const f=await strictFixture(browser),{A,B,id,aId,bId,owner,contributor}=f
  const outsider=await browser.newContext(),C=await outsider.newPage()
  try{
    const cId=await enroll(C);const outsiderStatus=(await history(C,id)).status;expect(outsiderStatus).toBe(404)
    await pin(A,cId);await pin(C,aId);await invite(A,C,id,cId,false)
    const unacceptedStatus=(await history(C,id)).status;expect(unacceptedStatus).toBe(404)
    const accepted=await history(B,id),owned=await history(A,id)
    expect(accepted.status).toBe(200);expect(owned.status).toBe(200)
    expect(JSON.stringify(accepted.body.events[0])===JSON.stringify(f.history2.body.events[0])).toBe(true)
    const checks=await B.evaluate(async({preflightPath,assignmentPath,id})=>{
      const p=await import(preflightPath),m=await import(assignmentPath)
      const latest=(await m.listCachedAssignmentSnapshots()).find((x:any)=>x.assignmentId===id)
      const h=await(await fetch('/assignments/v1/'+id+'/policy-history',{headers:{Accept:'application/json'}})).json()
      ;(window as any).__r3Latest=latest;(window as any).__r3History=h
      const valid=await p.rememberSignedPolicyHistory(latest,h)
      const rejected:Record<string,boolean>={}
      const cases:Record<string,any>={signature:structuredClone(h),predecessor:structuredClone(h),rollback:structuredClone(h),missing:structuredClone(h),crossOwner:structuredClone(h)}
      cases.signature.events[0].signature='AAAA'
      const c=JSON.parse(cases.predecessor.events[0].contract);c.previousPolicyHash='0'.repeat(64)
      cases.predecessor.events[0].contract=JSON.stringify(c)
      cases.predecessor.events[0].contractHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(c))))].map(x=>x.toString(16).padStart(2,'0')).join('')
      cases.rollback.policyRevision=2;cases.rollback.events=cases.rollback.events.slice(0,1)
      cases.missing.events.shift();cases.crossOwner.assignmentId=crypto.randomUUID()
      for(const [name,value]of Object.entries(cases)){try{await p.verifySignedPolicyHistory(latest,value);rejected[name]=false}catch{rejected[name]=true}}
      return {revisions:valid.map((x:any)=>x.revision),rejected,
        publicOnly:!/(latitude|longitude|description"|category"|wrappedDEK|accountPkcs8|akek|title"|instructions")/.test(JSON.stringify(h)),
        eventKeys:Object.keys(h.events[0]).sort()}
    },{preflightPath,assignmentPath,id})
    expect(checks.revisions).toEqual([1,2,3]);expect(Object.values(checks.rejected).every(Boolean)&&checks.publicOnly).toBe(true)
    await contributor.setOffline(true)
    const offline=await B.evaluate(async({preflightPath,id,photoId,aId})=>{
      const p=await import(preflightPath)
      const chain=await p.readSignedPolicyHistoryCache((window as any).__r3Latest)
      const result=await p.preflightAssignmentPhotoGrant(id,photoId,aId)
      // Poison actual IndexedDB signature, verify that a later offline read rejects it.
      const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('pb3-verified-assignment-policy-history-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
      const key=(await import('/src/features/identity/application/session.ts')).requireSession().accountId+'/'+id
      await new Promise<void>((resolve,reject)=>{const tx=db.transaction('histories','readwrite'),store=tx.objectStore('histories'),r=store.get(key);r.onsuccess=()=>{const row=r.result;row.history.events[0].signature='AAAA';store.put(row)};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})
      db.close();let corruptRejected=false
      try{await p.readSignedPolicyHistoryCache((window as any).__r3Latest)}catch{corruptRejected=true}
      await p.rememberSignedPolicyHistory((window as any).__r3Latest,(window as any).__r3History)
      return {revisions:chain.map((x:any)=>x.revision),policyRevision:result.policyRevision,corruptRejected}
    },{preflightPath,id,photoId:f.old2.photoId,aId})
    expect(offline).toEqual({revisions:[1,2,3],policyRevision:2,corruptRejected:true})
    // Test-only revoked membership in the disposable database, no product revoke API exists yet.
    expect(fixture('revoke-invite',id,bId)).toBe(1)
    await contributor.setOffline(false)
    expect((await history(B,id)).status).toBe(404)
    const deniedReserve=await capture(B,id,{category:'Synthetic',description:'Synthetic description for revoked member',gps:{latitude:20+Math.random(),longitude:30+Math.random(),accuracyMeters:8,recordedAt:Date.now()}})
    await sync(B)
    expect((await state(B,deniedReserve.photoId)).state).toBe('conflict')
    const crossAccount=await B.evaluate(async({preflightPath})=>{
      const identity=await import('/src/features/identity/application/session.ts'),s=identity.requireSession()
      const p=await import(preflightPath),latest=(window as any).__r3Latest
      // A genuine new registered account shares the same browser's old cache.
      await identity.logout();const key=await identity.beginRegistration();await identity.finishRegistration(key)
      return {different:identity.requireSession().accountId!==s.accountId,cache:await p.readSignedPolicyHistoryCache(latest)}
    },{preflightPath})
    expect(crossAccount).toEqual({different:true,cache:null})
    await info.attach('round3-history-proof',{contentType:'application/json',body:JSON.stringify({
      assignmentId:id,outsiderHttp:outsiderStatus,unacceptedHttp:unacceptedStatus,acceptedHttp:200,ownerHttp:200,
      revisions:checks.revisions,publicOnly:checks.publicOnly,rejections:checks.rejected,offlineReverified:true,
      corruptIndexedDbRejected:true,crossAccountCacheUnavailable:true,revokedHistoryHttp:404,
      revokedReserveDenied:true,revocationSource:'isolated synthetic DB fixture; no product revoke API',
      offlineHistoryIsFreshAclAuthority:false,
    })})
  }finally{await owner.close();await contributor.close();await outsider.close()}
})
