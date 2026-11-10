import {test,expect} from '@playwright/test'
import {persistent,enroll,pin,captureSet,synchronize,synced,grantSet,decryptSet,savePrivate} from './helpers'
test('old PR44 database receives real signed personal v1 photo/video/audio grants',async({},info)=>{
 const ca=await persistent('legacy-a'),cb=await persistent('legacy-b'),A=await ca.newPage(),B=await cb.newPage()
 try{const aId=await enroll(A),bId=await enroll(B);await pin(A,bId);await pin(B,aId)
  const items=await captureSet(B);await synchronize(B);await synced(B)
  const grants=await grantSet(B,items,aId);expect(grants.every(g=>g.version===1&&!g.assignmentId)).toBe(true)
  const clear=await decryptSet(A,grants);expect(clear.every(x=>x.matches)).toBe(true)
  savePrivate('legacy-fixture.json',{aId,bId,items,grants})
  await info.attach('audit-proof',{contentType:'application/json',body:JSON.stringify({scenario:'baseline-v1-seed',kinds:clear.map(x=>x.kind),allDecrypted:true,grantVersions:[1,1,1]})})
 }finally{await ca.close();await cb.close()}
})
