import {test,expect,type Page} from '@playwright/test'
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {v2Journey} from './v2-journey'

// Real runtime modules and real HTTP/PG. Only adversarial response delivery is
// intercepted; no replacement keys, successful network responses or crypto.
async function enroll(p:Page){
  await p.goto('/settings')
  await p.getByRole('button',{name:'Создать ключ'}).click()
  await p.getByLabel('Я сохранил ключ восстановления').check()
  await p.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(p.getByText('Подтверждённая сессия')).toBeVisible()
  return p.evaluate(async()=>{
    const s=await import('/src/features/identity/application/session.ts')
    const d=await import('/src/features/sharing/key-directory.ts')
    await d.ensureOwnExchangeKey()
    return s.requireSession().accountId
  })
}
async function contact(p:Page,id:string){
  await p.evaluate(async id=>{
    const d=await import('/src/features/sharing/key-directory.ts')
    const c=await import('/src/features/people/application/contact-book.ts')
    const {directory}=await d.inspectPeer(id)
    await d.confirmPeer(id,directory.safetyFingerprint)
    await c.saveConfirmedContact(id,directory.safetyFingerprint,'Audit peer')
  },id)
}
async function get(p:Page,path:string){return p.evaluate(async path=>{
  const r=await fetch(path,{headers:{Accept:'application/json'},cache:'no-store'})
  return {status:r.status,body:await r.json()}
},path)}
async function accepted(p:Page,teamId:string){return p.evaluate(async teamId=>{
  const m=await import('/src/features/people/application/team-invitations.ts')
  const i=(await m.listIncomingTeamInvites()).invites.find(i=>i.teamId===teamId)!
  await m.queueTeamAcceptance(i);await m.syncTeamMemberOperations()
  return (await m.listIncomingTeamInvites()).invites.find(i=>i.teamId===teamId)!
},teamId)}
async function rows(p:Page){return p.evaluate(async()=>{
  const c=await import('/src/features/identity/infrastructure/crypto.ts')
  const raw=await new Promise<string>((resolve,reject)=>{
    const r=indexedDB.open('pb3-encrypted-team-epochs-v1')
    r.onerror=()=>reject(r.error)
    r.onsuccess=()=>{const db=r.result,t=db.transaction('operations'),q=t.objectStore('operations').getAll()
      t.oncomplete=()=>{resolve(JSON.stringify(q.result));db.close()};t.onerror=()=>reject(t.error)}
  })
  return {raw,sha256:c.hex(await c.digest(new TextEncoder().encode(raw)))}
})}
async function localMemberStorage(p:Page){return p.evaluate(async()=>{
  const k=await import('/src/features/identity/infrastructure/crypto.ts')
  const raw=await new Promise<Record<string,unknown[]>>((resolve,reject)=>{
    const r=indexedDB.open('pb3-encrypted-team-members-v1')
    r.onerror=()=>reject(r.error)
    r.onsuccess=()=>{const db=r.result,t=db.transaction(['joined','freshness']),out:Record<string,unknown[]>={}
      for(const name of ['joined','freshness']){const q=t.objectStore(name).getAll();q.onsuccess=()=>{out[name]=q.result}}
      t.oncomplete=()=>{db.close();resolve(out)};t.onerror=()=>reject(t.error)}
  })
  const text=JSON.stringify(raw)
  return {raw:text,sha256:k.hex(await k.digest(new TextEncoder().encode(text))),
    freshnessCount:raw.freshness.length,joinedCount:raw.joined.length}
})}

test('independent real A→B→C: epoch integrity, failure recovery and rollback boundaries',async({browser},info)=>{
  const contexts=await Promise.all([0,1,2,3].map(()=>browser.newContext()))
  const [A,B,C,D]=await Promise.all(contexts.map(c=>c.newPage()))
  const proofs:Array<{id:string;status:'PASS'|'FAIL';actual:unknown}>=[]
  function check(id:string,ok:boolean,actual:unknown){
    proofs.push({id,status:ok?'PASS':'FAIL',actual})
    expect.soft(ok,id).toBe(true)
  }
  try{
    const a=await enroll(A),b=await enroll(B),c=await enroll(C),d=await enroll(D)
    await contact(A,b);await contact(A,c);await contact(A,d)
    await contact(B,a);await contact(C,a);await contact(D,a)
    const canaries=['team-'+crypto.randomUUID(),'private-'+crypto.randomUUID()]
    writeFileSync(join(process.env.PB3_ACCEPTANCE_ARTIFACTS!,'private-canaries.json'),JSON.stringify(canaries),{mode:0o600})
    const teamId=await A.evaluate(async([name,description])=>{
      const m=await import('/src/features/people/application/team-book.ts')
      const t=await m.queueTeam(name,description);await m.syncQueuedTeams();return t.teamId
    },canaries)
    for(const id of [b,c,d])await A.evaluate(async({teamId,id})=>{
      const m=await import('/src/features/people/application/team-invitations.ts')
      await m.queueTeamInvitation(teamId,id,'viewer');await m.syncTeamMemberOperations()
    },{teamId,id})
    const inviteB=await accepted(B,teamId),inviteC=await accepted(C,teamId)
    const pendingD=(await D.evaluate(async()=>{
      const m=await import('/src/features/people/application/team-invitations.ts')
      return m.listIncomingTeamInvites()
    })).invites.find(i=>i.teamId===teamId)!
    const before=await C.evaluate(async invite=>{
      const e=await import('/src/features/people/application/team-epochs.ts')
      return e.openAnyJoinedTeam(invite)
    },inviteC)
    check('consented-C-decrypts-v1',before.name===canaries[0],{role:before.role})
    const oldMember=await get(C,'/teams/v1/'+teamId+'/member')
    await A.evaluate(async({teamId,b})=>{
      const m=await import('/src/features/people/application/team-invitations.ts')
      const member=(await m.listOwnerTeamRoster(teamId)).find(x=>x.recipientAccountId===b)!
      await m.queueTeamMembershipChange(teamId,member,'change_role','contributor')
      await m.syncTeamMemberOperations()
    },{teamId,b})
    const changed=await B.evaluate(async invite=>{
      const e=await import('/src/features/people/application/team-epochs.ts')
      return e.openAnyJoinedTeam(invite)
    },inviteB)
    check('signed-role-change',changed.role==='contributor',{role:changed.role})
    const roleReadAgain=await B.evaluate(async invite=>{
      const e=await import('/src/features/people/application/team-epochs.ts')
      try{return {ok:true,role:(await e.openAnyJoinedTeam(invite)).role,error:null}}
      catch(e){return {ok:false,role:null,error:(e as Error).message}}
    },inviteB)
    check('v1-role-change-repeated-live-read',roleReadAgain.ok&&roleReadAgain.role==='contributor',roleReadAgain)
    // Independent revision CAS: submit two valid owner signatures from the same
    // revision. One remove wins, the second operation must conflict.
    const race=await A.evaluate(async({teamId,b})=>{
      const m=await import('/src/features/people/application/team-invitations.ts')
      const s=await import('/src/features/identity/application/session.ts')
      const k=await import('/src/features/identity/infrastructure/crypto.ts')
      const api=await import('/src/features/identity/infrastructure/api.ts')
      const member=(await m.listOwnerTeamRoster(teamId)).find(x=>x.recipientAccountId===b)!
      const h=await m.verifiedTeamMembershipHistory(teamId)
      const payload={version:1,operationId:crypto.randomUUID(),teamId,ownerAccountId:s.requireSession().accountId,
        inviteId:member.inviteId,targetAccountId:b,action:'remove',previousRole:member.role,nextRole:null,fromRevision:h.revision,toRevision:h.revision+1}
      async function send(id:string){const contract=JSON.stringify({...payload,operationId:id})
        const signature=await k.sign(await k.importSigner(s.requireSession().pkg.accountPkcs8),'pb3.team-membership.v1\n'+contract)
        try{await api.jsonApi('/teams/v1/'+teamId+'/membership','POST',{contract,signature});return 201}
        catch(e){return Number((e as Error).message.split('_').pop())}}
      return Promise.all([send(payload.operationId),send(crypto.randomUUID())])
    },{teamId,b})
    check('revision-race-serialized',race.sort().join(',')==='201,409',{statuses:race})
    const cSuspended=await get(C,'/teams/v1/'+teamId+'/epoch/member')
    const bRemoved=await get(B,'/teams/v1/'+teamId+'/epoch/member')
    const dInbox=await get(D,'/teams/v1/invites/received')
    check('quarantine-no-old-key',cSuspended.status===409&&bRemoved.status===404
      &&Object.keys(dInbox.body.items[0]).sort().join('|')==='inviteId|state|teamId',
      {C:cSuspended.status,B:bRemoved.status,pendingNoticeKeys:Object.keys(dInbox.body.items[0]).sort()})
    await A.evaluate(async teamId=>{
      const e=await import('/src/features/people/application/team-epochs.ts')
      await e.queueTeamKeyRotation(teamId)
    },teamId)
    const sealed=await rows(A)
    check('encrypted-outbox-no-plaintext',![...canaries,a,b,c,d,teamId,'privateEnvelope','recipientKeyDigest'].some(v=>sealed.raw.includes(v)),{sha256:sealed.sha256})
    let command:{contract:string;signature:string}|undefined
    const epochUrl='**/teams/v1/'+teamId+'/epoch'
    await A.route(epochUrl,async route=>{command=route.request().postDataJSON();await route.abort('internetdisconnected')})
    const outage=await A.evaluate(async()=>{
      const e=await import('/src/features/people/application/team-epochs.ts')
      try{await e.syncTeamKeyRotations();return 'unexpected_success'}catch{return 'network_error'}
    })
    await A.unroute(epochUrl)
    check('outage-keeps-exact-ciphertext',outage==='network_error'&&(await rows(A)).sha256===sealed.sha256,{outage})
    expect(command).toBeDefined()
    const retirementIds=JSON.parse(command!.contract).retiredPendingInviteIds
    check('exact-signed-pending-retirement',JSON.stringify(retirementIds)===JSON.stringify([pendingD.inviteId]),{count:retirementIds?.length,exact:JSON.stringify(retirementIds)===JSON.stringify([pendingD.inviteId])})
    const negative=await A.evaluate(async({teamId,command,b})=>{
      const s=await import('/src/features/identity/application/session.ts')
      const k=await import('/src/features/identity/infrastructure/crypto.ts')
      const api=await import('/src/features/identity/infrastructure/api.ts')
      const original=JSON.parse(command.contract),signer=await k.importSigner(s.requireSession().pkg.accountPkcs8)
      const out:Record<string,number>={}
      for(const mode of ['forged-signature','wrong-domain','omitted-recipient','wrong-role','changed-directory','wrong-revision','wrong-previous-hash','duplicate-recipient','removed-recipient','missing-retirements','omitted-retirement','duplicate-retirement','changed-retirement','surplus-retirement','unsigned-retirement-change']){
        const c=structuredClone(original);c.operationId=crypto.randomUUID()
        if(mode==='omitted-recipient')c.recipients=[]
        if(mode==='wrong-role')c.recipients[0].role='curator'
        if(mode==='changed-directory')c.recipients[0].recipientKeyDigest='f'.repeat(64)
        if(mode==='wrong-revision')c.membershipRevision++
        if(mode==='wrong-previous-hash')c.previousEpochHash='f'.repeat(64)
        if(mode==='duplicate-recipient')c.recipients.push(structuredClone(c.recipients[0]))
        if(mode==='removed-recipient'){c.recipients.push({...structuredClone(c.recipients[0]),accountId:b});c.recipients.sort((a:any,b:any)=>a.accountId.localeCompare(b.accountId))}
        if(mode==='missing-retirements')delete c.retiredPendingInviteIds
        if(mode==='omitted-retirement')c.retiredPendingInviteIds=[]
        if(mode==='duplicate-retirement')c.retiredPendingInviteIds.push(c.retiredPendingInviteIds[0])
        if(mode==='changed-retirement'||mode==='unsigned-retirement-change')c.retiredPendingInviteIds=[crypto.randomUUID()]
        if(mode==='surplus-retirement')c.retiredPendingInviteIds.push(crypto.randomUUID())
        c.retiredPendingInviteIds?.sort()
        const contract=JSON.stringify(c)
        const signature=mode==='unsigned-retirement-change'?command.signature:mode==='forged-signature'?k.b64(k.random(64)):
          await k.sign(signer,(mode==='wrong-domain'?'pb3.team-create.v1\n':'pb3.team-key-epoch.v1\n')+contract)
        try{await api.jsonApi('/teams/v1/'+teamId+'/epoch','POST',{contract,signature});out[mode]=201}
        catch(e){out[mode]=Number((e as Error).message.split('_').pop())}
      }
      return out
    },{teamId,command:command!,b})
    const expected:Record<string,number>={'forged-signature':401,'wrong-domain':401,'omitted-recipient':409,'wrong-role':409,'changed-directory':409,'wrong-revision':409,'wrong-previous-hash':409,'duplicate-recipient':422,'removed-recipient':409,'missing-retirements':422,'omitted-retirement':409,'duplicate-retirement':422,'changed-retirement':409,'surplus-retirement':409,'unsigned-retirement-change':401}
    for(const [id,status]of Object.entries(negative))check(id,status===expected[id],{status,expected:expected[id]})
    check('negative-writes-atomic',(await get(A,'/teams/v1/'+teamId+'/epoch/owner')).body.keyEpoch===1,{keyEpoch:1})
    // Deliver to the real server, lose only its ACK, reload, replay exact bytes.
    const requests:string[]=[];let committedStatus=0
    await A.route(epochUrl,async route=>{
      requests.push(route.request().postData()!)
      const response=await route.fetch();committedStatus=response.status()
      await route.abort('connectionreset')
    })
    await A.evaluate(async()=>{const e=await import('/src/features/people/application/team-epochs.ts');try{await e.syncTeamKeyRotations()}catch{}})
    await A.unroute(epochUrl)
    const afterLost=await rows(A)
    await A.reload();await expect(A.getByText('Подтверждённая сессия')).toBeVisible()
    check('reload-retains-unacked-ciphertext',(await rows(A)).sha256===afterLost.sha256&&afterLost.sha256===sealed.sha256,{sha256:afterLost.sha256,serverCommitStatus:committedStatus})
    let replayAck:any
    await A.route(epochUrl,async route=>{
      requests.push(route.request().postData()!)
      const response=await route.fetch();replayAck={status:response.status(),...await response.json()}
      await route.fulfill({response})
    })
    await A.evaluate(async()=>{const e=await import('/src/features/people/application/team-epochs.ts');await e.syncTeamKeyRotations()})
    await A.unroute(epochUrl)
    check('lost-ack-exact-idempotent-replay',committedStatus===201&&requests.length===2&&requests[0]===requests[1]&&replayAck.status===200&&replayAck.unchanged===true,{commit:committedStatus,replay:replayAck.status,unchanged:replayAck.unchanged,identicalBytes:requests[0]===requests[1]})
    const cNew=await C.evaluate(async invite=>{const e=await import('/src/features/people/application/team-epochs.ts');return e.openAnyJoinedTeam(invite)},inviteC)
    const bAfter=await get(B,'/teams/v1/'+teamId+'/epoch/member')
    check('C-decrypts-new-epoch-B-denied',cNew.name===canaries[0]&&bAfter.status===404,{B:bAfter.status,Crole:cNew.role})
    const floorBeforeReload=await localMemberStorage(C)
    check('freshness-encrypted-at-rest',floorBeforeReload.freshnessCount===1&&![...canaries,a,b,c,d,teamId,'contractHash','keyEpoch','membershipRevision'].some(v=>floorBeforeReload.raw.includes(v)),{freshnessRows:floorBeforeReload.freshnessCount,sha256:floorBeforeReload.sha256})
    await C.reload();await expect(C.getByText('Подтверждённая сессия')).toBeVisible()
    const floorAfterReload=await localMemberStorage(C)
    check('freshness-persists-full-reload',floorBeforeReload.sha256===floorAfterReload.sha256,{sha256:floorAfterReload.sha256})
    const material=await A.evaluate(async({teamId,command})=>{
      const s=await import('/src/features/identity/application/session.ts')
      const k=await import('/src/features/identity/infrastructure/crypto.ts')
      const t=await import('/src/features/people/application/team-book.ts')
      const c=JSON.parse(command.contract),enc=new TextEncoder()
      const akek=await crypto.subtle.importKey('raw',k.unb64(s.requireSession().pkg.akek,32),{name:'AES-GCM'},false,['decrypt'])
      const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:k.unb64(c.privateEnvelope.wrappedKey.iv,12),additionalData:enc.encode('pb3.team-owner-key-epoch.v1\n'+c.ownerAccountId+'\n'+teamId+'\n2\n'+c.membershipRevision)},akek,k.unb64(c.privateEnvelope.wrappedKey.ciphertext)))
      const newKey=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt'])
      const aad=enc.encode('pb3.team-profile-epoch.v1\n'+c.ownerAccountId+'\n'+teamId+'\n2\n'+c.membershipRevision+'\n'+c.previousEpochHash)
      const args={name:'AES-GCM',iv:k.unb64(c.privateEnvelope.iv,12),additionalData:aad}
      const plaintext=await crypto.subtle.decrypt(args,newKey,k.unb64(c.privateEnvelope.ciphertext))
      let fresh=false,oldKeyRejected=false,badAadRejected=false
      await t.withOwnerTeamDEK(teamId,async(old:any)=>{fresh=k.b64(old)!==k.b64(raw)
        const oldKey=await crypto.subtle.importKey('raw',old,{name:'AES-GCM'},false,['decrypt'])
        try{await crypto.subtle.decrypt(args,oldKey,k.unb64(c.privateEnvelope.ciphertext))}catch{oldKeyRejected=true}})
      const bad=new Uint8Array(aad);bad[bad.length-1]^=1
      try{await crypto.subtle.decrypt({...args,additionalData:bad},newKey,k.unb64(c.privateEnvelope.ciphertext))}catch{badAadRejected=true}
      raw.fill(0)
      return {fresh,oldKeyRejected,badAadRejected,ownerDecrypts:JSON.parse(new TextDecoder().decode(plaintext)).name.length>0}
    },{teamId,command:command!})
    check('fresh-independent-DEK-and-AEAD-binding',Object.values(material).every(Boolean),material)
    // Pending v1 invitations are revoked atomically. The owner must still be
    // able to verify its roster and perform the next signed membership action.
    const rosterAfter=await A.evaluate(async teamId=>{
      const m=await import('/src/features/people/application/team-invitations.ts')
      try{return {ok:true,count:(await m.listOwnerTeamRoster(teamId)).length,error:null}}
      catch(e){return {ok:false,count:null,error:(e as Error).message}}
    },teamId)
    check('owner-roster-after-pending-invite-sweep',rosterAfter.ok,rosterAfter)
    const nextRemoval=await A.evaluate(async({teamId,c,inviteId,expiresAt})=>{
      const m=await import('/src/features/people/application/team-invitations.ts')
      const member={inviteId,recipientAccountId:c,role:'viewer',state:'accepted',expiresAt}
      try{await m.queueTeamMembershipChange(teamId,member as any,'remove',null);return 'queued'}
      catch(e){return (e as Error).message}
    },{teamId,c,inviteId:inviteC.inviteId,expiresAt:inviteC.expiresAt})
    check('next-membership-action-remains-available',nextRemoval==='queued',{error:nextRemoval})
    const acceptAfter=await D.evaluate(async invite=>{
      const m=await import('/src/features/people/application/team-invitations.ts')
      try{await m.queueTeamAcceptance(invite);await m.syncTeamMemberOperations();return 'queued-or-conflict'}
      catch(e){return (e as Error).message}
    },pendingD)
    const dAfter=await get(D,'/teams/v1/'+teamId+'/epoch/member')
    check('pending-old-invite-cannot-join-new-epoch',dAfter.status===404,{memberStatus:dAfter.status,acceptAfter})
    // Tamper only transport responses; signatures are not recomputed.
    const memberResponse=await get(C,'/teams/v1/'+teamId+'/epoch/member')
    const memberUrl='**/teams/v1/'+teamId+'/epoch/member'
    const tampered={...memberResponse.body,contract:memberResponse.body.contract.replace('"toEpoch":2','"toEpoch":3')}
    await C.route(memberUrl,r=>r.fulfill({status:200,json:tampered}))
    const tamper=await C.evaluate(async invite=>{const e=await import('/src/features/people/application/team-epochs.ts');try{await e.openAnyJoinedTeam(invite);return 'accepted'}catch(e){return (e as Error).message}},inviteC)
    await C.unroute(memberUrl)
    check('tampered-epoch-response-rejected',tamper!=='accepted',{error:tamper})
    const keyUrl='**/shares/v1/keys/'+a
    await C.route(keyUrl,async r=>{const response=await r.fetch();const value=await response.json();value.descriptorHash='f'.repeat(64);await r.fulfill({status:200,json:value})})
    const changedKey=await C.evaluate(async invite=>{const e=await import('/src/features/people/application/team-epochs.ts');try{await e.openAnyJoinedTeam(invite);return 'accepted'}catch(e){return (e as Error).message}},inviteC)
    await C.unroute(keyUrl)
    check('changed-owner-directory-rejected',changedKey!=='accepted',{error:changedKey})
    // A coherent, previously valid signed snapshot is different from tampering.
    // Returning to epoch 1 AFTER verifying epoch 2 must fail closed.
    await C.route(memberUrl,r=>r.fulfill({status:200,json:{teamId,keyEpoch:1}}))
    const oldUrl='**/teams/v1/'+teamId+'/member'
    await C.route(oldUrl,r=>r.fulfill({status:200,json:oldMember.body}))
    const rollback=await C.evaluate(async invite=>{const e=await import('/src/features/people/application/team-epochs.ts');try{await e.openAnyJoinedTeam(invite);return 'accepted-old-epoch'}catch(e){return (e as Error).message}},inviteC)
    await C.unroute(memberUrl);await C.unroute(oldUrl)
    check('known-epoch-rollback-rejected',rollback==='teams.verified_epoch_rollback',{result:rollback,previouslyVerifiedEpoch:2,replayedEpoch:1})
    check('rollback-keeps-encrypted-offline-snapshot',(await localMemberStorage(C)).sha256===floorAfterReload.sha256,{unchanged:(await localMemberStorage(C)).sha256===floorAfterReload.sha256})
    // Account/device replacement while awaiting HTTP must never publish a
    // joined profile into a different account's encrypted cache.
    await C.route(memberUrl,async r=>{
      const response=await r.fetch()
      await C.evaluate(async()=>{const m=await import('/src/features/identity/application/session.ts');const old=m.requireSession();(window as any).__auditSession=old;m.activeSession.value={...old,accountId:crypto.randomUUID()}})
      await r.fulfill({response})
    })
    const switched=await C.evaluate(async invite=>{const e=await import('/src/features/people/application/team-epochs.ts');try{await e.openAnyJoinedTeam(invite);return 'accepted'}catch(e){return (e as Error).message}},inviteC)
    await C.unroute(memberUrl)
    await C.evaluate(async()=>{const m=await import('/src/features/identity/application/session.ts');m.activeSession.value=(window as any).__auditSession;delete(window as any).__auditSession})
    check('account-switch-midflight-rejected',switched==='identity.changed',{error:switched})
    const cache=await C.evaluate(async()=>{const m=await import('/src/features/people/application/team-invitations.ts');return (await m.listCachedJoinedTeams()).length})
    check('verified-cache-preserved-through-errors',cache===1,{count:cache})
    const historyUrl='**/teams/v1/'+teamId+'/epoch/history'
    const originalHistory=(await get(C,'/teams/v1/'+teamId+'/epoch/history')).body
    const fork=await A.evaluate(async command=>{
      const s=await import('/src/features/identity/application/session.ts')
      const k=await import('/src/features/identity/infrastructure/crypto.ts')
      const c=JSON.parse(command.contract);c.operationId=crypto.randomUUID()
      const contract=JSON.stringify(c)
      return {contract,signature:await k.sign(await k.importSigner(s.requireSession().pkg.accountPkcs8),'pb3.team-key-epoch.v1\n'+contract),
        contractHash:k.hex(await k.digest(new TextEncoder().encode(contract)))}
    },command!)
    const forkedHistory=structuredClone(originalHistory)
    Object.assign(forkedHistory.items[0],fork)
    await C.route(memberUrl,r=>r.fulfill({status:200,json:{...memberResponse.body,...fork}}))
    await C.route(historyUrl,r=>r.fulfill({status:200,json:forkedHistory}))
    const forkResult=await C.evaluate(async invite=>{const e=await import('/src/features/people/application/team-epochs.ts');try{await e.openAnyJoinedTeam(invite);return 'accepted'}catch(e){return(e as Error).message}},inviteC)
    await C.unroute(memberUrl);await C.unroute(historyUrl)
    check('genuine-signed-same-epoch-fork-rejected',forkResult==='teams.verified_epoch_fork',{error:forkResult})
    const lowerRevision=memberResponse.body.membershipRevision-1
    await C.route(memberUrl,r=>r.fulfill({status:200,json:{...memberResponse.body,membershipRevision:lowerRevision}}))
    await C.route(historyUrl,r=>r.fulfill({status:200,json:{...originalHistory,membershipRevision:lowerRevision}}))
    const revisionResult=await C.evaluate(async invite=>{const e=await import('/src/features/people/application/team-epochs.ts');try{await e.openAnyJoinedTeam(invite);return 'accepted'}catch(e){return(e as Error).message}},inviteC)
    await C.unroute(memberUrl);await C.unroute(historyUrl)
    check('membership-revision-rollback-rejected',revisionResult!=='accepted',{error:revisionResult})
    // Unsigned response metadata must not poison a cryptographically verified
    // watermark. A rolled-back/malicious origin has no owner signer here.
    await C.route(memberUrl,r=>r.fulfill({status:200,json:{...memberResponse.body,membershipRevision:1000000}}))
    await C.route(historyUrl,r=>r.fulfill({status:200,json:{...originalHistory,membershipRevision:1000000}}))
    const inflated=await C.evaluate(async invite=>{const e=await import('/src/features/people/application/team-epochs.ts');try{await e.openAnyJoinedTeam(invite);return 'accepted'}catch(e){return(e as Error).message}},inviteC)
    await C.unroute(memberUrl);await C.unroute(historyUrl)
    const legitAfterInflation=await C.evaluate(async invite=>{const e=await import('/src/features/people/application/team-epochs.ts');try{await e.openAnyJoinedTeam(invite);return 'accepted'}catch(e){return(e as Error).message}},inviteC)
    check('unsigned-revision-cannot-poison-freshness',legitAfterInflation==='accepted',{inflatedRead:inflated,legitimateRead:legitAfterInflation})
    await contexts[2].setOffline(true)
    const offline=await C.evaluate(async()=>{const m=await import('/src/features/people/application/team-invitations.ts');const rows=await m.listCachedJoinedTeams();return {count:rows.length,local:rows.every(x=>!x.verifiedOnline)}})
    await contexts[2].setOffline(false)
    check('offline-cache-survives-hostile-responses',offline.count===1&&offline.local,offline)
    // Separate pages in the same browser profile exercise real cross-tab IDB
    // serialization. These synthetic stamps test storage atomicity, not an
    // invented cryptographic acceptance of an unsigned epoch.
    const tab=await contexts[2].newPage();await tab.goto('/settings')
    await expect(tab.getByText('Подтверждённая сессия')).toBeVisible()
    const raceTeam=crypto.randomUUID()
    const view={teamId:raceTeam,ownerAccountId:a,name:canaries[0],description:canaries[1],role:'viewer',verifiedOnline:true}
    const tabResults=await Promise.all([C,tab].map((p,i)=>p.evaluate(async({view,i})=>{
      const m=await import('/src/features/people/application/team-invitations.ts')
      const s=await import('/src/features/identity/application/session.ts')
      try{await m.cacheVerifiedJoinedTeam(view as any,s.requireSession().accountId,{keyEpoch:i===0?3:2,contractHash:(i===0?'c':'b').repeat(64),membershipRevision:i===0?4:3});return 'stored'}
      catch(e){return(e as Error).message}
    },{view,i})))
    const tabFloor=await tab.evaluate(async({teamId,ownerAccountId})=>{
      const m=await import('/src/features/people/application/team-invitations.ts')
      try{await m.assertVerifiedTeamEpochNotOlder(teamId,ownerAccountId,{keyEpoch:2,contractHash:'b'.repeat(64),membershipRevision:3});return 'accepted-old'}
      catch(e){return(e as Error).message}
    },{teamId:raceTeam,ownerAccountId:a})
    check('real-tabs-serialize-freshness',tabResults[0]==='stored'&&tabFloor==='teams.verified_epoch_rollback',{writes:tabResults,olderRead:tabFloor})
    await tab.close()
    // The preceding successful queue call for C's removal is finally sent.
    // Owner roster verification must still accept D's signed epoch-2 retirement.
    await A.evaluate(async()=>{const m=await import('/src/features/people/application/team-invitations.ts');await m.syncTeamMemberOperations()})
    const epoch3=await A.evaluate(async teamId=>{
      const m=await import('/src/features/people/application/team-epochs.ts')
      await m.queueTeamKeyRotation(teamId);await m.syncTeamKeyRotations()
      const status=await m.ownerEpochStatus(teamId),contract=JSON.parse(status.contract)
      return {epoch:status.keyEpoch,quarantine:status.rotationRequired,recipients:contract.recipients.length,retirements:contract.retiredPendingInviteIds.length}
    },teamId)
    const cRemoved=await get(C,'/teams/v1/'+teamId+'/epoch/member')
    check('remove-C-and-complete-epoch-three',epoch3.epoch===3&&!epoch3.quarantine&&epoch3.recipients===0&&epoch3.retirements===0&&cRemoved.status===404,{...epoch3,Cstatus:cRemoved.status})
    await v2Journey(A,B,C,D,teamId,a,b,c,d,canaries,check)
  }finally{
    await info.attach('audit-proof',{body:JSON.stringify(proofs),contentType:'application/json'})
    await Promise.all(contexts.map(c=>c.close()))
  }
})
