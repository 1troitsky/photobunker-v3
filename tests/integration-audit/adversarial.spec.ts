import {test,expect} from '@playwright/test'
import {enroll,pin,create,allKinds,invite,captureSet,synchronize,synced,grantSet,decryptSet,ownerRead,stored,signedPost,paths,secretRecovery} from './helpers'
test('independent same-owner sibling/pending participant/fingerprint/signature/AAD/account-switch attacks fail closed',async({browser},info)=>{
 test.setTimeout(150000)
 const ca=await browser.newContext(),cb=await browser.newContext(),cc=await browser.newContext(),A=await ca.newPage(),B=await cb.newPage(),C=await cc.newPage()
 try{
  const aId=await enroll(A),bId=await enroll(B),cId=await enroll(C)
  await pin(A,bId);await pin(B,aId);await pin(B,cId)
  const main=await create(A),sibling=await create(A),pending=await create(A)
  for(const id of [main,sibling,pending]){await allKinds(A,id);await invite(A,B,id,bId,id!==pending)}
  const items=await captureSet(B);await synchronize(B);await synced(B)
  const grants=await grantSet(B,items,aId,main)
  const before=await stored(B),http:any[]=[]
  const preflight=await B.evaluate(async({paths,pending,photoId,aId})=>{
   const g=await import(paths.g),count=(await g.listOutgoingGrants()).length
   let error='';try{const path='/src/features/assignments/application/submission-preflight.ts';await(await import(path)).preflightAssignmentPhotoGrant(pending,photoId,aId)}catch(e){error=(e as Error).message}
   return {rejected:!!error,noNewGrant:(await g.listOutgoingGrants()).length===count}
  },{paths,pending,photoId:items[0].id,aId});expect(preflight).toEqual({rejected:true,noNewGrant:true})
  for(const item of grants){
   const contract=await B.evaluate(async({paths,item})=>{const m=await import(item.kind==='photo'?paths.g:paths.mg);const rows=item.kind==='photo'?await m.listOutgoingGrants():await m.listOutgoingMediaGrants();return JSON.parse(rows.find((x:any)=>x.id===item.grantId).contract)},{paths,item})
   const endpoint=item.kind==='photo'?'/shares/v1/grants':'/media-shares/v1/grants',domain=item.kind==='photo'?'pb3.photo-grant.v2':'pb3.media-grant.v2'
   const pendingStatus=await signedPost(B,endpoint,{...contract,grantId:crypto.randomUUID(),assignmentId:pending},domain)
   expect(pendingStatus).toBe(403)
   const cDigest=await B.evaluate(async cId=>(await(await fetch('/shares/v1/keys/'+cId)).json()).descriptorHash,cId)
   const wrongOwner=await signedPost(B,endpoint,{...contract,grantId:crypto.randomUUID(),recipientAccountId:cId,recipientKeyDigest:cDigest},domain)
   expect(wrongOwner).toBe(403)
   const wrongDomain=await signedPost(B,endpoint,{...contract,grantId:crypto.randomUUID()},item.kind==='photo'?'pb3.photo-grant.v1':'pb3.media-grant.v1')
   expect(wrongDomain).toBe(401)
   const cross=await B.evaluate(async({paths,sibling,item})=>{
    const a=await import(paths.a)
    if(item.kind==='photo')await a.queueAssignmentSubmission(sibling,item.id,item.grantId,2)
    else await a.queueAssignmentMediaSubmission(sibling,item.id,item.grantId)
    await a.flushAssignmentOutbox()
    const op=(await a.listAssignmentOperations()).find((x:any)=>['submit','media-submit'].includes(x.kind)&&JSON.parse(x.contract).assignmentId===sibling&&(JSON.parse(x.contract).photoId===item.id||JSON.parse(x.contract).mediaId===item.id))
    return {state:op?.state,error:op?.lastError}
   },{paths,sibling,item})
   expect(cross).toEqual({state:'conflict',error:'api.http_403'})
   http.push({kind:item.kind,pendingStatus,wrongOwner,wrongDomain,crossAssignment:403})
  }
  const fingerprint=await A.evaluate(async bId=>{const path='/src/features/sharing/key-directory.ts',m=await import(path);try{await m.confirmPeer(bId,'0'.repeat(64));return 'accepted'}catch(e){return(e as Error).message}},bId)
  expect(fingerprint).toBe('share.fingerprint_mismatch')
  await A.route('**/shares/v1/keys/'+bId,async route=>{const r=await route.fetch(),body=await r.json();body.signature='AAAA';await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)})})
  const forgedDirectory=await A.evaluate(async bId=>{const path='/src/features/sharing/key-directory.ts';try{await(await import(path)).inspectPeer(bId);return false}catch{return true}},bId)
  expect(forgedDirectory).toBe(true);await A.unroute('**/shares/v1/keys/'+bId)
  const cryptographic:any[]=[]
  for(const item of grants){
   const endpoint=(item.kind==='photo'?'/shares/v1/grants/':'/media-shares/v1/grants/')+item.grantId
   const validDetail=await A.evaluate(async endpoint=>await(await fetch(endpoint)).json(),endpoint)
   const changed=JSON.parse(validDetail.contract);changed.assignmentId=sibling
   // A compromised API can change metadata, but cannot forge the contributor signature.
   await A.route('**'+endpoint,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...validDetail,contract:JSON.stringify(changed)})}))
   const signatureError=await A.evaluate(async({paths,item})=>{try{const m=await import(item.kind==='photo'?paths.g:paths.mg);await(item.kind==='photo'?m.readReceivedPhoto(item.grantId):m.readReceivedMediaGrant(item.grantId));return 'accepted'}catch(e){return(e as Error).message}},{paths,item})
   expect(signatureError).toBe(item.kind==='photo'?'share.unauthenticated_owner':'media_grant.unauthenticated_owner')
   await A.unroute('**'+endpoint)
   // Even a newly valid contributor signature cannot change the existing DEK envelope's AAD.
   const signature=await B.evaluate(async({paths,text,photo})=>{const c=await import(paths.c),s=await import(paths.s);return c.sign(await c.importSigner(s.requireSession().pkg.accountPkcs8),(photo?'pb3.photo-grant.v2\n':'pb3.media-grant.v2\n')+text)},{paths,text:JSON.stringify(changed),photo:item.kind==='photo'})
   await A.route('**'+endpoint,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...validDetail,contract:JSON.stringify(changed),signature})}))
   const aadError=await A.evaluate(async({paths,item})=>{try{const m=await import(item.kind==='photo'?paths.g:paths.mg);await(item.kind==='photo'?m.readReceivedPhoto(item.grantId):m.readReceivedMediaGrant(item.grantId));return 'accepted'}catch(e){return(e as Error).name}},{paths,item})
   expect(aadError).toBe('OperationError');await A.unroute('**'+endpoint)
   cryptographic.push({kind:item.kind,forgedSignatureRejected:true,validSignatureWrongAadRejected:true})
  }
  expect((await decryptSet(A,grants)).every(x=>x.matches)).toBe(true)
  // Real account change in the contributor's same profile, then real Recovery proof.
  const switchResult=await B.evaluate(async({paths,ids})=>{
   const s=await import(paths.s),p=await import(paths.p),m=await import(paths.m)
   await s.logout();await s.finishRegistration(await s.beginRegistration())
   const empty=(await p.listLocalPhotos()).length===0&&(await m.listLocalMedia()).length===0
   let denied=false;try{await p.readLocalPhoto(ids[0])}catch{denied=true}
   const apiStatus=(await fetch('/photos/v1/'+ids[0]+'/manifests',{headers:{Accept:'application/json'}})).status
   return {empty,denied,apiStatus,newAccount:s.requireSession().accountId}
  },{paths,ids:items.map(x=>x.id)})
  expect(switchResult.empty&&switchResult.denied&&switchResult.newAccount!==bId).toBe(true);expect(switchResult.apiStatus).toBe(404)
  const recovery=secretRecovery.get(B)!
  const restored=await B.evaluate(async({paths,recovery})=>{const s=await import(paths.s);await s.logout();return(await s.restoreAccount(recovery)).accountId},{paths,recovery})
  expect(restored).toBe(bId);expect(await stored(B)).toEqual(before)
  expect((await ownerRead(B,items)).every(x=>x.matches)).toBe(true)
  await info.attach('audit-proof',{contentType:'application/json',body:JSON.stringify({scenario:'adversarial',assignmentId:main,sameOwnerSibling:sibling,pendingAssignment:pending,http,
   localPendingPreflightRejected:true,noPendingPregrant:true,fingerprintMismatchRejected:true,forgedDirectoryRejected:true,cryptographic,
   accountSwitchApiHttp:404,accountScopedLocalReadDenied:true,recoveryOriginalHashesMatch:true,localCiphertextIdentifiersPreserved:true})})
 }finally{await ca.close();await cb.close();await cc.close()}
})
