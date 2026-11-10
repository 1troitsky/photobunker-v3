import { test, expect } from '@playwright/test'

test('P1-28: independently confirmed A→B Teams invite → recipient consent → E2EE team read',async({browser})=>{
  test.setTimeout(390000)
  const ctxA=await browser.newContext(),ctxB=await browser.newContext()
  const ctxC=await browser.newContext(),ctxD=await browser.newContext()
  const A=await ctxA.newPage(),B=await ctxB.newPage()
  const C=await ctxC.newPage(),D=await ctxD.newPage()
  async function enroll(page:typeof A):Promise<string>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    return page.evaluate(async()=>{
      const mod=await import('/src/features/identity/application/session.ts')
      return mod.requireSession().accountId
    })
  }
  async function prepareDirectory(page:typeof A):Promise<void>{
    await page.goto('/browser')
    await expect(page.getByText('Ключ обмена подготовлен'))
      .toBeVisible({timeout:20000})
  }
  async function confirmContact(page:typeof A,id:string,alias:string):Promise<void>{
    await page.goto('/contacts')
    await page.getByTestId('contacts-lookup-id').fill(id)
    await page.getByRole('button',{name:'Проверить ключ'}).click()
    await expect(page.getByTestId('contacts-fingerprint')).toBeVisible()
    await page.getByTestId('contacts-fingerprint-ack').check()
    await page.getByRole('button',{name:'Подтвердить отпечаток'}).click()
    await expect(page.getByText('Ключ подтверждён на этом устройстве.'))
      .toBeVisible()
    await page.getByTestId('contacts-alias').fill(alias)
    await page.getByRole('button',{name:'Добавить в контакты'}).click()
    await expect(page.getByTestId('contacts-row-'+id)).toContainText(alias)
  }
  try{
    const accountA=await enroll(A)
    const accountB=await enroll(B)
    const accountC=await enroll(C)
    const accountD=await enroll(D)
    await prepareDirectory(A)
    await prepareDirectory(B)
    await prepareDirectory(C)
    await prepareDirectory(D)
    await confirmContact(A,accountB,'Peer B')
    await confirmContact(A,accountC,'Peer C')
    await confirmContact(A,accountD,'Peer D')
    await confirmContact(B,accountA,'Peer A')
    await confirmContact(C,accountA,'Peer A')
    await A.getByRole('button',{name:/^Команды \(/}).click()
    await A.getByRole('button',{name:'Создать команду'}).click()
    await A.getByTestId('team-name').fill('TEAM SECRET PROOF')
    await A.getByLabel('Описание').first().fill('E2EE profile visible only to accepted users')
    await A.getByTestId('team-create-submit').click()
    await expect(A.getByTestId(/^team-row-/).getByText('TEAM SECRET PROOF')).toBeVisible()
    await expect(A.getByText('В облаке',{exact:false}))
      .toBeVisible({timeout:30000})
    const panel=A.getByTestId('team-membership-panel')
    await expect(panel.getByTestId('team-member-selector'))
      .toContainText('TEAM SECRET PROOF')
    await panel.getByTestId('team-member-selector').selectOption({label:'TEAM SECRET PROOF'})
    await panel.getByRole('button',{name:'Добавить участника'}).click()
    await panel.getByTestId('team-invite-contact').selectOption(accountB)
    await panel.getByTestId('team-invite-role').selectOption('viewer')
    await panel.getByTestId('team-invite-submit').click()
    await expect(panel.getByText('Приглашение отправлено',{exact:false}))
      .toBeVisible({timeout:30000})
    await expect(panel.getByTestId('team-member-'+accountB))
      .toContainText('Ожидает согласия')

    await B.getByRole('button',{name:/^Команды \(/}).click()
    const inbox=B.getByTestId('team-membership-panel')
    await expect(inbox.getByTestId('team-incoming-invites')).toBeVisible({timeout:30000})
    await expect(inbox.getByText('Наблюдатель')).toBeVisible()
    await inbox.getByRole('button',{name:'Принять'}).click()
    await expect(inbox.getByTestId('team-joined-list')).toBeVisible({timeout:30000})
    await expect(inbox.getByText('TEAM SECRET PROOF')).toBeVisible()
    await expect(inbox.getByText('E2EE profile visible only to accepted users'))
      .toBeVisible()

    // Add a second verified recipient before excluding B. C must survive
    // rotation with a fresh independent DEK; B must not receive its envelope.
    await panel.getByRole('button',{name:'Добавить участника'}).click()
    await panel.getByTestId('team-invite-contact').selectOption(accountC)
    await panel.getByTestId('team-invite-role').selectOption('viewer')
    await panel.getByTestId('team-invite-submit').click()
    await expect(panel.getByTestId('team-member-'+accountC))
      .toContainText('Ожидает согласия',{timeout:30000})
    await C.getByRole('button',{name:/^Команды \(/}).click()
    const survivor=C.getByTestId('team-membership-panel')
    await expect(survivor.getByTestId('team-incoming-invites'))
      .toBeVisible({timeout:30000})
    await survivor.getByRole('button',{name:'Принять'}).click()
    await expect(survivor.getByTestId('team-joined-list'))
      .toContainText('TEAM SECRET PROOF',{timeout:30000})
    // Preserve only in this test's memory: a GENUINE historical v1
    // invitation and signed member payload for hostile-origin rollback test.
    const originalC=await C.evaluate(async()=>{
      const m=await import('/src/features/people/application/team-invitations.ts')
      const received=await m.listIncomingTeamInvites()
      const invite=received.invites.find(x=>x.state==='accepted')
      if(!invite)throw Error('missing accepted historical invite')
      const res=await fetch('/teams/v1/'+invite.teamId+'/member',{
        credentials:'include',headers:{Accept:'application/json'},
      })
      if(!res.ok)throw Error('missing historical member response')
      return {invite,oldMember:await res.json() as unknown}
    })
    const teamId=originalC.invite.teamId

    // D must remain pending at the moment of rotation, to exercise the
    // independently signed exact-invite retirement proof T29B-01.
    await panel.getByRole('button',{name:'Добавить участника'}).click()
    await panel.getByTestId('team-invite-contact').selectOption(accountD)
    await panel.getByTestId('team-invite-role').selectOption('viewer')
    await panel.getByTestId('team-invite-submit').click()
    await expect(panel.getByTestId('team-member-'+accountD))
      .toContainText('Ожидает согласия',{timeout:30000})
    // Durable local member state is encrypted: neither team name nor
    // owner identity, plaintext consent, or Team DEK is indexed on disk.
    const encrypted=await B.evaluate(async()=>{
      return new Promise<string>((resolve,reject)=>{
        const req=indexedDB.open('pb3-encrypted-team-members-v1')
        req.onerror=()=>reject(req.error)
        req.onsuccess=()=>{
          const db=req.result
          const tx=db.transaction(['operations','joined'],'readonly')
          const a=tx.objectStore('operations').getAll()
          const b=tx.objectStore('joined').getAll()
          a.onerror=()=>reject(a.error)
          b.onerror=()=>reject(b.error)
          tx.oncomplete=()=>{
            resolve(JSON.stringify([...a.result,...b.result]))
            db.close()
          }
        }
      })
    })
    expect(encrypted).not.toContain('TEAM SECRET PROOF')
    expect(encrypted).not.toContain('E2EE profile visible only to accepted users')
    expect(encrypted).not.toContain(accountA)
    expect(encrypted).not.toContain('recipientAccountId')

    await panel.getByTestId('team-member-selector').selectOption('')
    await panel.getByTestId('team-member-selector').selectOption({label:'TEAM SECRET PROOF'})
    await expect(panel.getByTestId('team-member-'+accountB))
      .toContainText('Принято',{timeout:20000})
    await ctxB.setOffline(true)
    await inbox.getByRole('button',{name:'Обновить'}).click()
    await expect(inbox.getByText('TEAM SECRET PROOF')).toBeVisible()
    await expect(inbox.getByText('Локальная копия',{exact:false})).toBeVisible()
    await ctxB.setOffline(false)
    const member=panel.getByTestId('team-member-'+accountB)
    await member.getByRole('button',{name:'Роль'}).click()
    await member.getByRole('combobox',{name:'Роль '+accountB})
      .selectOption('contributor')
    A.once('dialog',dialog=>{void dialog.accept()})
    await member.getByRole('button',{name:'Применить'}).click()
    await expect(member).toContainText('Исполнитель',{timeout:30000})
    await expect(panel.getByText('Роль изменена и подтверждена сервером.'))
      .toBeVisible()
    await inbox.getByRole('button',{name:'Обновить'}).click()
    await expect(inbox.getByTestId('team-joined-list'))
      .toContainText('Исполнитель',{timeout:30000})

    // Revoking A->B must immediately stop new server-issued team DEK reads,
    // quarantine the old DEK for *every* remaining member and invalidate
    // B's online cache while preserving the signed audit evidence.
    A.once('dialog',dialog=>{void dialog.accept()})
    await member.getByRole('button',{name:'Исключить'}).click()
    await expect(panel.getByTestId('team-rotation-required'))
      .toBeVisible({timeout:30000})
    await expect(member).toContainText('Исключён')
    await inbox.getByRole('button',{name:'Обновить'}).click()
    await expect(inbox.getByTestId('team-revoked-notice'))
      .toBeVisible({timeout:30000})
    await expect(inbox.getByTestId('team-joined-list')).toHaveCount(0)

    // While the Team is quarantined, C receives a key-free suspension notice,
    // never an old signed ECDH envelope.
    await survivor.getByRole('button',{name:'Обновить'}).click()
    await expect(survivor.getByTestId('team-suspended-notice'))
      .toBeVisible({timeout:30000})
    A.once('dialog',dialog=>{void dialog.accept()})
    await panel.getByTestId('team-rotate-key').click()
    await expect(panel.getByTestId('team-key-epoch')).toContainText('эпоха 2',{
      timeout:30000,
    })
    await expect(panel.getByTestId('team-rotation-required')).toHaveCount(0)
    // A live signed epoch must prove the automatic retirement of D.
    await expect(panel.getByTestId('team-member-'+accountD))
      .toContainText('Исключён',{timeout:30000})
    await expect(panel.getByTestId('team-member-'+accountC))
      .toContainText('Принято',{timeout:30000})

    // Owner outbox persists ONLY locally sealed ciphertext, no new DEK,
    // profile data, owner ID or recipient identities in browser storage.
    const encryptedEpoch=await A.evaluate(async()=>{
      return new Promise<string>((resolve,reject)=>{
        const req=indexedDB.open('pb3-encrypted-team-epochs-v1')
        req.onerror=()=>reject(req.error)
        req.onsuccess=()=>{
          const db=req.result,tx=db.transaction('operations','readonly')
          const op=tx.objectStore('operations').getAll()
          op.onerror=()=>reject(op.error)
          tx.oncomplete=()=>{
            resolve(JSON.stringify(op.result));db.close()
          }
        }
      })
    })
    for(const forbidden of [
      'TEAM SECRET PROOF','E2EE profile visible only to accepted users',
      accountA,accountB,accountC,'recipientAccountId','privateEnvelope',
    ])expect(encryptedEpoch).not.toContain(forbidden)

    await survivor.getByRole('button',{name:'Обновить'}).click()
    await expect(survivor.getByTestId('team-joined-list'))
      .toContainText('TEAM SECRET PROOF',{timeout:30000})
    await expect(survivor.getByTestId('team-key-epoch')).toHaveCount(0)

    // A cached title is NOT proof of an online-verified current epoch.
    // Force actual signed-chain validation and ECDH/AES-GCM decryption
    // before simulating malicious historical transport responses.
    const verifiedEpochTwo=await C.evaluate(async acceptedInvite=>{
      const auth=await import('/src/features/identity/application/session.ts')
      await auth.reauthenticate()
      const api=await import('/src/features/people/application/team-epochs.ts')
      return api.openAnyJoinedTeam(acceptedInvite)
    },originalC.invite)
    expect(verifiedEpochTwo.name).toBe('TEAM SECRET PROOF')
    expect(verifiedEpochTwo.verifiedOnline).toBe(true)
    const storedWatermarkCount=await C.evaluate(async()=>{
      return new Promise<number>((resolve,reject)=>{
        const open=indexedDB.open('pb3-encrypted-team-members-v1')
        open.onerror=()=>reject(open.error)
        open.onsuccess=()=>{
          const db=open.result,tx=db.transaction('freshness','readonly')
          const request=tx.objectStore('freshness').count()
          request.onerror=()=>reject(request.error)
          tx.oncomplete=()=>{
            resolve(request.result);db.close()
          }
        }
      })
    })
    expect(storedWatermarkCount).toBeGreaterThan(0)

    // Recreate the web app before the malicious replay: a high-water mark
    // stored only in volatile JavaScript state is insufficient.
    await C.reload()
    // Session bootstrap is intentionally local-first (initially offline).
    // Explicitly finish the supported real server proof before probing ACL.
    await C.evaluate(async()=>{
      const session=await import('/src/features/identity/application/session.ts')
      await session.reauthenticate()
    })
    const verifiedBeforeReplay=await C.evaluate(async()=>{
      const m=await import('/src/features/people/application/team-invitations.ts')
      return m.listCachedJoinedTeams()
    })
    expect(verifiedBeforeReplay.find(x=>x.teamId===teamId)?.name)
      .toBe('TEAM SECRET PROOF')
    const watermarkAfterReload=await C.evaluate(async()=>{
      return new Promise<number>((resolve,reject)=>{
        const open=indexedDB.open('pb3-encrypted-team-members-v1')
        open.onerror=()=>reject(open.error)
        open.onsuccess=()=>{
          const db=open.result,tx=db.transaction('freshness','readonly')
          const request=tx.objectStore('freshness').count()
          request.onerror=()=>reject(request.error)
          tx.oncomplete=()=>{resolve(request.result);db.close()}
        }
      })
    })
    expect(watermarkAfterReload).toBe(storedWatermarkCount)

    // T29B-02: replay two authentic old responses after C has verified
    // epoch 2. AEAD high-water mark MUST deny the v1 downgrade despite
    // valid original signatures; never overwrite the joined profile.
    const epochMemberRoute='**/teams/v1/'+teamId+'/epoch/member'
    const oldMemberRoute='**/teams/v1/'+teamId+'/member'
    await C.route(epochMemberRoute,route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({teamId,keyEpoch:1}),
    }))
    await C.route(oldMemberRoute,route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify(originalC.oldMember),
    }))
    const replay=await C.evaluate(async oldInvite=>{
      const auth=await import('/src/features/identity/application/session.ts')
      await auth.reauthenticate()
      const m=await import('/src/features/people/application/team-epochs.ts')
      try{
        await m.openAnyJoinedTeam(oldInvite)
        return 'accepted-old-epoch'
      }catch(e){return e instanceof Error?e.message:String(e)}
    },originalC.invite)
    expect(replay).toBe('teams.verified_epoch_rollback')
    await C.unroute(epochMemberRoute)
    await C.unroute(oldMemberRoute)
    const verifiedAfterReplay=await C.evaluate(async()=>{
      const m=await import('/src/features/people/application/team-invitations.ts')
      return m.listCachedJoinedTeams()
    })
    expect(verifiedAfterReplay.find(x=>x.teamId===teamId)?.name)
      .toBe('TEAM SECRET PROOF')
    expect(verifiedAfterReplay.find(x=>x.teamId===teamId)?.verifiedOnline)
      .toBe(false)

    // T29B-01 regression: after pending D's signed automatic retirement
    // owner can still remove surviving C and complete another rotation.
    const memberC=panel.getByTestId('team-member-'+accountC)
    A.once('dialog',dialog=>{void dialog.accept()})
    await memberC.getByRole('button',{name:'Исключить'}).click()
    await expect(panel.getByTestId('team-rotation-required'))
      .toBeVisible({timeout:30000})
    A.once('dialog',dialog=>{void dialog.accept()})
    await panel.getByTestId('team-rotate-key').click()
    await expect(panel.getByTestId('team-key-epoch')).toContainText('эпоха 3',{
      timeout:30000,
    })
    await expect(panel.getByTestId('team-rotation-required')).toHaveCount(0)

    // P1-29C: excluded B must receive only a fresh v2 epoch-scoped ECDH
    // grant and explicitly sign consent. No historical v1 grant re-use.
    await panel.getByRole('button',{name:'Добавить участника'}).click()
    await panel.getByTestId('team-invite-contact').selectOption(accountB)
    await panel.getByTestId('team-invite-role').selectOption('viewer')
    await panel.getByTestId('team-invite-submit').click()
    await expect(panel.getByText('Приглашение отправлено',{exact:false}))
      .toBeVisible({timeout:30000})
    await inbox.getByRole('button',{name:'Обновить'}).click()
    await expect(inbox.getByTestId('team-incoming-invites'))
      .toContainText('Наблюдатель',{timeout:30000})
    await inbox.getByRole('button',{name:'Принять'}).click()
    await expect(inbox.getByTestId('team-joined-list'))
      .toContainText('TEAM SECRET PROOF',{timeout:30000})
    await expect(inbox.getByTestId('team-joined-list'))
      .toContainText('E2EE profile visible only to accepted users')
    const v2Outbox=await A.evaluate(async()=>{
      return new Promise<string>((resolve,reject)=>{
        const req=indexedDB.open('pb3-encrypted-team-invites-v2')
        req.onerror=()=>reject(req.error)
        req.onsuccess=()=>{
          const db=req.result,tx=db.transaction('operations','readonly')
          const rows=tx.objectStore('operations').getAll()
          rows.onerror=()=>reject(rows.error)
          tx.oncomplete=()=>{resolve(JSON.stringify(rows.result));db.close()}
        }
      })
    })
    expect(v2Outbox).not.toBe('[]')
    for(const value of [
      accountA,accountB,teamId,'recipientAccountId',
      'rootContractHash','TEAM SECRET PROOF','privateEnvelope',
    ])expect(v2Outbox).not.toContain(value)

    // An independently signed membership change after v2 consent may
    // update B's role. B must still decrypt/re-read the authenticated epoch.
    await panel.getByTestId('team-member-selector').selectOption('')
    await panel.getByTestId('team-member-selector').selectOption({
      label:'TEAM SECRET PROOF',
    })
    const memberB2=panel.getByTestId('team-member-'+accountB)
    await expect(memberB2).toContainText('Принято',{timeout:30000})
    await memberB2.getByRole('button',{name:'Роль'}).click()
    await memberB2.getByRole('combobox',{name:'Роль '+accountB})
      .selectOption('contributor')
    A.once('dialog',dialog=>{void dialog.accept()})
    await memberB2.getByRole('button',{name:'Применить'}).click()
    await expect(memberB2).toContainText('Исполнитель',{timeout:30000})
    await inbox.getByRole('button',{name:'Обновить'}).click()
    await expect(inbox.getByTestId('team-joined-list'))
      .toContainText('Исполнитель',{timeout:30000})

    // D's v2 invitation remains pending when B is removed. Epoch 4 must
    // automatically revoke it ONLY because that exact UUID appears in the
    // owner-signed retirement set. D must not receive a stale ECDH envelope.
    await panel.getByRole('button',{name:'Добавить участника'}).click()
    await panel.getByTestId('team-invite-contact').selectOption(accountD)
    await panel.getByTestId('team-invite-role').selectOption('viewer')
    await panel.getByTestId('team-invite-submit').click()
    await expect(panel.getByTestId('team-member-'+accountD))
      .toContainText('Ожидает согласия',{timeout:30000})
    A.once('dialog',dialog=>{void dialog.accept()})
    await memberB2.getByRole('button',{name:'Исключить'}).click()
    await expect(panel.getByTestId('team-rotation-required'))
      .toBeVisible({timeout:30000})
    A.once('dialog',dialog=>{void dialog.accept()})
    await panel.getByTestId('team-rotate-key').click()
    await expect(panel.getByTestId('team-key-epoch')).toContainText('эпоха 4',{
      timeout:30000,
    })
    await expect(panel.getByTestId('team-rotation-required')).toHaveCount(0)
    await expect(panel.getByTestId('team-member-'+accountD))
      .toContainText('Исключён',{timeout:30000})
    const dV2Notices=await D.evaluate(async()=>{
      const r=await fetch('/teams/v2/invites/received',{
        credentials:'include',headers:{Accept:'application/json'},
      })
      if(!r.ok)throw Error('epoch v2 inbox unavailable')
      return r.json() as Promise<{
        items:Array<Record<string,unknown>>
      }>
    })
    expect(dV2Notices.items.some(x=>x.state==='revoked')).toBe(true)
    expect(dV2Notices.items.some(x=>
      x.state==='revoked'&&('envelope' in x||'contract' in x),
    )).toBe(false)
    await inbox.getByRole('button',{name:'Обновить'}).click()
    await expect(inbox.getByTestId('team-revoked-notice'))
      .toBeVisible({timeout:30000})

    // Explicit server authorization of a removed recipient fails even
    // after key rotation has re-enabled access to remaining members.
    const removedStatus=await B.evaluate(async(teamId)=>{
      const response=await fetch('/teams/v1/'+teamId+'/epoch/member',{
        credentials:'include',
      })
      return response.status
    },await A.evaluate(async()=>{
      const m=await import('/src/features/people/application/team-book.ts')
      return (await m.listLocalTeams()).find(x=>x.name==='TEAM SECRET PROOF')!.teamId
    }))
    expect(removedStatus).toBe(404)
  }finally{
    await ctxA.close();await ctxB.close()
    await ctxC.close();await ctxD.close()
  }
})
