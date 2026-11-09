import { test, expect } from '@playwright/test'

test('two browser identities: key-only account, encrypted camera photo, Garage recovery', async ({browser}) => {
  const first = await browser.newContext({permissions:['camera']})
  const deviceA = await first.newPage()
  const second = await browser.newContext()
  const deviceB = await second.newPage()
  try {
    await deviceA.goto('/settings')
    await deviceA.getByRole('button',{name:'Создать ключ'}).click()
    const keyField = deviceA.locator('#generated-key')
    await expect(keyField).toHaveValue(/^PB2\./)
    const recoveryKey=await keyField.inputValue()
    expect(recoveryKey.length).toBeGreaterThan(40)
    await deviceA.getByLabel('Я сохранил ключ восстановления').check()
    await deviceA.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(deviceA.getByText('Подтверждённая сессия')).toBeVisible()

    // The app shell is already loaded. Capture and navigate while the network
    // is genuinely unavailable. There is no Service Worker yet, so this tests
    // local-first interactions, not an unsupported cold offline page reload.
    await first.setOffline(true)
    await deviceA.getByRole('link',{name:'Камера',exact:true}).click()
    await expect(deviceA.locator('video')).toBeVisible()
    await expect.poll(()=>deviceA.locator('video').evaluate(el=>(el as HTMLVideoElement).videoWidth))
      .toBeGreaterThan(0)
    await deviceA.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(deviceA.getByText(/Зашифровано и сохранено локально/)).toBeVisible()
    await deviceA.getByRole('link',{name:'Browser',exact:true}).click()
    await expect(deviceA.locator('.photo-row').first()).toContainText('queued')
    await first.setOffline(false)
    await deviceA.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(deviceA.locator('.photo-row').first()).toContainText('synced',{timeout:30000})

    // Retrieve the opaque ID through the genuine authenticated endpoint.
    const photoId=await deviceA.evaluate(async()=>{
      const response=await fetch('/photos/v1',{credentials:'same-origin',cache:'no-store'})
      if(!response.ok)throw new Error('cloud.list_unavailable')
      const body=await response.json() as {items:Array<{photoId:string}>}
      return body.items[0]?.photoId
    })
    expect(photoId).toMatch(/^[a-f0-9-]{36}$/)

    // New browser profile has independent IndexedDB and browser session.
    await deviceB.goto('/settings')
    await deviceB.locator('#recovery-key').fill(recoveryKey)
    await deviceB.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(deviceB.getByText('Подтверждённая сессия')).toBeVisible()
    await deviceB.goto('/browser')
    await expect(deviceB.getByRole('button',{name:'Проверить из облака'}).first()).toBeVisible()
    await deviceB.getByRole('button',{name:'Проверить из облака'}).first().click()
    const image=deviceB.locator('img.decrypted-preview')
    await expect(image).toBeVisible()
    await expect.poll(()=>image.evaluate(el=>(el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)

    // Confirm repeated reload never needs the Recovery Key again on a trusted device.
    await deviceB.reload()
    await expect(deviceB.getByRole('button',{name:'Проверить из облака'}).first()).toBeVisible()

    // A new unrelated anonymous account has no access to the first account's media.
    const third=await browser.newContext()
    const outsider=await third.newPage()
    try {
      await outsider.goto('/settings')
      await outsider.getByRole('button',{name:'Создать ключ'}).click()
      const otherKey=await outsider.locator('#generated-key').inputValue()
      await outsider.getByLabel('Я сохранил ключ восстановления').check()
      await outsider.getByRole('button',{name:'Завершить регистрацию'}).click()
      await expect(outsider.getByText('Подтверждённая сессия')).toBeVisible()
      const status=await outsider.evaluate(async id=>
        (await fetch('/photos/v1/'+encodeURIComponent(id)+'/receipt',{credentials:'same-origin'})).status,
      photoId)
      expect(status).toBe(404)
      // No recovery key or other sensitive material is printed in diagnostics.
      void otherKey
    }finally { await third.close() }
  } finally {
    await first.close()
    await second.close()
  }
})


test('P1-03: signed recipient key, manual fingerprint, E2EE grant and revoke',async({browser})=>{
  const recipientContext=await browser.newContext()
  const ownerContext=await browser.newContext({permissions:['camera']})
  const outsiderContext=await browser.newContext()
  const recipient=await recipientContext.newPage()
  const owner=await ownerContext.newPage()
  const outsider=await outsiderContext.newPage()

  async function enroll(page:typeof recipient):Promise<string>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await expect(page.locator('#generated-key')).toHaveValue(/^PB2\./)
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    const uuid=(await page.locator('.foundation-card code').first().textContent())?.trim()
    expect(uuid).toMatch(/^[a-f0-9-]{36}$/)
    await page.goto('/browser')
    await expect(page.getByText('Ключ обмена подготовлен')).toBeVisible({timeout:20000})
    return uuid!
  }

  try{
    const recipientId=await enroll(recipient)
    const ownerId=await enroll(owner)

    await owner.getByRole('navigation',{name:'Главная навигация'}).getByRole('link',{name:'Камера',exact:true}).click()
    await expect.poll(()=>owner.locator('video').evaluate(el=>(el as HTMLVideoElement).videoWidth))
      .toBeGreaterThan(0)
    await owner.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(owner.getByText(/Зашифровано и сохранено локально/)).toBeVisible()
    await owner.getByRole('link',{name:'Browser',exact:true}).click()
    await owner.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(owner.locator('.photo-row').first()).toContainText('synced',{timeout:30000})

    // First-contact safety verification is explicit; there is no silent TOFU.
    await owner.locator('#recipient-account-id').fill(recipientId)
    await owner.getByRole('button',{name:'Проверить ключ'}).click()
    await expect(owner.getByText('Отпечаток получателя',{exact:true})).toBeVisible()
    await owner.getByLabel('Я сверил отпечаток получателя').check()
    await owner.getByRole('button',{name:'Подтвердить отпечаток',exact:true}).click()
    await expect(owner.getByText('Ключ получателя подтверждён')).toBeVisible()
    // Grant construction must remain local-first after the peer's fingerprint
    // has been explicitly pinned. Outbox stores encrypted key envelopes only.
    await ownerContext.setOffline(true)
    await owner.getByRole('button',{name:'Передать',exact:true}).first().click()
    await expect(owner.getByText(/ · queued/).first()).toBeVisible()
    await ownerContext.setOffline(false)
    await owner.reload() // IndexedDB outbox survives a normal online reload.
    await expect(owner.getByText(/ · sent/).first()).toBeVisible({timeout:30000})

    await recipient.getByRole('button',{name:'Обновить полученные'}).click()
    await expect(recipient.getByRole('button',{name:'Ключ отправителя'})).toBeVisible()
    await recipient.getByRole('button',{name:'Ключ отправителя'}).click()
    await expect(recipient.getByText('Отпечаток отправителя',{exact:true})).toBeVisible()
    await recipient.getByLabel('Я сверил отпечаток отправителя').check()
    await recipient.getByRole('button',{name:'Подтвердить отправителя'}).click()
    await recipient.getByRole('button',{name:'Открыть полученное'}).click()
    const decrypted=recipient.locator('img.decrypted-preview')
    await expect(decrypted).toBeVisible()
    await expect.poll(()=>decrypted.evaluate(el=>(el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)

    const grantId=await recipient.evaluate(async()=>{
      const response=await fetch('/shares/v1/received',{credentials:'same-origin'})
      if(!response.ok)throw Error('grant list unavailable')
      const data=await response.json() as {items:Array<{grantId:string}>}
      return data.items[0]?.grantId
    })
    expect(grantId).toMatch(/^[a-f0-9-]{36}$/)

    await enroll(outsider)
    const outsiderStatus=await outsider.evaluate(async(id)=>
      (await fetch('/shares/v1/grants/'+id,{credentials:'same-origin'})).status,grantId)
    expect(outsiderStatus).toBe(404)

    await owner.getByRole('button',{name:'Отозвать'}).click()
    await expect(owner.getByText('Дальнейшее серверное чтение отозвано')).toBeVisible()
    const denied=await recipient.evaluate(async(id)=>
      (await fetch('/shares/v1/grants/'+id,{credentials:'same-origin'})).status,grantId)
    expect(denied).toBe(410)
    // The existing decrypted copy is not retroactively erased.
    await expect(decrypted).toBeVisible()
    // Do not log or expose Recovery Keys, raw DEKs, or S3 access secrets.
    void ownerId
  }finally{
    await recipientContext.close()
    await ownerContext.close()
    await outsiderContext.close()
  }
})


test('P1-04: A creates encrypted assignment, B accepts and submits a photo grant, A decrypts',async({browser})=>{
  test.setTimeout(120_000)
  const ownerCtx=await browser.newContext()
  const contributorCtx=await browser.newContext({permissions:['camera']})
  const outsiderCtx=await browser.newContext()
  const A=await ownerCtx.newPage()
  const B=await contributorCtx.newPage()
  const C=await outsiderCtx.newPage()

  async function register(page:typeof A):Promise<string>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await expect(page.locator('#generated-key')).toHaveValue(/^PB2\./)
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    const id=(await page.locator('.foundation-card code').first().textContent())?.trim()??''
    expect(id).toMatch(/^[a-f0-9-]{36}$/)
    await page.goto('/browser')
    await expect(page.getByText('Ключ обмена подготовлен')).toBeVisible({timeout:20000})
    return id
  }
  try{
    const AId=await register(A)
    const BId=await register(B)

    // Test operator represents the explicit out-of-band fingerprint check;
    // production UI MUST NOT silently pin first-contact keys.
    await A.evaluate(async id=>{
      const modulePath='/src/features/sharing/key-directory.ts'
      const m=await import(modulePath)
      const {directory}=await m.inspectPeer(id)
      await m.confirmPeer(id,directory.safetyFingerprint)
    },BId)
    await B.evaluate(async id=>{
      const modulePath='/src/features/sharing/key-directory.ts'
      const m=await import(modulePath)
      const {directory}=await m.inspectPeer(id)
      await m.confirmPeer(id,directory.safetyFingerprint)
    },AId)

    const assignmentId=await A.evaluate(async()=>{
      const modulePath='/src/features/assignments/application/assignment-outbox.ts'
      const m=await import(modulePath)
      const id=await m.queueAssignmentCreation({
        title:'Thirty private photos',
        instructions:'Capture 30 encrypted photographs',
        photoGoal:30,
      })
      await m.flushAssignmentOutbox()
      const local=(await m.listLocalAssignmentDrafts()).find((a:{id:string})=>a.id===id)
      if(local?.state!=='sent')throw new Error('assignment.create_unconfirmed')
      return id
    })
    expect(assignmentId).toMatch(/^[a-f0-9-]{36}$/)
    await A.evaluate(async({assignmentId,recipientId})=>{
      const modulePath='/src/features/assignments/application/assignment-outbox.ts'
      const m=await import(modulePath)
      await m.queueAssignmentInvitation(assignmentId,recipientId)
      await m.flushAssignmentOutbox()
      const ops=await m.listAssignmentOperations()
      if(!ops.some((o:{kind:string;state:string})=>o.kind==='invite'&&o.state==='sent'))
        throw new Error('assignment.invite_not_confirmed')
    },{assignmentId,recipientId:BId})

    const title=await B.evaluate(async({assignmentId,ownerId})=>{
      const modulePath='/src/features/assignments/application/assignment-outbox.ts'
      const cryptoPath='/src/features/assignments/infrastructure/assignment-crypto.ts'
      const keysPath='/src/features/sharing/key-directory.ts'
      const m=await import(modulePath)
      const cryptoModule=await import(cryptoPath)
      const keys=await import(keysPath)
      const invite=(await m.listAssignmentInvites()).find((a:{assignmentId:string})=>a.assignmentId===assignmentId)
      if(!invite)throw Error('assignment.invite_missing')
      await m.verifyAssignmentInvite(invite)
      await m.queueAssignmentAcceptance(invite)
      await m.flushAssignmentOutbox()
      const listing=(await m.listServerAssignments()).items.find((a:{assignmentId:string})=>a.assignmentId===assignmentId)
      if(!listing)throw Error('assignment.not_visible_after_accept')
      const contract=JSON.parse(invite.contract)
      const own=await keys.ensureOwnExchangeKey()
      const details=await cryptoModule.openRecipientAssignment(own.privateKey,{
        assignmentId,inviteId:invite.inviteId,ownerAccountId:ownerId,
        recipientAccountId:own.directory.accountId,
        role:'contributor',expiresAt:invite.expiresAt,
      },contract.envelope,listing.privateEnvelope)
      return details.title
    },{assignmentId,ownerId:AId})
    expect(title).toBe('Thirty private photos')

    // B captures without network; no plaintext or photo stored in device gallery.
    await contributorCtx.setOffline(true)
    await B.getByRole('navigation',{name:'Главная навигация'})
      .getByRole('link',{name:'Камера',exact:true}).click()
    await expect.poll(()=>B.locator('video').evaluate(el=>(el as HTMLVideoElement).videoWidth))
      .toBeGreaterThan(0)
    await B.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(B.getByText(/Зашифровано и сохранено локально/)).toBeVisible()
    await contributorCtx.setOffline(false)
    await B.getByRole('navigation',{name:'Главная навигация'})
      .getByRole('link',{name:'Browser',exact:true}).click()
    await B.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(B.locator('.photo-row').first()).toContainText('synced',{timeout:30000})

    const {grantId,photoId}=await B.evaluate(async recipientId=>{
      const photosPath='/src/features/photo-sync/application/p1-photo.ts'
      const sharePath='/src/features/sharing/grant-flow.ts'
      const photos=await import(photosPath)
      const share=await import(sharePath)
      const photo=(await photos.listLocalPhotos()).find((p:{state:string})=>p.state==='synced')
      if(!photo)throw new Error('assignment.no_synced_photo')
      const grantId=await share.queueRecipientGrant(photo.photoId,recipientId)
      await share.flushRecipientGrants()
      const grant=(await share.listOutgoingGrants()).find((g:{id:string})=>g.id===grantId)
      if(grant?.state!=='sent')throw new Error('assignment.photo_grant_unconfirmed')
      return {grantId,photoId:photo.photoId}
    },AId)
    await B.evaluate(async({assignmentId,grantId,photoId})=>{
      const modulePath='/src/features/assignments/application/assignment-outbox.ts'
      const m=await import(modulePath)
      await m.queueAssignmentSubmission(assignmentId,photoId,grantId)
      await m.flushAssignmentOutbox()
      if(!(await m.listAssignmentOperations()).some(
        (o:{kind:string;state:string})=>o.kind==='submit'&&o.state==='sent'))
        throw new Error('assignment.submit_unconfirmed')
    },{assignmentId,grantId,photoId})

    const submission=await A.evaluate(async id=>{
      const modulePath='/src/features/assignments/application/assignment-outbox.ts'
      const sharePath='/src/features/sharing/grant-flow.ts'
      const m=await import(modulePath)
      const shared=await import(sharePath)
      const items=await m.listAssignmentSubmissions(id)
      if(items.length!==1)throw new Error('assignment.submission_count_mismatch')
      const blob=await shared.readReceivedPhoto(items[0].photoGrantId)
      if(blob.size<128)throw new Error('assignment.decryption_failed')
      return items[0]
    },assignmentId)
    expect(submission.photoId).toBe(photoId)
    expect(submission.photoGrantId).toBe(grantId)

    await register(C)
    const unauthorized=await C.evaluate(async id=>{
      const r=await fetch('/assignments/v1/'+id+'/submissions',{credentials:'same-origin'})
      return r.status
    },assignmentId)
    expect(unauthorized).toBe(404)

    await B.evaluate(async id=>{
      const sharePath='/src/features/sharing/grant-flow.ts'
      const share=await import(sharePath)
      await share.revokeOutgoingGrant(id)
    },grantId)
    const afterRevoke=await A.evaluate(async id=>{
      const modulePath='/src/features/assignments/application/assignment-outbox.ts'
      const m=await import(modulePath)
      return (await m.listAssignmentSubmissions(id)).length
    },assignmentId)
    expect(afterRevoke).toBe(0)
  }finally{
    await ownerCtx.close()
    await contributorCtx.close()
    await outsiderCtx.close()
  }
})


test('P1-04: real assignment UI creates, invites, accepts and delivers encrypted photo',async({browser})=>{
  test.setTimeout(150_000)
  const aCtx=await browser.newContext()
  const bCtx=await browser.newContext({permissions:['camera']})
  const A=await aCtx.newPage(),B=await bCtx.newPage()
  async function enroll(page:typeof A):Promise<string>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    const id=(await page.locator('.foundation-card code').first().textContent())?.trim()??''
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    await page.goto('/browser')
    await expect(page.getByText('Ключ обмена подготовлен')).toBeVisible({timeout:20000})
    return id
  }
  try{
    const aId=await enroll(A)
    const bId=await enroll(B)

    await A.goto('/assignments')
    await A.getByRole('button',{name:'Создать задание'}).click()
    await A.locator('#assignment-title').fill('Thirty camera images')
    await A.locator('#assignment-instructions').fill('Send encrypted photos')
    await A.locator('#assignment-goal').fill('30')
    await A.getByRole('button',{name:'Создать зашифрованное задание'}).click()
    await expect(A.locator('.assignment-card-name').getByText('Thirty camera images')).toBeVisible()
    await expect(A.locator('.assignment-detail code').first()).toBeVisible()
    // Regression: identity proof can replace the Session object without an
    // account/device change. That must not wipe the selected assignment.
    await A.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      const current=identity.requireSession()
      identity.activeSession.value={...current,online:true}
    })
    await expect(A.locator('.assignment-detail code').first()).toBeVisible()
    await A.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(A.locator('.assignment-card').first()).toContainText('Активно')
    await expect(A.locator('.assignment-detail code').first()).toBeVisible()
    const assignmentId=(await A.locator('.assignment-detail code').first().textContent())?.trim()??''
    expect(assignmentId).toMatch(/^[0-9a-f-]{36}$/)

    await A.locator('#assignment-recipient-id').fill(bId)
    await A.getByRole('button',{name:'Проверить ключ исполнителя'}).click()
    await expect(A.getByText('Отпечаток исполнителя',{exact:true})).toBeVisible()
    await A.getByLabel('Я сверил отпечаток исполнителя').check()
    await A.getByRole('button',{name:'Подтвердить исполнителя'}).click()
    await A.getByRole('button',{name:'Пригласить исполнителя'}).click()
    await A.getByRole('button',{name:'Синхронизировать'}).click()

    await B.goto('/assignments')
    await B.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(B.getByText('Приглашения',{exact:true})).toBeVisible()
    await B.getByRole('button',{name:'Ключ владельца'}).click()
    await expect(B.getByText('Отпечаток владельца задания')).toBeVisible()
    await B.getByLabel('Я сверил отпечаток владельца').check()
    await B.getByRole('button',{name:'Подтвердить владельца'}).click()
    await B.getByRole('button',{name:'Принять задание'}).click()
    await expect(B.locator('.assignment-card-name').getByText('Thirty camera images'))
      .toBeVisible({timeout:20000})

    // navigator.onLine can be true during an actual API outage. A degraded
    // online refresh must retain only previously verified private ciphertext
    // and explicitly mark server authority/receipts as stale.
    await B.route('**/assignments/v1',route=>route.fulfill({
      status:503,contentType:'application/json',body:'{"error":"synthetic outage"}',
    }))
    await B.route('**/assignments/v1/invites/received',route=>route.fulfill({
      status:503,contentType:'application/json',body:'{"error":"synthetic outage"}',
    }))
    await B.route('**/shares/v1/keys/*',route=>route.fulfill({
      status:503,contentType:'application/json',body:'{"error":"synthetic key-directory outage"}',
    }))
    await B.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(B.getByText(/Офлайн: показаны последние проверенные подписью/))
      .toBeVisible()
    await expect(B.locator('.assignment-card-name').getByText('Thirty camera images'))
      .toBeVisible()
    // Even with the key directory unavailable, a cached owner-signed policy
    // can bind a local-only camera capture. The server will validate later.
    const outageBinding=await B.evaluate(async id=>{
      const m=await import('/src/features/assignments/application/assignment-outbox.ts')
      return m.signedCaptureBinding(id)
    },assignmentId)
    expect(outageBinding.policyHash).toMatch(/^[0-9a-f]{64}$/)
    await B.unroute('**/assignments/v1')
    await B.unroute('**/assignments/v1/invites/received')
    await B.unroute('**/shares/v1/keys/*')

    // Verify assignment policy while online and cache its signed snapshot.
    await B.getByRole('navigation',{name:'Главная навигация'})
      .getByRole('link',{name:'Камера',exact:true}).click()
    await expect(B.locator('#camera-assignment option[value="'+assignmentId+'"]'))
      .toHaveCount(1,{timeout:20000})
    await B.locator('#camera-assignment').selectOption(assignmentId)
    // Camera captures after network loss, using the independently verified
    // signed policy and durable encrypted v2 photo contract.
    await bCtx.setOffline(true)
    await expect.poll(()=>B.locator('video').evaluate(el=>(el as HTMLVideoElement).videoWidth))
      .toBeGreaterThan(0)
    await B.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(B.getByText(/Зашифровано и сохранено локально/)).toBeVisible()
    const captured=await B.evaluate(async()=>{
      const photos=await import('/src/features/photo-sync/application/p1-photo.ts')
      const [row]=await photos.listLocalPhotos()
      if(!row)throw new Error('capture.not_local')
      const parsed=JSON.parse(photos.signedPhotoContract(row))
      return {assignmentId:row.capture?.assignmentId,policyHash:row.capture?.policyHash,
        version:parsed.version,signedCapture:parsed.capture}
    })
    expect(captured.assignmentId).toBe(assignmentId)
    expect(captured.version).toBe(2)
    expect(captured.policyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(captured.signedCapture.assignmentId).toBe(assignmentId)

    // Warm SPA navigation must work without HTTP after a previously accepted
    // signed assignment was cached. This is NOT a cold offline document reload.
    await B.getByRole('navigation',{name:'Главная навигация'})
      .getByRole('link',{name:'Задания',exact:true}).click()
    await expect(B.getByText(/Офлайн: показаны последние проверенные подписью/))
      .toBeVisible()
    await expect(B.locator('.assignment-card-name').getByText('Thirty camera images'))
      .toBeVisible()
    await expect(B.locator('.assignment-card').first())
      .toContainText('Локально ожидают отправки: 1')
    await expect(B.locator('.assignment-card').first())
      .toContainText('ожидает подтверждения')

    // Owner changes the goal AFTER B's offline capture but BEFORE B can
    // reserve it. Revision 1 ciphertext must remain valid historically.
    await A.locator('#assignment-edited-goal').fill('45')
    await A.getByRole('button',{name:'Подписать новую цель'}).click()
    await expect(A.getByText('Версия правил: 2')).toBeVisible({timeout:20000})
    await expect(A.locator('.assignment-card').first()).toContainText(/Фото:\\s*0\\s*\\/\\s*45/)
    await bCtx.setOffline(false)
    await B.getByRole('navigation',{name:'Главная навигация'})
      .getByRole('link',{name:'Browser',exact:true}).click()
    await B.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(B.locator('.photo-row').first()).toContainText('synced',{timeout:30000})
    await B.goto('/assignments')
    await B.getByRole('button',{name:'Открыть',exact:true}).first().click()
    await B.getByRole('button',{name:'Проверить ключ владельца'}).click()
    await expect(B.getByText('Владелец подтверждён')).toBeVisible()
    await expect(B.getByRole('button',{name:'Отправить в задание'}).first()).toBeEnabled()
    await B.getByRole('button',{name:'Отправить в задание'}).first().click()
    await B.getByRole('button',{name:'Синхронизировать'}).click()

    // Server-derived progress counts only authorized finalized submissions;
    // the target of 30 is not an upload cap.
    await A.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(A.locator('.assignment-card').first())
      .toContainText(/Фото:\s*1\s*\/\s*45/)

    await A.getByRole('button',{name:'Обновить материалы'}).click()
    await expect(A.getByRole('button',{name:'Просмотр'})).toBeVisible({timeout:20000})
    await A.getByRole('button',{name:'Просмотр'}).click()
    const decoded=A.locator('.assignment-detail ~ .foundation-card img.decrypted-preview')
    await expect(decoded).toBeVisible({timeout:20000})
    await expect.poll(()=>decoded.evaluate(el=>(el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)

    // A finishes without deleting contributor-owned ciphertext or old grants.
    await A.getByRole('button',{name:'Завершить задание'}).click()
    await A.getByRole('button',{name:'Синхронизировать'}).click()
    // Finished assignments leave the Active tab but remain visible in All.
    await expect(A.locator('.assignment-card')).toHaveCount(0)
    await A.getByRole('button',{name:'Все',exact:true}).click()
    await expect(A.locator('.assignment-card').first()).toContainText('Завершено')
    await expect(A.getByText('Версия состояния: 2')).toBeVisible()
    await A.getByRole('button',{name:'Обновить материалы'}).click()
    await expect(A.getByRole('button',{name:'Просмотр'})).toBeVisible()
    await B.goto('/camera')
    await expect(B.locator('#camera-assignment option[value="'+assignmentId+'"]'))
      .toHaveCount(0,{timeout:20000})
    // Owner-signed resume reopens capture; creation root remains immutable
    // while the latest photo-target amendment is still revision 2.
    await A.getByRole('button',{name:'Возобновить задание'}).click()
    await A.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(A.getByText('Версия состояния: 3')).toBeVisible()
    await expect(A.locator('.assignment-card').first()).toContainText('Активно')
    await B.getByRole('button',{name:'Обновить задания'}).click()
    await expect(B.locator('#camera-assignment option[value="'+assignmentId+'"]'))
      .toHaveCount(1,{timeout:20000})
    const newest=await B.evaluate(async id=>{
      const m=await import('/src/features/assignments/application/assignment-outbox.ts')
      const binding=await m.signedCaptureBinding(id)
      return {revision:binding.policyRevision,hash:binding.policyHash}
    },assignmentId)
    expect(newest.revision).toBe(2)
    expect(newest.hash).not.toBe(captured.policyHash)
    void aId
  } finally { await aCtx.close();await bCtx.close() }
})
