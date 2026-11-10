import {test,expect} from '@playwright/test'
import {enroll,pin,create,allKinds,acceptInvite,captureSet,synchronize,synced,stored,grantSet,decryptSet,ownerRead,ready,paths,savePrivate} from './helpers'
test('independent Contacts/instructions/offline capture -> scoped grants -> A decrypt; grant and submission lost ACK',async({browser},info)=>{
 test.setTimeout(150000)
 const ca=await browser.newContext(),cb=await browser.newContext({permissions:['camera','microphone']}),A=await ca.newPage(),B=await cb.newPage()
 try{
  const wire:string[]=[];for(const page of [A,B])page.on('request',r=>{wire.push(r.postData()??'')})
  const aId=await enroll(A),bId=await enroll(B);await pin(B,aId)
  await A.goto('/contacts');await A.getByTestId('contacts-lookup-id').fill(bId)
  await A.getByRole('button',{name:'Проверить ключ',exact:true}).click();await A.getByTestId('contacts-fingerprint-ack').check()
  await A.getByRole('button',{name:'Подтвердить отпечаток'}).click()
  const alias='private-contact-'+crypto.randomUUID();await A.getByTestId('contacts-alias').fill(alias)
  await A.getByRole('button',{name:'Добавить в контакты'}).click();await expect(A.getByTestId('contacts-row-'+bId)).toBeVisible()
  const contactPrivateAbsent=await A.evaluate(async({alias,bId})=>{
   const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('pb3-encrypted-contacts-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
   const rows=await new Promise<any[]>((resolve,reject)=>{const r=db.transaction('contacts').objectStore('contacts').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close()
   return rows.length===1&&!JSON.stringify(rows).includes(alias)&&!JSON.stringify(rows).includes(bId)
  },{alias,bId});expect(contactPrivateAbsent).toBe(true)
  const id=await create(A);await allKinds(A,id)
  const instructionHashes=await A.evaluate(async({paths,id})=>{
   const a=await import(paths.a),data={version:2,title:'private-title-'+crypto.randomUUID(),instructions:'private-common-'+crypto.randomUUID(),photoInstructions:'private-photo-'+crypto.randomUUID(),videoInstructions:'private-video-'+crypto.randomUUID(),audioInstructions:'private-audio-'+crypto.randomUUID()}
   ;(window as any).__auditPrivateCanaries=Object.values(data).filter(v=>typeof v==='string')
   await a.queueAssignmentPrivateTextChange(id,data);await a.flushAssignmentOutbox();await a.listServerAssignments()
   const hash=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('')
   return {photo:await hash(data.photoInstructions),video:await hash(data.videoInstructions),audio:await hash(data.audioInstructions)}
  },{paths,id})
  const privateA=await A.evaluate(()=>(window as any).__auditPrivateCanaries)
  await A.goto('/assignments/'+id+'/edit');await A.getByRole('tab',{name:'Участники'}).click()
  const selected=A.getByTestId('editor-confirmed-contact-'+bId)
  await selected.getByRole('button',{name:'Выбрать'}).click()
  await expect(A.getByText('Контакт выбран, ключ подтверждён. Приглашение ещё не отправлено.')).toBeVisible()
  expect(await A.evaluate(async({paths,id})=>(await(await import(paths.a)).listAssignmentParticipants(id)).length,{paths,id})).toBe(0)
  await A.getByRole('button',{name:'Отправить подписанное приглашение'}).click()
  await expect(A.getByTestId('editor-participant-'+bId)).toContainText('Ожидает принятия')
  await acceptInvite(B,id)
  await A.reload();await A.getByRole('tab',{name:'Участники'}).click()
  await expect(A.getByTestId('editor-participant-'+bId)).toContainText('Принято сервером')
  // Assignment detail authenticates and caches private revision 2 before offline camera use.
  await B.goto('/assignments');await ready(B)
  await B.getByRole('button',{name:'Обновить',exact:true}).click()
  await expect.poll(()=>B.evaluate(async({paths,id})=>{
   const a=await import(paths.a),row=(await a.listCachedAssignmentSnapshots()).find((x:any)=>x.assignmentId===id)
   const value=row?await a.readCachedPrivateAssignment(id,a.assignmentPrivateCacheScope(row)):null
   return value?.version??null
  },{paths,id})).toBe(2)
  await B.locator('.assignment-card').filter({hasText:id.slice(0,8)}).getByRole('button',{name:'Открыть',exact:true}).click()
  await info.attach('audit-proof',{contentType:'application/json',body:JSON.stringify({scenario:'private-cache-online-precondition',verifiedPrivateVersion:2,onlineProofCompleted:true})})
  await cb.setOffline(true)
  await B.getByRole('navigation',{name:'Главная навигация'}).getByRole('link',{name:'Камера',exact:true}).click()
  await B.locator('#camera-assignment').selectOption(id)
  for(const kind of ['photo','video','audio'] as const){
   await B.getByTestId('camera-mode').selectOption(kind)
   await expect(B.getByTestId('camera-media-instruction')).toBeVisible()
   const hash=await B.getByTestId('camera-media-instruction').evaluate(async e=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(e.textContent!.trim().replace(/^Для (фото|видео|аудио):\s*/,''))))].map(x=>x.toString(16).padStart(2,'0')).join(''))
   expect(hash).toBe(instructionHashes[kind])
  }
  const items=await captureSet(B,id,true),before=await stored(B)
  const privateB=await B.evaluate(()=>(window as any).__auditPrivateCanaries??[])
  savePrivate('private-canaries.json',[alias,...privateA,...privateB])
  const localPrivateAbsent=await B.evaluate(async markers=>{
   for(const name of ['pb3-assignment-operation-outbox-v1','pb3-encrypted-photo-outbox-v1','pb3-encrypted-media-outbox-v1']){
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
    for(const store of Array.from(db.objectStoreNames)){const rows=await new Promise<any[]>((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});if(markers.some((v:string)=>JSON.stringify(rows).includes(v)))return false}
    db.close()
   }return true
  },[alias,...privateA,...privateB]);expect(localPrivateAbsent).toBe(true)
  await B.reload().catch(()=>{}) // warm reload may use HTTP cache; no cold-offline guarantee is inferred.
  // Restore network/document; durable encrypted queue must survive either outcome.
  await cb.setOffline(false);await B.goto('/browser');await ready(B)
  expect(await stored(B)).toEqual(before)
  await synchronize(B);await synced(B)
  const proof=await B.evaluate(async({paths,id,photoId,aId})=>{
   const p='/src/features/assignments/application/submission-preflight.ts'
   return(await import(p)).preflightAssignmentPhotoGrant(id,photoId,aId)
  },{paths,id,photoId:items[0].id,aId})
  let committed=false,lostGrant=0
  await B.route('**/shares/v1/grants',async route=>{
   if(route.request().method()!=='POST')return route.continue()
   if(committed)return route.fulfill({status:503,contentType:'application/json',body:'{}'})
   const r=await route.fetch();expect([200,201]).toContain(r.status());committed=true;lostGrant++;await route.abort('connectionreset')
  })
  const photoGrant=await B.evaluate(async({paths,photoId,aId,id,cap})=>{const g=await import(paths.g);const grantId=await g.queueRecipientGrant(photoId,aId,id,cap);await g.flushRecipientGrants();return grantId},{paths,photoId:items[0].id,aId,id,cap:proof.grantExpiresAtCap})
  expect(lostGrant).toBe(1)
  await B.reload();await ready(B);expect(await stored(B)).toEqual(before)
  await B.unroute('**/shares/v1/grants')
  const grantReplay=await B.evaluate(async({paths,photoGrant})=>{
   const g=await import(paths.g),api=await import(paths.api);await g.flushRecipientGrants()
   const row=(await g.listOutgoingGrants()).find((x:any)=>x.id===photoGrant)
   const replies=[];for(let i=0;i<2;i++)replies.push(await api.jsonApi('/shares/v1/grants','POST',{contract:row.contract,signature:row.signature}))
   return {version:JSON.parse(row.contract).version,assignmentId:JSON.parse(row.contract).assignmentId,replies:replies.map(x=>x.unchanged)}
  },{paths,photoGrant})
  expect(grantReplay).toEqual({version:2,assignmentId:id,replies:[true,true]})
  let submitted=false,lostSubmission=0
  await B.route('**/assignments/v1/'+id+'/submissions',async route=>{
   if(route.request().method()!=='POST')return route.continue()
   if(submitted)return route.fulfill({status:503,contentType:'application/json',body:'{}'})
   const r=await route.fetch();expect(r.status()).toBe(201);submitted=true;lostSubmission++;await route.abort('connectionreset')
  })
  await B.evaluate(async({paths,id,photoId,photoGrant,revision})=>{const a=await import(paths.a);await a.queueAssignmentSubmission(id,photoId,photoGrant,revision);await a.flushAssignmentOutbox()},{paths,id,photoId:items[0].id,photoGrant,revision:proof.policyRevision})
  expect(lostSubmission).toBe(1)
  await B.reload();await ready(B);expect(await stored(B)).toEqual(before);await B.unroute('**/assignments/v1/'+id+'/submissions')
  const submissionReplay=await B.evaluate(async({paths,id})=>{
   const a=await import(paths.a),api=await import(paths.api);await a.flushAssignmentOutbox()
   const op=(await a.listAssignmentOperations()).find((x:any)=>x.kind==='submit'&&JSON.parse(x.contract).assignmentId===id)
   if(op.state!=='sent')throw Error('qa.submission_not_sent')
   const r=await api.jsonApi(op.path,'POST',{contract:op.contract,signature:op.signature});return r.unchanged
  },{paths,id});expect(submissionReplay).toBe(true)
  const mediaGrants:any[]=[]
  for(const item of items.slice(1)){
   const cap=await B.evaluate(async({id,item,aId})=>{const p='/src/features/assignments/application/media-submission-preflight.ts';return(await import(p)).preflightAssignmentMediaGrant(id,item.id,aId)},{id,item,aId})
   const [grant]=await grantSet(B,[item],aId,id,cap.grantExpiresAtCap);mediaGrants.push(grant)
   await B.evaluate(async({paths,id,item,grant})=>{const a=await import(paths.a);await a.queueAssignmentMediaSubmission(id,item.id,grant.grantId);await a.flushAssignmentOutbox()},{paths,id,item,grant})
  }
  const delivered=[{...items[0],grantId:photoGrant,version:2,assignmentId:id},...mediaGrants]
  expect(delivered.every(x=>x.version===2&&x.assignmentId===id)).toBe(true)
  expect((await decryptSet(A,delivered)).every(x=>x.matches)).toBe(true)
  const counts=await A.evaluate(async({paths,id})=>{const a=await import(paths.a);return {photo:(await a.listAssignmentSubmissions(id)).length,media:(await a.listAssignmentMediaSubmissions(id)).items.length}},{paths,id})
  expect(counts).toEqual({photo:1,media:2});expect((await ownerRead(B,items)).every(x=>x.matches)).toBe(true)
  expect(await stored(B)).toEqual(before)
  expect(wire.every(body=>![alias,...privateA,...privateB].some(v=>body.includes(v)))).toBe(true)
  await info.attach('audit-proof',{contentType:'application/json',body:JSON.stringify({scenario:'integrated-A-B-A',assignmentId:id,ownerAccountId:aId,contributorAccountId:bId,
   contactSelectionRosterCount:0,rosterAccepted:true,privateContactRowEncrypted:true,privateCanariesAbsentFromIndexedDbAndWire:true,offlinePrivateInstructionsAllKinds:true,genuineMediaRecorderWithSyntheticDevices:true,
   encryptedOfflineReloadRetained:true,grantLostAck:lostGrant,grantExactReplays:2,submissionLostAck:lostSubmission,submissionReplayUnchanged:submissionReplay,
   submitted:counts,versions:[2,2,2],recipientPlaintextHashesMatch:true,contributorOriginalsMatch:true,ciphertextIdentifiersUnchanged:true})})
 }finally{await ca.close();await cb.close()}
})
