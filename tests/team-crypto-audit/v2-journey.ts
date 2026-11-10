import type {Page} from '@playwright/test'
import {expect} from '@playwright/test'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {fixture,scope,overlappingWrites} from './fixture'
type Check=(id:string,ok:boolean,actual:unknown)=>void
export async function v2Journey(A:Page,B:Page,C:Page,D:Page,teamId:string,a:string,b:string,c:string,d:string,canaries:string[],check:Check){
  const run=process.env.PB3_ACCEPTANCE_ARTIFACTS!
  async function get(p:Page,path:string){return p.evaluate(async path=>{const r=await fetch(path,{headers:{Accept:'application/json'},cache:'no-store'});return{status:r.status,body:await r.json()}},path)}
  async function sync(p:Page){await p.evaluate(async()=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');await m.syncEpochInvitationOperations()})}
  async function sealed(p:Page){return p.evaluate(async()=>{
    const k=await import('/src/features/identity/infrastructure/crypto.ts')
    const raw=await new Promise<string>((resolve,reject)=>{const r=indexedDB.open('pb3-encrypted-team-invites-v2');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('operations'),q=t.objectStore('operations').getAll();t.oncomplete=()=>{resolve(JSON.stringify(q.result));db.close()}}})
    return {raw,hash:k.hex(await k.digest(new TextEncoder().encode(raw)))}
  })}
  async function rememberDek(){
    const values=await A.evaluate(async teamId=>{
      const m=await import('/src/features/people/application/team-epochs.ts')
      const k=await import('/src/features/identity/infrastructure/crypto.ts')
      return m.withCurrentOwnerTeamDEK(teamId,async raw=>[k.b64(raw),k.hex(raw)])
    },teamId)
    const file=join(run,'private-canaries.json'),old=JSON.parse(readFileSync(file,'utf8'))
    writeFileSync(file,JSON.stringify([...old,...values]),{mode:0o600})
  }
  const ownerDeviceId=await A.evaluate(async()=>{const s=await import('/src/features/identity/application/session.ts');return s.requireSession().deviceId})
  const recipientDeviceId=await B.evaluate(async()=>{const s=await import('/src/features/identity/application/session.ts');return s.requireSession().deviceId})
  async function lostAck(p:Page,url:string,label:string){
    const before=await sealed(p),requests:string[]=[];let first=0,last:any
    await p.route(url,async r=>{requests.push(r.request().postData()!);const response=await r.fetch();first=response.status();await r.abort('connectionreset')})
    try{await sync(p)}catch{/* Actual committed server response intentionally lost */}
    await p.unroute(url)
    await p.reload();await expect(p.getByText('Подтверждённая сессия')).toBeVisible()
    const after=await sealed(p)
    await p.route(url,async r=>{requests.push(r.request().postData()!);const response=await r.fetch();last={status:response.status(),...await response.json()};await r.fulfill({response})})
    await sync(p);await p.unroute(url)
    check(label,first===201&&last.status===200&&last.unchanged&&requests.length===2&&requests[0]===requests[1]&&before.hash===after.hash,
      {commit:first,replay:last.status,unchanged:last.unchanged,exact:requests[0]===requests[1],ciphertextSurvivedReload:before.hash===after.hash})
  }
  await rememberDek()
  const inviteB=await A.evaluate(async({teamId,b})=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');return m.queueEpochInvitation(teamId,b,'viewer')},{teamId,b})
  await lostAck(A,'**/teams/v2/'+teamId+'/invites','v2-invitation-lost-ACK-reload-exact-replay')
  const incomingB=await B.evaluate(async teamId=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');return(await m.listEpochInvites()).invites.find(i=>i.teamId===teamId)!},teamId)
  check('fresh-v2-invite-rejoin-binding',incomingB.keyEpoch===3&&incomingB.inviteId===inviteB&&incomingB.trustedOwner,{epoch:incomingB.keyEpoch,trusted:incomingB.trustedOwner})
  await B.evaluate(async item=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');await m.queueEpochAcceptance(item)},incomingB)
  await lostAck(B,'**/teams/v2/'+teamId+'/invites/'+inviteB+'/accept','v2-consent-lost-ACK-reload-exact-replay')
  const acceptedB={...incomingB,state:'accepted'} as typeof incomingB
  async function open(p:Page,item=acceptedB){return p.evaluate(async item=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');try{const x=await m.openJoinedEpochInvite(item);return{ok:true,role:x.role,error:null}}catch(e){return{ok:false,role:null,error:(e as Error).message}}},item)}
  check('v2-explicit-consent-decrypts-current-DEK',(await open(B)).ok,{memberStatus:(await get(B,'/teams/v2/'+teamId+'/member')).status})
  // Genuine historical receipt, unchanged signed bytes; model two legitimate
  // events sharing the DB timestamp precision of one second.
  scope({teamId,ownerAccountId:a,ownerDeviceId,recipientAccountId:b,recipientDeviceId,inviteId:inviteB})
  const tied=await fixture('tie-role-time')
  try{const value=await open(B);check('rejoin-does-not-select-prior-invite-role-receipt',value.ok,{...tied,...value})}
  finally{await fixture('restore-role-time')}
  await A.evaluate(async({teamId,b})=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');const member=(await m.listOwnerEpochRoster(teamId)).find(x=>x.recipientAccountId===b&&x.state==='accepted')!;await m.queueEpochMembershipChange(teamId,member,'change_role','contributor');await m.syncEpochInvitationOperations()},{teamId,b})
  const changed=await open(B)
  check('v2-signed-role-repeat-read',changed.ok&&changed.role==='contributor'&&(await open(B)).role==='contributor',changed)
  const member=(await get(B,'/teams/v2/'+teamId+'/member')).body
  const history=(await get(B,'/teams/v1/'+teamId+'/epoch/history')).body
  const memberUrl='**/teams/v2/'+teamId+'/member',historyUrl='**/teams/v1/'+teamId+'/epoch/history'
  await B.route(memberUrl,r=>r.fulfill({status:200,json:{...member,membershipRevision:1000000}}))
  await B.route(historyUrl,r=>r.fulfill({status:200,json:{...history,membershipRevision:1000000}}))
  const inflated=await open(B)
  await B.unroute(memberUrl);await B.unroute(historyUrl)
  check('v2-unsigned-revision-does-not-poison-floor',inflated.ok&&(await open(B)).ok,{inflated:inflated.ok,legitimate:(await open(B)).ok})
  await B.route(memberUrl,r=>r.fulfill({status:200,json:{...member,latestRoleEvent:null,effectiveRole:'viewer'}}))
  const oldRole=await open(B);await B.unroute(memberUrl)
  check('v2-replayed-role-view-rejected',!oldRole.ok,{error:oldRole.error})
  // C rejoins as a second v2 member and survives epoch 4. Its invitation
  // signs a later membership revision than the epoch's publication revision.
  await A.evaluate(async({teamId,c})=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');await m.queueEpochInvitation(teamId,c,'viewer');await m.syncEpochInvitationOperations()},{teamId,c})
  const acceptedC=await C.evaluate(async teamId=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');const i=(await m.listEpochInvites()).invites.find(x=>x.teamId===teamId)!;await m.queueEpochAcceptance(i);await m.syncEpochInvitationOperations();return {...i,state:'accepted'}},teamId)
  const cOpened=await open(C,acceptedC)
  check('second-v2-member-consents',cOpened.ok,cOpened)
  const cOriginal=(await get(C,'/teams/v2/'+teamId+'/member')).body
  const cHistory=(await get(C,'/teams/v1/'+teamId+'/epoch/history')).body
  const belowInvite=acceptedC.membershipRevision-1
  await C.route(memberUrl,r=>r.fulfill({status:200,json:{...cOriginal,membershipRevision:belowInvite}}))
  await C.route(historyUrl,r=>r.fulfill({status:200,json:{...cHistory,membershipRevision:belowInvite}}))
  const lowered=await open(C,acceptedC)
  await C.unroute(memberUrl);await C.unroute(historyUrl)
  check('v2-revision-floor-includes-signed-invitation',!lowered.ok,{signedInvitationRevision:acceptedC.membershipRevision,replayedRevision:belowInvite,error:lowered.error})
  const inviteD=await A.evaluate(async({teamId,d})=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');const id=await m.queueEpochInvitation(teamId,d,'viewer');await m.syncEpochInvitationOperations();return id},{teamId,d})
  const incomingD=await D.evaluate(async teamId=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');return(await m.listEpochInvites()).invites.find(x=>x.teamId===teamId)!},teamId)
  await D.evaluate(async item=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');await m.queueEpochAcceptance(item)},incomingD)
  let consent:any
  const acceptUrl='**/teams/v2/'+teamId+'/invites/'+inviteD+'/accept'
  await D.route(acceptUrl,r=>{consent=r.request().postDataJSON();return r.abort('internetdisconnected')})
  try{await sync(D)}catch{}await D.unroute(acceptUrl)
  await A.evaluate(async({teamId,b})=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');const member=(await m.listOwnerEpochRoster(teamId)).find(x=>x.recipientAccountId===b&&x.state==='accepted')!;await m.queueEpochMembershipChange(teamId,member,'remove',null);await m.syncEpochInvitationOperations()},{teamId,b})
  await A.evaluate(async teamId=>{const m=await import('/src/features/people/application/team-epochs.ts');await m.queueTeamKeyRotation(teamId)},teamId)
  let rotation:any
  const epochUrl='**/teams/v1/'+teamId+'/epoch'
  await A.route(epochUrl,r=>{rotation=r.request().postDataJSON();return r.abort('internetdisconnected')})
  try{await A.evaluate(async()=>{const m=await import('/src/features/people/application/team-epochs.ts');await m.syncTeamKeyRotations()})}catch{}
  await A.unroute(epochUrl)
  const retired=JSON.parse(rotation.contract).retiredPendingInviteIds
  check('epoch-four-exact-pending-v2-retirement',JSON.stringify(retired)===JSON.stringify([inviteD]),{count:retired.length,exact:JSON.stringify(retired)===JSON.stringify([inviteD])})
  const wrongLists=await A.evaluate(async({teamId,rotation,inviteD})=>{
    const s=await import('/src/features/identity/application/session.ts'),k=await import('/src/features/identity/infrastructure/crypto.ts'),api=await import('/src/features/identity/infrastructure/api.ts')
    const out:Record<string,number>={}
    for(const mode of ['omitted','foreign','extra','duplicate','forged']){
      const c=JSON.parse(rotation.contract);c.operationId=crypto.randomUUID()
      c.retiredPendingInviteIds=mode==='omitted'?[]:mode==='foreign'?[crypto.randomUUID()]:mode==='extra'?[inviteD,crypto.randomUUID()].sort():mode==='duplicate'?[inviteD,inviteD]:[crypto.randomUUID()]
      const contract=JSON.stringify(c),signature=mode==='forged'?rotation.signature:await k.sign(await k.importSigner(s.requireSession().pkg.accountPkcs8),'pb3.team-key-epoch.v1\n'+contract)
      try{await api.jsonApi('/teams/v1/'+teamId+'/epoch','POST',{contract,signature});out[mode]=201}catch(e){out[mode]=Number((e as Error).message.split('_').pop())}
    }return out
  },{teamId,rotation,inviteD})
  for(const[mode,value]of Object.entries(wrongLists))check('v2-retirement-'+mode,value===({omitted:409,foreign:409,extra:409,duplicate:422,forged:401}as any)[mode],{status:value})
  const deviceD=await D.evaluate(async()=>{const s=await import('/src/features/identity/application/session.ts');return s.requireSession().deviceId})
  scope({teamId,ownerAccountId:a,ownerDeviceId,recipientAccountId:d,recipientDeviceId:deviceD,inviteId:inviteD,consent,rotation})
  const race=await overlappingWrites()
  check('real-PostgreSQL-consent-rotation-overlap',race.waiters>=2&&race.rotation===201&&race.consent===409,race)
  await A.evaluate(async()=>{const m=await import('/src/features/people/application/team-epochs.ts');await m.syncTeamKeyRotations()})
  const dNotice=(await get(D,'/teams/v2/invites/received')).body.items.find((x:any)=>x.inviteId===inviteD)
  check('retired-v2-no-historical-envelope',dNotice.state==='revoked'&&Object.keys(dNotice).sort().join('|')==='inviteId|state|teamId',{state:dNotice.state,keys:Object.keys(dNotice).sort()})
  const roster=await A.evaluate(async teamId=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');return m.listOwnerEpochRoster(teamId)},teamId)
  check('epoch-four-roster-remains-verifiable',roster.filter(x=>x.state==='revoked').length===2,{revoked:roster.filter(x=>x.state==='revoked').length})
  const snapshot=await fixture('snapshot')
  check('epoch-four-database-invariants',snapshot.keyEpoch===4&&snapshot.epochRecords===3&&!snapshot.quarantined&&snapshot.pendingV2===0&&Object.values(snapshot.implicitGrants).every(x=>x===0),snapshot)
  const survivor=await open(C,acceptedC)
  check('v2-survivor-falls-back-to-current-grant',survivor.ok,survivor)
  await C.route(memberUrl,r=>r.fulfill({status:200,json:cOriginal}))
  await C.route(historyUrl,r=>r.fulfill({status:200,json:cHistory}))
  const oldEpoch=await open(C,acceptedC)
  await C.unroute(memberUrl);await C.unroute(historyUrl)
  check('v2-genuine-historical-epoch-replay-rejected',!oldEpoch.ok&&oldEpoch.error==='teams.verified_epoch_rollback',{error:oldEpoch.error})
  const currentPath='/teams/v1/'+teamId+'/epoch/member',currentUrl='**'+currentPath
  const current=(await get(C,currentPath)).body,currentHistory=(await get(C,'/teams/v1/'+teamId+'/epoch/history')).body
  const fork=await A.evaluate(async raw=>{const s=await import('/src/features/identity/application/session.ts'),k=await import('/src/features/identity/infrastructure/crypto.ts');const c=JSON.parse(raw);c.operationId=crypto.randomUUID();const contract=JSON.stringify(c);return {contract,signature:await k.sign(await k.importSigner(s.requireSession().pkg.accountPkcs8),'pb3.team-key-epoch.v1\n'+contract),contractHash:k.hex(await k.digest(new TextEncoder().encode(contract)))}},current.contract)
  const forkHistory=structuredClone(currentHistory);Object.assign(forkHistory.items.at(-1),fork)
  await C.route(currentUrl,r=>r.fulfill({status:200,json:{...current,...fork}}))
  await C.route(historyUrl,r=>r.fulfill({status:200,json:forkHistory}))
  const forked=await open(C,acceptedC)
  await C.unroute(currentUrl);await C.unroute(historyUrl)
  check('current-member-genuine-same-epoch-fork-rejected',!forked.ok&&forked.error==='teams.verified_epoch_fork',{error:forked.error})
  await A.evaluate(async({teamId,c})=>{const m=await import('/src/features/people/application/team-epoch-invitations.ts');const row=(await m.listOwnerEpochRoster(teamId)).find(x=>x.recipientAccountId===c&&x.state==='accepted')!;await m.queueEpochMembershipChange(teamId,row,'change_role','contributor');await m.syncEpochInvitationOperations()},{teamId,c})
  const currentRole=await open(C,acceptedC)
  check('current-grant-post-rotation-role-read',currentRole.ok&&currentRole.role==='contributor'&&(await open(C,acceptedC)).ok,currentRole)
  const newCurrent=(await get(C,currentPath)).body,newHistory=(await get(C,'/teams/v1/'+teamId+'/epoch/history')).body
  await C.route(currentUrl,r=>r.fulfill({status:200,json:{...newCurrent,latestRoleEvent:null,effectiveRole:'viewer'}}))
  const replayRole=await open(C,acceptedC);await C.unroute(currentUrl)
  check('current-grant-role-replay-rejected',!replayRole.ok,{error:replayRole.error})
  await C.route(currentUrl,r=>r.fulfill({status:200,json:{...newCurrent,membershipRevision:1000000}}))
  await C.route(historyUrl,r=>r.fulfill({status:200,json:{...newHistory,membershipRevision:1000000}}))
  const highCurrent=await open(C,acceptedC)
  await C.unroute(currentUrl);await C.unroute(historyUrl)
  check('current-grant-unsigned-revision-not-durable',highCurrent.ok&&(await open(C,acceptedC)).ok,{inflated:highCurrent.ok,legitimate:(await open(C,acceptedC)).ok})
  await C.route(currentUrl,async r=>{const response=await r.fetch();await C.evaluate(async()=>{const s=await import('/src/features/identity/application/session.ts');(window as any).__v2AuditSession=s.requireSession();s.activeSession.value={...s.requireSession(),accountId:crypto.randomUUID()}});await r.fulfill({response})})
  const changedAccount=await open(C,acceptedC);await C.unroute(currentUrl)
  await C.evaluate(async()=>{const s=await import('/src/features/identity/application/session.ts');s.activeSession.value=(window as any).__v2AuditSession;delete(window as any).__v2AuditSession})
  check('current-grant-account-switch-rejected',changedAccount.error==='identity.changed',{error:changedAccount.error})
  await rememberDek()
  check('B-and-D-no-new-epoch-key',(await get(B,'/teams/v1/'+teamId+'/epoch/member')).status===404&&(await get(D,'/teams/v1/'+teamId+'/epoch/member')).status===404,{B:404,D:404})
  const local=await sealed(A)
  check('v2-outbox-private-storage',![a,b,c,d,teamId,...canaries,'recipientKeyDigest','keyEpochHash'].some(x=>local.raw.includes(x)),{ciphertextHash:local.hash})
}
