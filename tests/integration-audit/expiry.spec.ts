import {test,expect} from '@playwright/test'
import {enroll,pin,create,allKinds,invite,captureSet,synchronize,synced,grantSet,decryptSet,ownerRead,stored,signedPost,serverWait,paths} from './helpers'
async function access(page:any,grants:any[]){return page.evaluate(async(grants:any[])=>{
 const out=[]
 for(const g of grants){const root=g.kind==='photo'?'/shares/v1':'/media-shares/v1'
  const r=await fetch(root+'/grants/'+g.grantId,{headers:{Accept:'application/json'}});out.push({kind:g.kind,status:r.status})}
 return out
},grants)}
test('independent real-clock grant/schedule/retention expiry preserves v1 shares and contributor originals',async({browser},info)=>{
 test.setTimeout(90000)
 const ca=await browser.newContext(),cb=await browser.newContext(),A=await ca.newPage(),B=await cb.newPage()
 try{
  const aId=await enroll(A),bId=await enroll(B);await pin(A,bId);await pin(B,aId)
  const id=await create(A);await allKinds(A,id);await invite(A,B,id,bId)
  const items=await captureSet(B);await synchronize(B);await synced(B);const before=await stored(B)
  const personal=await grantSet(B,items,aId)
  const long=await grantSet(B,items,aId,id)
  const shortUntil=Date.now()+2500,short=await grantSet(B,items,aId,id,shortUntil)
  expect((await decryptSet(A,short)).every(x=>x.matches)).toBe(true)
  await serverWait(A,shortUntil+10)
  expect((await access(A,short)).map(x=>x.status)).toEqual([410,410,410])
  const base=Date.now(),endsAt=base+2300,filesUntil=base+5500,assignmentUntil=base+7000
  await A.evaluate(async({paths,id,endsAt,filesUntil,assignmentUntil})=>{
   const a=await import(paths.a),row=(await a.listServerAssignments()).items.find((x:any)=>x.assignmentId===id)
   await a.queueAssignmentScheduleChange(id,{startsAt:row.startsAt,endsAt,blockBeforeStart:false,blockAfterEnd:true});await a.flushAssignmentOutbox();await a.listServerAssignments()
   await a.queueAssignmentRetentionChange(id,{filesAccessUntil:filesUntil,assignmentAccessUntil:assignmentUntil,deleteOriginals:false});await a.flushAssignmentOutbox();await a.listServerAssignments()
  },{paths,id,endsAt,filesUntil,assignmentUntil})
  expect((await access(A,long)).map(x=>x.status)).toEqual([200,200,200])
  const deletion=await A.evaluate(async({paths,id})=>{
   const a=await import(paths.a),rows=await a.listAssignmentOperations(),op=rows.find((x:any)=>x.kind==='retention'&&JSON.parse(x.contract).assignmentId===id)
   const contract=JSON.parse(op.contract);contract.operationId=crypto.randomUUID();contract.toRetentionRevision++;contract.fromRetentionRevision++
   const c=await import(paths.c);contract.previousRetentionHash=c.hex(await c.digest(new TextEncoder().encode(op.contract)));contract.deleteOriginals=true
   return contract
  },{paths,id})
  expect(await signedPost(A,'/assignments/v1/'+id+'/retention',deletion,'pb3.assignment-retention.v1')).toBe(422)
  const overCap=[]
  for(const g of long){
   const candidate=await B.evaluate(async({paths,g})=>{const m=await import(g.kind==='photo'?paths.g:paths.mg),rows=g.kind==='photo'?await m.listOutgoingGrants():await m.listOutgoingMediaGrants();return JSON.parse(rows.find((x:any)=>x.id===g.grantId).contract)},{paths,g})
   candidate.grantId=crypto.randomUUID();candidate.expiresAt=filesUntil+1000
   overCap.push(await signedPost(B,g.kind==='photo'?'/shares/v1/grants':'/media-shares/v1/grants',candidate,g.kind==='photo'?'pb3.photo-grant.v2':'pb3.media-grant.v2'))
  }
  expect(overCap).toEqual([422,422,422])
  await serverWait(A,endsAt+10)
  const denied=[]
  for(const g of long){
   const candidate=await B.evaluate(async({paths,g})=>{const m=await import(g.kind==='photo'?paths.g:paths.mg),rows=g.kind==='photo'?await m.listOutgoingGrants():await m.listOutgoingMediaGrants();return JSON.parse(rows.find((x:any)=>x.id===g.grantId).contract)},{paths,g})
   // A new validly signed grant with expiry within the retention cap still fails schedule admission.
   candidate.grantId=crypto.randomUUID();candidate.expiresAt=filesUntil
   denied.push(await signedPost(B,g.kind==='photo'?'/shares/v1/grants':'/media-shares/v1/grants',candidate,g.kind==='photo'?'pb3.photo-grant.v2':'pb3.media-grant.v2'))
  }
  expect(denied).toEqual([409,409,409])
  // The independent admission schedule is not a retroactive original-file TTL.
  expect((await access(A,long)).map(x=>x.status)).toEqual([200,200,200])
  await serverWait(A,filesUntil+10)
  expect((await access(A,long)).map(x=>x.status)).toEqual([410,410,410])
  const replay=await B.evaluate(async({paths,long})=>{
   const g=await import(paths.g),mg=await import(paths.mg),api=await import(paths.api),out=[]
   for(const item of long){const rows=item.kind==='photo'?await g.listOutgoingGrants():await mg.listOutgoingMediaGrants(),row=rows.find((x:any)=>x.id===item.grantId)
    const r=await api.jsonApi(item.kind==='photo'?'/shares/v1/grants':'/media-shares/v1/grants','POST',{contract:row.contract,signature:row.signature});out.push(r.unchanged)}return out
  },{paths,long});expect(replay).toEqual([true,true,true])
  expect((await access(A,long)).map(x=>x.status)).toEqual([410,410,410])
  expect((await access(A,personal)).map(x=>x.status)).toEqual([200,200,200])
  expect((await decryptSet(A,personal)).every(x=>x.matches)).toBe(true)
  const listings=await A.evaluate(async({paths,long})=>{
   const g=await import(paths.g),mg=await import(paths.mg)
   const ids=[...(await g.listReceivedGrants()).map((x:any)=>x.grantId),...(await mg.listReceivedMediaGrants()).map((x:any)=>x.grantId)]
   return long.every((x:any)=>!ids.includes(x.grantId))
  },{paths,long});expect(listings).toBe(true)
  // Direct physical-object endpoints must reauthorize too, not just hide a UI/list row.
  // Actual object/chunk URLs use known immutable IDs, resolved on contributor's local encrypted row.
  const objectPaths=await B.evaluate(async({paths,long})=>{
   const p=await import(paths.p),m=await import(paths.m),photos=await p.listLocalPhotos(),media=await m.listLocalMedia()
   return long.map((g:any)=>g.kind==='photo'?'/shares/v1/grants/'+g.grantId+'/objects/'+photos.find((x:any)=>x.photoId===g.id).assets[0].assetId:'/media-shares/v1/grants/'+g.grantId+'/chunks/'+media.find((x:any)=>x.mediaId===g.id).chunks[0].chunkId)
  },{paths,long})
  const physicalStatuses=await A.evaluate(async urls=>Promise.all(urls.map(async url=>(await fetch(url,{headers:{Accept:'application/json'}})).status)),objectPaths)
  expect(physicalStatuses).toEqual([410,410,410])
  await serverWait(A,assignmentUntil+10)
  const removed=await B.evaluate(async({paths,id})=>!(await(await import(paths.a)).listServerAssignments()).items.some((x:any)=>x.assignmentId===id),{paths,id});expect(removed).toBe(true)
  const status=await A.evaluate(async id=>await(await fetch('/assignments/v1/'+id+'/retention-status')).json(),id)
  expect(status.physicalDeletionConfirmed).toBe(false);expect(status.physicalStatus).toBe('not_authorized')
  expect((await ownerRead(B,items)).every(x=>x.matches)).toBe(true);expect(await stored(B)).toEqual(before)
  await info.attach('audit-proof',{contentType:'application/json',body:JSON.stringify({scenario:'expiry-and-preservation',assignmentId:id,
   grantOwnExpiryStatuses:[410,410,410],signedScheduleEndsAt:endsAt,signedFilesAccessUntil:filesUntil,signedAssignmentAccessUntil:assignmentUntil,
   grantBeyondSignedCutoff:overCap,postExpiryReplayUnchanged:replay,newGrantAfterScheduleEnd:denied,existingReadAfterScheduleEnd:[200,200,200],scopedAfterFilesDeadline:[410,410,410],directCiphertextAfterDeadline:physicalStatuses,
   personalV1AfterDeadline:[200,200,200],personalV1PlaintextHashesMatch:true,scopedListingsFiltered:true,assignmentHiddenAfterDeadline:true,
   ownerDeleteOriginalsHttp:422,physicalDeletionConfirmed:false,contributorOriginalHashesMatch:true,ciphertextIdsUnchanged:true})})
 }finally{await ca.close();await cb.close()}
})
