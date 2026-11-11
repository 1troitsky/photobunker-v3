import { test, expect } from '@playwright/test'

test('P1-26: confirmed contact → explicit owner-signed assignment invitation, no implicit access',async({browser})=>{
  test.setTimeout(190000)
  const ctxA=await browser.newContext(),ctxB=await browser.newContext()
  const A=await ctxA.newPage(),B=await ctxB.newPage()
  async function enroll(page:typeof A):Promise<string>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    return page.evaluate(async()=>{
      const s=await import('/src/features/identity/application/session.ts')
      return s.requireSession().accountId
    })
  }
  try{
    await enroll(A)
    const recipientId=await enroll(B)
    await B.goto('/browser')
    await expect(B.getByText('Ключ обмена подготовлен')).toBeVisible({timeout:20000})

    // Independently fingerprint-confirm a real recipient in the local
    // account-scoped encrypted Contacts book before using the picker.
    await A.goto('/contacts')
    await A.getByTestId('contacts-lookup-id').fill(recipientId)
    await A.getByRole('button',{name:'Проверить ключ'}).click()
    await expect(A.getByTestId('contacts-fingerprint')).toBeVisible()
    await A.getByTestId('contacts-fingerprint-ack').check()
    await A.getByRole('button',{name:'Подтвердить отпечаток'}).click()
    await A.getByTestId('contacts-alias').fill('Trusted photographer')
    await A.getByRole('button',{name:'Добавить в контакты'}).click()
    await expect(A.getByTestId('contacts-row-'+recipientId))
      .toContainText('Trusted photographer')

    await A.goto('/assignments')
    await A.getByRole('button',{name:'Создать задание'}).click()
    await A.locator('#assignment-title').fill('CONTACT PICKER E2EE ASSIGNMENT')
    await A.locator('#assignment-instructions').fill('Photo assignment')
    await A.getByRole('button',{name:'Создать зашифрованное задание'}).click()
    await A.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(A.locator('.assignment-detail code').first()).toBeVisible()
    const assignmentId=(await A.locator('.assignment-detail code').first()
      .textContent())?.trim()??''
    expect(assignmentId).toMatch(/^[0-9a-f-]{36}$/)
    await A.getByTestId('open-fieldwork-editor').click()
    await expect(A.getByTestId('fieldwork-assignment-editor')).toBeVisible()
    await A.getByRole('tab',{name:'Участники'}).click()
    const chosen=A.getByTestId('editor-confirmed-contact-'+recipientId)
    await expect(chosen).toContainText('Trusted photographer',{timeout:20000})

    // Contact selection is a local UI action, not a signed invite/grant.
    const before=await A.evaluate(async id=>{
      const res=await fetch('/assignments/v1/'+id+'/participants')
      const data=await res.json()
      return {http:res.status,count:data.items?.length}
    },assignmentId)
    expect(before).toEqual({http:200,count:0})
    await chosen.getByRole('button',{name:'Выбрать'}).click()
    await expect(A.locator('#editor-recipient-id')).toHaveValue(recipientId)
    await expect(A.getByText('Контакт выбран, ключ подтверждён. Приглашение ещё не отправлено.'))
      .toBeVisible({timeout:15000})
    const stillBefore=await A.evaluate(async id=>{
      const res=await fetch('/assignments/v1/'+id+'/participants')
      const data=await res.json()
      return data.items?.length
    },assignmentId)
    expect(stillBefore).toBe(0)
    await A.getByRole('button',{name:'Отправить подписанное приглашение'}).click()
    await expect(A.getByTestId('editor-participant-'+recipientId))
      .toContainText('Ожидает принятия',{timeout:20000})

    await B.goto('/assignments')
    await B.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(B.getByText('Приглашения',{exact:true})).toBeVisible({timeout:20000})
    await B.getByRole('button',{name:'Ключ владельца'}).click()
    await B.getByLabel('Я сверил отпечаток владельца').check()
    await B.getByRole('button',{name:'Подтвердить владельца'}).click()
    await B.getByRole('button',{name:'Принять задание'}).click()
    await expect(B.locator('.assignment-card-name'))
      .toContainText('CONTACT PICKER E2EE ASSIGNMENT',{timeout:20000})
    // The mere contact selection did not provide a media DEK.
    const mediaGrants=await B.evaluate(async()=>{
      const m=await import('/src/features/sharing/grant-flow.ts')
      return (await m.listReceivedGrants()).length
    })
    expect(mediaGrants).toBe(0)
    // The accepted recipient has an authenticated offline-capture policy
    // snapshot before exclusion. This is what must be invalidated.
    const beforeRemovalCache=await B.evaluate(async id=>{
      const m=await import('/src/features/assignments/application/assignment-outbox.ts')
      return (await m.listCachedAssignmentSnapshots())
        .some(item=>item.assignmentId===id)
    },assignmentId)
    expect(beforeRemovalCache).toBe(true)

    // V-24: owner revokes the same accepted invitation using an immutable
    // owner-account-signed operation, not a local UI-only roster flag.
    await A.getByRole('button',{name:'Обновить список'}).click()
    const participant=A.getByTestId('editor-participant-'+recipientId)
    await expect(participant).toContainText('Принято сервером',{timeout:20000})
    A.on('dialog',dialog=>dialog.accept())
    await participant.getByRole('button',{name:'Исключить'}).click()
    await expect(participant).toContainText('Исключён владельцем',{timeout:25000})
    const signedRemoval=await A.evaluate(async id=>{
      const membership=await import('/src/features/assignments/application/assignment-outbox.ts')
      const roster=await membership.listAssignmentParticipants(id)
      const removed=roster.find(p=>p.state==='removed')
      return {count:roster.length,state:removed?.state,
        signed:!!removed?.removalContract&&!!removed?.removalSignature}
    },assignmentId)
    expect(signedRemoval).toEqual({count:1,state:'removed',signed:true})
    await expect.poll(()=>B.evaluate(async id=>{
      const [list,inbox]=await Promise.all([
        fetch('/assignments/v1',{headers:{Accept:'application/json'}}),
        fetch('/assignments/v1/invites/received',{
          headers:{Accept:'application/json'},
        }),
      ])
      const [items,received]=await Promise.all([list.json(),inbox.json()])
      return {visible:items.items?.some((x:{assignmentId:string})=>
        x.assignmentId===id),inbox:received.items?.length}
    },assignmentId),{timeout:20000}).toEqual({visible:false,inbox:0})

    // Recipient must learn WHY the assignment vanished through the owner's
    // independently verified signed revocation, never a plaintext title,
    // a server-only removed flag or a resurrected invitation grant.
    await B.goto('/assignments')
    await B.getByRole('button',{name:'Обновить',exact:true}).click()
    const notices=B.getByTestId('assignment-removal-notices')
    await expect(notices.getByText('Исключён владельцем'))
      .toBeVisible({timeout:25000})
    await expect(notices).toContainText(assignmentId.slice(0,8))
    await expect(notices).toContainText('Подпись владельца проверена')
    const cryptographicRemoval=await B.evaluate(async()=>{
      const m=await import('/src/features/assignments/application/assignment-outbox.ts')
      const verify=await import('/src/features/assignments/application/verify-removal-notice.ts')
      const s=await import('/src/features/identity/application/session.ts')
      const entries=await m.listAssignmentRemovalNotices()
      const entry=entries[0]!
      const original=entry.notice
      let forged=false
      try{
        await verify.verifyAssignmentRemovalNotice({
          ...original,removalSignature:original.invitationSignature,
        },s.requireSession().accountId)
        forged=true
      }catch{ /* correctly denied forged signature */ }
      return {
        total:entries.length,verified:entry.verified,forged,
        cachedInvites:(await m.listCachedAssignmentInvites()).length,
      }
    })
    expect(cryptographicRemoval).toEqual({
      total:1,verified:true,forged:false,cachedInvites:0,
    })
    // A cryptographically VERIFIED removal also atomically invalidates the
    // signed cached capture policy and encrypted assignment summary, while
    // preserving contributor photos/outbox records.
    await B.context().setOffline(true)
    const offlineRevocation=await B.evaluate(async id=>{
      const m=await import('/src/features/assignments/application/assignment-outbox.ts')
      const snapshots=await m.listCachedAssignmentSnapshots()
      const invites=await m.listCachedAssignmentInvites()
      let denied=false
      try{await m.signedCaptureBinding(id)}
      catch(e){denied=e instanceof Error&&e.message==='assignment.member_removed'}
      const db=await new Promise<IDBDatabase>((resolve,reject)=>{
        const req=indexedDB.open('pb3-assignment-operation-outbox-v1')
        req.onsuccess=()=>resolve(req.result)
        req.onerror=()=>reject(req.error)
      })
      const account=(await import('/src/features/identity/application/session.ts'))
        .requireSession().accountId
      const key=account+'/'+id
      const raw=await new Promise<{revoked:boolean;policy:boolean;privateSummary:boolean}>(
        (resolve,reject)=>{
          const tx=db.transaction(['revocations','capturePolicies','privateSummaries'],'readonly')
          const rem=tx.objectStore('revocations').get(key)
          const policy=tx.objectStore('capturePolicies').get(key)
          const summary=tx.objectStore('privateSummaries').get(key)
          tx.oncomplete=()=>resolve({
            revoked:!!rem.result,policy:!!policy.result,
            privateSummary:!!summary.result,
          })
          tx.onerror=()=>reject(tx.error)
        })
      db.close()
      let summaryWriteDenied=false
      let summaryReadDenied=false
      try{
        await m.cachePrivateAssignment(id,'stale-owner-policy',{
          version:1,title:'Stale private Fieldwork',
          instructions:'Must not survive a signed removal',
        })
      }catch(e){
        summaryWriteDenied=e instanceof Error
          &&e.message==='assignment.member_removed'
      }
      try{
        await m.readCachedPrivateAssignment(id,'stale-owner-policy')
      }catch(e){
        summaryReadDenied=e instanceof Error
          &&e.message==='assignment.member_removed'
      }
      return {snapshots:snapshots.some(x=>x.assignmentId===id),
        cachedInvites:invites.length,denied,...raw,
        summaryWriteDenied,summaryReadDenied}
    },assignmentId)
    expect(offlineRevocation).toEqual({
      snapshots:false,cachedInvites:0,denied:true,
      revoked:true,policy:false,privateSummary:false,
      summaryWriteDenied:true,summaryReadDenied:true,
    })
    // Offline reload retains the REASON this user's assignment vanished,
    // by re-verifying the saved owner's original removal signature using
    // only the fingerprint-confirmed local owner pin, without fetching media.
    await B.getByRole('button',{name:'Обновить',exact:true}).click()
    const offlineHistory=B.locator('[data-testid^="assignment-offline-removal-"]')
    await expect(offlineHistory).toHaveCount(1)
    await expect(offlineHistory).toContainText('Исключён владельцем')
    await expect(offlineHistory).toContainText(
      'Подпись исключения повторно проверена по ранее подтверждённому ключу')
    await expect(B.locator('.assignment-card-name')).toHaveCount(0)
    await B.context().setOffline(false)
  }finally{await ctxA.close();await ctxB.close()}
})
