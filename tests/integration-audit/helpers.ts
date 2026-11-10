import {expect,type Page,chromium} from '@playwright/test'
import {readFileSync,writeFileSync} from 'node:fs'
export const paths={a:'/src/features/assignments/application/assignment-outbox.ts',p:'/src/features/photo-sync/application/p1-photo.ts',m:'/src/features/media/application/media-outbox.ts',g:'/src/features/sharing/grant-flow.ts',mg:'/src/features/media/application/media-grants.ts',s:'/src/features/identity/application/session.ts',api:'/src/features/identity/infrastructure/api.ts',c:'/src/features/identity/infrastructure/crypto.ts'}
export const secretRecovery=new WeakMap<Page,string>()
export async function enroll(page:Page){
 await page.goto('/settings');await page.getByRole('button',{name:'Создать ключ'}).click()
 secretRecovery.set(page,await page.locator('#generated-key').inputValue())
 await page.getByLabel('Я сохранил ключ восстановления').check();await page.getByRole('button',{name:'Завершить регистрацию'}).click()
 await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
 const id=await page.evaluate(async path=>(await import(path)).requireSession().accountId,paths.s)
 await page.goto('/browser');await expect(page.getByText('Ключ обмена подготовлен')).toBeVisible();return id as string
}
export async function ready(page:Page){await page.evaluate(async path=>{const m=await import(path);if(!m.activeSession.value)await m.resumeExistingDevice();await m.reauthenticate()},paths.s)}
export async function pin(page:Page,id:string){
 return page.evaluate(async id=>{const path='/src/features/sharing/key-directory.ts',m=await import(path);const {directory}=await m.inspectPeer(id);await m.confirmPeer(id,directory.safetyFingerprint);return directory.safetyFingerprint},id)
}
export async function create(page:Page){return page.evaluate(async paths=>{const a=await import(paths.a);const id=await a.queueAssignmentCreation({title:'QA-'+crypto.randomUUID(),instructions:'Synthetic integration',photoGoal:3});await a.flushAssignmentOutbox();await a.listServerAssignments();return id},paths) as Promise<string>}
export async function allKinds(page:Page,id:string){await page.evaluate(async({paths,id})=>{const a=await import(paths.a);await a.queueAssignmentPolicyChange(id,{photoGoal:3,videoGoal:3,audioGoal:3,allowedMedia:['photo','video','audio'],requiredCategory:false,descriptionMinLength:0,requiredGps:false});await a.flushAssignmentOutbox();await a.listServerAssignments()},{paths,id})}
export async function invite(A:Page,B:Page,id:string,bId:string,accept=true){
 await A.evaluate(async({paths,id,bId})=>{const a=await import(paths.a);await a.queueAssignmentInvitation(id,bId);await a.flushAssignmentOutbox()},{paths,id,bId})
 if(accept)await acceptInvite(B,id)
}
export async function acceptInvite(B:Page,id:string){await B.evaluate(async({paths,id})=>{const a=await import(paths.a);const i=(await a.listAssignmentInvites()).find((x:any)=>x.assignmentId===id);if(!i)throw Error('qa.invite_missing');await a.verifyAssignmentInvite(i);await a.queueAssignmentAcceptance(i);await a.flushAssignmentOutbox();await a.listServerAssignments()},{paths,id})}
export async function captureSet(page:Page,assignmentId?:string,record=false){
 return page.evaluate(async({paths,assignmentId,record})=>{
  const p=await import(paths.p),m=await import(paths.m),a=await import(paths.a)
  const result:any[]=[]
  const c=document.createElement('canvas');c.width=100;c.height=80;c.getContext('2d')!.fillRect(0,0,100,80)
  const jpeg=await new Promise<Blob>(r=>c.toBlob(b=>r(b!),'image/jpeg'))
  const fields={category:'private-'+crypto.randomUUID(),description:'private-'+crypto.randomUUID()}
  ;(window as any).__auditPrivateCanaries??=[];(window as any).__auditPrivateCanaries.push(...Object.values(fields))
  const binding=assignmentId?await a.signedCaptureBinding(assignmentId,Date.now(),fields):undefined
  const photo=await p.captureEncrypted(jpeg,binding,fields)
  const hash=async(b:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('')
  result.push({kind:'photo',id:photo.photoId,hash:await hash(jpeg)})
  for(const kind of ['video','audio'] as const){
   const startedAt=Date.now(),intent=assignmentId?await a.signedMediaCaptureIntent(assignmentId,kind,startedAt,fields):undefined
   let blob:Blob
   if(record){
    const stream=await navigator.mediaDevices.getUserMedia({video:kind==='video',audio:true}),parts:Blob[]=[]
    try{const recorder=new MediaRecorder(stream,{mimeType:kind==='video'?'video/webm':'audio/webm'});recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)}
     const done=new Promise<void>((resolve,reject)=>{recorder.onstop=()=>resolve();recorder.onerror=reject});recorder.start();await new Promise(r=>setTimeout(r,220));recorder.stop();await done
     // Match CaptureView: persist the chosen canonical MIME, not the codec-qualified recorder report.
     blob=new Blob(parts,{type:kind==='video'?'video/webm':'audio/webm'})
    }finally{stream.getTracks().forEach(t=>t.stop())}
   }else{blob=new Blob([crypto.getRandomValues(new Uint8Array(4096))],{type:kind==='video'?'video/webm':'audio/webm'})}
   if(blob.size===0)throw Error('qa.empty_recording')
   const name='private-'+crypto.randomUUID()+'.webm';(window as any).__auditPrivateCanaries.push(name)
   const id=await m.enqueueEncryptedMedia(new File([blob],name,{type:blob.type}),intent?{...intent,finishedAt:Math.max(Date.now(),startedAt+1)}:undefined,fields)
   result.push({kind,id,hash:await hash(blob)})
  }
  return result
 },{paths,assignmentId,record}) as Promise<Array<{kind:string,id:string,hash:string}>>
}
export async function synchronize(page:Page){await page.evaluate(async paths=>{await(await import(paths.p)).flushOutbox();await(await import(paths.m)).synchronizeMedia()},paths)}
export async function synced(page:Page){await expect.poll(()=>page.evaluate(async paths=>{const p=await import(paths.p),m=await import(paths.m);return [...await p.listLocalPhotos(),...await m.listLocalMedia()].every(x=>x.state==='synced')},paths)).toBe(true)}
export async function stored(page:Page){return page.evaluate(async paths=>{const p=await import(paths.p),m=await import(paths.m);return {
 photo:(await p.listLocalPhotos()).map((x:any)=>({id:x.photoId,operationId:x.operationId,assets:x.assets.map((a:any)=>({id:a.assetId,sha:a.sha256}))})),
 media:(await m.listLocalMedia()).map((x:any)=>({id:x.mediaId,operationId:x.operationId,chunks:x.chunks.map((c:any)=>({id:c.chunkId,sha:c.sha256}))})),
}},paths)}
export async function grantSet(page:Page,items:any[],recipient:string,assignmentId?:string,maxExpiresAt?:number){
 const out:any[]=[]
 for(const item of items){
  out.push(await page.evaluate(async({paths,item,recipient,assignmentId,maxExpiresAt})=>{
   const g=await import(paths.g),mg=await import(paths.mg)
   const id=item.kind==='photo'?await g.queueRecipientGrant(item.id,recipient,assignmentId,maxExpiresAt):await mg.queueMediaRecipientGrant(item.id,recipient,assignmentId,maxExpiresAt)
   await g.flushRecipientGrants();await mg.flushMediaGrants()
   const row=(item.kind==='photo'?await g.listOutgoingGrants():await mg.listOutgoingMediaGrants()).find((x:any)=>x.id===id)
   if(row.state!=='sent')throw Error('qa.grant_not_sent:'+row.lastError)
   return {...item,grantId:id,version:JSON.parse(row.contract).version,assignmentId:JSON.parse(row.contract).assignmentId??null}
  },{paths,item,recipient,assignmentId,maxExpiresAt}))
 }
 return out
}
export async function decryptSet(page:Page,items:any[]){return page.evaluate(async({paths,items})=>{
 const g=await import(paths.g),mg=await import(paths.mg),results=[]
 for(const x of items){const b=x.kind==='photo'?await g.readReceivedPhoto(x.grantId):(await mg.readReceivedMediaGrant(x.grantId)).blob
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('')
  results.push({kind:x.kind,matches:hash===x.hash,bytes:b.size})}
 return results
},{paths,items})}
export async function ownerRead(page:Page,items:any[]){return page.evaluate(async({paths,items})=>{
 const p=await import(paths.p),m=await import(paths.m),out=[]
 for(const x of items){const blob=x.kind==='photo'?await p.readCloudPhoto(x.id):(await m.readCloudMedia(x.id)).blob;const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');out.push({kind:x.kind,matches:hash===x.hash})}return out
},{paths,items})}
export async function signedPost(page:Page,path:string,contract:any,domain:string){return page.evaluate(async({paths,path,contract,domain})=>{
 const c=await import(paths.c),s=await import(paths.s),api=await import(paths.api)
 const text=JSON.stringify(contract),signature=await c.sign(await c.importSigner(s.requireSession().pkg.accountPkcs8),domain+'\n'+text)
 try{await api.jsonApi(path,'POST',{contract:text,signature});return 200}catch(e){return Number((e as Error).message.match(/http_(\d+)/)?.[1])||0}
},{paths,path,contract,domain})}
export async function serverWait(page:Page,until:number){
 await expect.poll(()=>page.evaluate(async()=>Date.parse((await(await fetch('/identity/v2/time',{cache:'no-store'})).json()).serverUtc)),{timeout:15000,intervals:[80,150,250]}).toBeGreaterThanOrEqual(until)
}
export async function persistent(label:string){return chromium.launchPersistentContext(process.env.PB3_ACCEPTANCE_ARTIFACTS+'/profile-'+label,{baseURL:'http://127.0.0.1:5173',permissions:['camera','microphone'],headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']})}
export function savePrivate(name:string,value:any){writeFileSync(process.env.PB3_ACCEPTANCE_ARTIFACTS+'/'+name,JSON.stringify(value),{mode:0o600})}
export function loadPrivate(name:string){return JSON.parse(readFileSync(process.env.PB3_ACCEPTANCE_ARTIFACTS+'/'+name,'utf8'))}
