import {test,expect} from '@playwright/test'
import {register,confirmedSession} from './helpers'
for(const field of ['device','key']){
 test(`R3 real camera tracks stop on changed ${field} identity`,async({page},info)=>{
  await register(page)
  await page.goto('/camera');await confirmedSession(page)
  await expect.poll(()=>page.locator('video').evaluate(e=>(e as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
  const result=await page.evaluate(async field=>{
    const path='/src/features/identity/application/session.ts',m=await import(path),s=m.requireSession()
    const old=(document.querySelector('video')!.srcObject as MediaStream).getTracks()
    const device={...s.device}
    if(field==='device')device.deviceId=crypto.randomUUID()
    else device.encryptionKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
    m.activeSession.value={...s,deviceId:device.deviceId,device}
    ;(window as any).__r3OldTracks=old
    return {oldStoppedSynchronously:old.every(t=>t.readyState==='ended'),previewDetached:document.querySelector('video')!.srcObject===null}
  },field)
  expect(result).toEqual({oldStoppedSynchronously:true,previewDetached:true})
  await expect.poll(()=>page.locator('video').evaluate(e=>(e as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
  const distinct=await page.evaluate(()=>{
    const current=(document.querySelector('video')!.srcObject as MediaStream).getTracks()
    return current.every(t=>!(window as any).__r3OldTracks.includes(t))&&(window as any).__r3OldTracks.every((t:MediaStreamTrack)=>t.readyState==='ended')
  })
  expect(distinct).toBe(true)
  await info.attach('round3-camera-proof',{contentType:'application/json',body:JSON.stringify({changed:field,oldStoppedSynchronously:true,previewDetached:true,newStreamDistinct:true})})
 })
}
