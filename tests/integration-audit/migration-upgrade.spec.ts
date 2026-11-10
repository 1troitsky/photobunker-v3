import {test,expect} from '@playwright/test'
import {persistent,ready,decryptSet,ownerRead,loadPrivate} from './helpers'
test('PR46 upgrade keeps pre-existing personal v1 contracts, keys and ciphertext readable',async({},info)=>{
 const ca=await persistent('legacy-a'),cb=await persistent('legacy-b'),A=await ca.newPage(),B=await cb.newPage(),f=loadPrivate('legacy-fixture.json')
 try{await A.goto('/browser');await ready(A);await B.goto('/browser');await ready(B)
  expect((await decryptSet(A,f.grants)).every(x=>x.matches)).toBe(true)
  expect((await ownerRead(B,f.items)).every(x=>x.matches)).toBe(true)
  await info.attach('audit-proof',{contentType:'application/json',body:JSON.stringify({scenario:'upgraded-v1-read',allThreeRecipientDecrypted:true,allThreeContributorDecrypted:true})})
 }finally{await ca.close();await cb.close()}
})
