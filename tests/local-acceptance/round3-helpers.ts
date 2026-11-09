import {expect,type Page} from '@playwright/test'
import {register} from './helpers'
export const assignmentPath='/src/features/assignments/application/assignment-outbox.ts'
export const photoPath='/src/features/photo-sync/application/p1-photo.ts'
export const preflightPath='/src/features/assignments/application/submission-preflight.ts'
export const grantPath='/src/features/sharing/grant-flow.ts'
export async function enroll(page:Page){
  const id=await register(page)
  await page.goto('/browser')
  await expect(page.getByText('Ключ обмена подготовлен')).toBeVisible()
  return id
}
export async function pin(page:Page,id:string){
  await page.evaluate(async id=>{
    const path='/src/features/sharing/key-directory.ts',m=await import(path)
    const {directory}=await m.inspectPeer(id);await m.confirmPeer(id,directory.safetyFingerprint)
  },id)
}
export async function create(page:Page,title='Round3 synthetic assignment'){
  return page.evaluate(async ({path,title})=>{
    const m=await import(path),id=await m.queueAssignmentCreation({title,instructions:'Synthetic QA only',photoGoal:30})
    await m.flushAssignmentOutbox();await m.listServerAssignments();return id
  },{path:assignmentPath,title})
}
export async function invite(A:Page,B:Page,id:string,bId:string,accept=true){
  await A.evaluate(async ({path,id,bId})=>{const m=await import(path);await m.queueAssignmentInvitation(id,bId);await m.flushAssignmentOutbox()}, {path:assignmentPath,id,bId})
  await B.evaluate(async ({path,id,accept})=>{
    const m=await import(path),i=(await m.listAssignmentInvites()).find((x:any)=>x.assignmentId===id)
    if(!i)throw Error('qa.invite_missing')
    await m.verifyAssignmentInvite(i)
    if(accept){await m.queueAssignmentAcceptance(i);await m.flushAssignmentOutbox();await m.listServerAssignments()}
  },{path:assignmentPath,id,accept})
}
export async function transition(page:Page,id:string,action:'finish'|'resume'){
  return page.evaluate(async ({path,id,action})=>{
    const m=await import(path);await m.queueAssignmentStateTransition(id,action);await m.flushAssignmentOutbox()
    const a=(await m.listServerAssignments()).items.find((x:any)=>x.assignmentId===id)
    return {state:a.state,revision:a.revision}
  },{path:assignmentPath,id,action})
}
export async function refresh(page:Page){await page.evaluate(async path=>{await(await import(path)).listServerAssignments()},assignmentPath)}
export async function capture(page:Page,id?:string,fields:any={}){
  return page.evaluate(async({assignmentPath,photoPath,id,fields})=>{
    const m=await import(assignmentPath),p=await import(photoPath)
    const c=document.createElement('canvas');c.width=96;c.height=96
    c.getContext('2d')!.fillRect(0,0,96,96)
    const jpeg=await new Promise<Blob>(resolve=>c.toBlob(b=>resolve(b!),'image/jpeg'))
    const binding=id?await m.signedCaptureBinding(id,Date.now(),fields):undefined
    const row=await p.captureEncrypted(jpeg,binding,fields)
    return {photoId:row.photoId,capturedAt:row.createdAt,version:JSON.parse(p.signedPhotoContract(row)).version,policyRevision:binding?.policyRevision}
  },{assignmentPath,photoPath,id,fields})
}
export async function sync(page:Page){
  await page.evaluate(async path=>{await(await import(path)).flushOutbox()},photoPath)
}
export async function state(page:Page,id:string){
  return page.evaluate(async({path,id})=>{const p=(await(await import(path)).listLocalPhotos()).find((p:any)=>p.photoId===id);return {state:p?.state,error:p?.lastError??null}}, {path:photoPath,id})
}
export async function history(page:Page,id:string){
  return page.evaluate(async id=>{
    const r=await fetch('/assignments/v1/'+id+'/policy-history',{headers:{Accept:'application/json'},cache:'no-store'})
    return {status:r.status,body:await r.json()}
  },id)
}
export async function amend(page:Page,id:string,strict=false){
  await page.evaluate(async({path,id,strict})=>{
    const m=await import(path)
    if(strict)await m.queueAssignmentPolicyChange(id,{photoGoal:45,requiredCategory:true,descriptionMinLength:12,requiredGps:true})
    else await m.queueAssignmentGoalChange(id,45)
    await m.flushAssignmentOutbox();await m.listServerAssignments()
  },{path:assignmentPath,id,strict})
}
