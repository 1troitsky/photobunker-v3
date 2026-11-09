import {test,expect} from '@playwright/test'
import {snapshot} from './helpers'
import {enroll,pin,create,invite,capture,transition,sync,state,assignmentPath,photoPath,grantPath} from './round3-helpers'

test('R2-01 exact subsecond offline capture, late reserve, finish/resume, revoke and post-finish denial',async({browser},info)=>{
  test.setTimeout(90000)
  const owner=await browser.newContext(),contributor=await browser.newContext()
  const A=await owner.newPage(),B=await contributor.newPage()
  const http:Array<{path:string,status:number}>=[]
  B.on('response',r=>{if(/\/photos\/v1\/reserve|\/submissions$|\/finalize$/.test(r.url()))http.push({path:new URL(r.url()).pathname,status:r.status()})})
  try{
    const aId=await enroll(A),bId=await enroll(B)
    await pin(A,bId);await pin(B,aId)
    const id=await create(A);await invite(A,B,id,bId)
    await contributor.setOffline(true)
    // Prewarm real modules and generate JPEG before a bounded wall-clock fence.
    await B.evaluate(async({assignmentPath,photoPath})=>{
      await import(assignmentPath);await import(photoPath)
      const c=document.createElement('canvas');c.width=96;c.height=96;c.getContext('2d')!.fillRect(0,0,96,96)
      ;(window as any).__r3jpeg=await new Promise<Blob>(resolve=>c.toBlob(b=>resolve(b!),'image/jpeg'))
      const delay=(1000-Date.now()%1000)%1000+15
      await new Promise(r=>setTimeout(r,delay))
    },{assignmentPath,photoPath})
    const taken=await B.evaluate(async({assignmentPath,photoPath,id})=>{
      const m=await import(assignmentPath),p=await import(photoPath)
      const binding=await m.signedCaptureBinding(id)
      const row=await p.captureEncrypted((window as any).__r3jpeg,binding)
      return {photoId:row.photoId,capturedAt:binding.capturedAt,version:JSON.parse(p.signedPhotoContract(row)).version}
    },{assignmentPath,photoPath,id})
    const before=await snapshot(B)
    expect(await transition(A,id,'finish')).toEqual({state:'finished',revision:2})
    await info.attach('round3-boundary-timing',{contentType:'application/json',body:JSON.stringify({assignmentId:id,photoId:taken.photoId,capturedAt:taken.capturedAt})})
    await contributor.setOffline(false);await sync(B)
    await expect.poll(()=>state(B,taken.photoId)).toEqual({state:'synced',error:null})
    expect((await snapshot(B))[0].assets).toEqual(before[0].assets)
    const grantId=await B.evaluate(async({grantPath,photoId,aId})=>{
      const m=await import(grantPath),id=await m.queueRecipientGrant(photoId,aId);await m.flushRecipientGrants();return id
    },{grantPath,photoId:taken.photoId,aId})
    const denied=await B.evaluate(async({assignmentPath,id,photoId,grantId})=>{
      const m=await import(assignmentPath),opId=await m.queueAssignmentSubmission(id,photoId,grantId)
      await m.flushAssignmentOutbox()
      const op=(await m.listAssignmentOperations()).find((x:any)=>JSON.parse(x.contract).operationId===opId)
      return {state:op.state,error:op.lastError}
    },{assignmentPath,id,photoId:taken.photoId,grantId})
    expect(denied).toEqual({state:'conflict',error:'api.http_409'})
    // Genuine new capture against stale authenticated active policy AFTER finish.
    await contributor.setOffline(true);const post=await capture(B,id)
    await contributor.setOffline(false);await sync(B)
    expect(await state(B,post.photoId)).toEqual({state:'conflict',error:'api.http_409'})
    expect(await transition(A,id,'resume')).toEqual({state:'active',revision:3})
    await B.evaluate(async({assignmentPath,id,photoId,grantId})=>{
      const m=await import(assignmentPath);await m.listServerAssignments();await m.queueAssignmentSubmission(id,photoId,grantId);await m.flushAssignmentOutbox()
    },{assignmentPath,id,photoId:taken.photoId,grantId})
    const received=await A.evaluate(async({assignmentPath,grantPath,id})=>{
      const m=await import(assignmentPath),g=await import(grantPath),rows=await m.listAssignmentSubmissions(id)
      return {count:rows.length,bytes:(await g.readReceivedPhoto(rows[0].photoGrantId)).size}
    },{assignmentPath,grantPath,id})
    expect(received.count).toBe(1);expect(received.bytes).toBeGreaterThan(128)
    await B.evaluate(async({grantPath,grantId})=>{await(await import(grantPath)).revokeOutgoingGrant(grantId)}, {grantPath,grantId})
    const revoked=await A.evaluate(async id=>(await fetch('/shares/v1/grants/'+id,{headers:{Accept:'application/json'}})).status,grantId)
    expect(revoked).toBe(410)
    const cloud=await B.evaluate(async({photoPath,photoId})=>(await(await import(photoPath)).readCloudPhoto(photoId)).size,{photoPath,photoId:taken.photoId})
    expect(cloud).toBeGreaterThan(128)
    const retained=(await snapshot(B)).find(x=>x.photoId===taken.photoId)!
    expect(retained.assets).toEqual(before[0].assets)
    await info.attach('round3-boundary-proof',{contentType:'application/json',body:JSON.stringify({
      assignmentId:id,photoId:taken.photoId,postFinishPhotoId:post.photoId,capturedAt:taken.capturedAt,
      postFinishCapturedAt:post.capturedAt,version:taken.version,lateReserveState:'synced',finishedSubmitHttp:409,
      postFinishReserveHttp:409,resumedSubmissionCount:1,revokeHttp:revoked,contributorReadable:true,
      unchangedCiphertext:true,assets:retained.assets.map(x=>({kind:x.kind,digest:x.digest})),http,
    })})
  }finally{await owner.close();await contributor.close()}
})
