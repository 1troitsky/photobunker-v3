import {test,expect} from '@playwright/test'

test('P2 contributor: signed imported Photo MediaFile receipt requires scoped E2EE, owner decrypt and revoke',async({browser})=>{
  test.setTimeout(210000)
  const ownerCtx=await browser.newContext()
  const contributorCtx=await browser.newContext()
  const owner=await ownerCtx.newPage()
  const contributor=await contributorCtx.newPage()
  async function enroll(page:typeof owner):Promise<string>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    const id=await page.evaluate(async()=>{
      const auth=await import('/src/features/identity/application/session.ts')
      return auth.requireSession().accountId
    })
    await page.goto('/browser')
    await expect(page.getByText('Ключ обмена подготовлен'))
      .toBeVisible({timeout:25000})
    return id
  }
  try{
    const ownerId=await enroll(owner)
    const contributorId=await enroll(contributor)
    const imported=await contributor.evaluate(async()=>{
      const canvas=document.createElement('canvas')
      canvas.width=160;canvas.height=110
      const ctx=canvas.getContext('2d')!
      ctx.fillStyle='#c82329';ctx.fillRect(0,0,160,110)
      ctx.fillStyle='#202bc8';ctx.fillRect(12,13,30,26)
      const blob=await new Promise<Blob>((resolve,reject)=>{
        canvas.toBlob(x=>x?resolve(x):reject(Error('jpeg_failed')),
          'image/jpeg',0.95)
      })
      const media=await import('/src/features/media/application/media-outbox.ts')
      const mediaId=await media.enqueueEncryptedMedia(
        new File([blob],'P2-CONTRIBUTOR-PRIVATE-ORIGINAL.jpg',{type:'image/jpeg'}),
        undefined,{
          category:'Photo report',description:'Personal imported P2 photo',
          tags:['submission-only'],
        })
      await media.synchronizeMedia()
      return {mediaId,plainBytes:blob.size}
    })
    await expect.poll(()=>contributor.evaluate(async id=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).find(x=>x.mediaId===id)?.state
    },imported.mediaId),{timeout:30000}).toBe('synced')

    await owner.goto('/assignments')
    await owner.getByRole('button',{name:'Создать задание'}).click()
    await owner.locator('#assignment-title')
      .fill('Signed P2 imported photo assignment')
    await owner.locator('#assignment-instructions')
      .fill('Explicit participant consent, not verified camera capture')
    await owner.getByRole('button',{name:'Создать зашифрованное задание'}).click()
    await owner.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(owner.locator('.assignment-detail code').first())
      .toBeVisible({timeout:30000})
    const assignmentId=(await owner.locator('.assignment-detail code').first()
      .textContent())?.trim()??''
    expect(assignmentId).toMatch(/^[0-9a-f-]{36}$/)

    // A↔B is established by an independently confirmed key fingerprint.
    await owner.getByTestId('open-fieldwork-editor').click()
    await owner.getByRole('tab',{name:'Участники'}).click()
    await owner.locator('#editor-recipient-id').fill(contributorId)
    await owner.getByRole('button',{name:'Проверить ключ исполнителя'}).click()
    await owner.getByLabel('Я независимо сверил отпечаток').check()
    await owner.getByRole('button',{name:'Подтвердить ключ'}).click()
    await owner.getByRole('button',{name:'Отправить подписанное приглашение'})
      .click()
    await expect(owner.getByText(/Подписанное приглашение в очереди:/))
      .toBeVisible({timeout:20000})
    await owner.getByRole('link',{name:'Назад к заданиям'}).click()
    await owner.getByRole('button',{name:'Открыть',exact:true}).first().click()
    await owner.getByRole('button',{name:'Синхронизировать'}).click()

    await contributor.goto('/assignments')
    await contributor.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(contributor.getByText('Приглашения',{exact:true})).toBeVisible()
    await contributor.getByRole('button',{name:'Ключ владельца'}).click()
    await contributor.getByLabel('Я сверил отпечаток владельца').check()
    await contributor.getByRole('button',{name:'Подтвердить владельца'}).click()
    await contributor.getByRole('button',{name:'Принять задание'}).click()
    await contributor.getByRole('button',{name:'Открыть',exact:true}).first().click()
    await contributor.getByRole('button',{name:'Проверить ключ владельца'}).click()
    await expect(contributor.getByText('Владелец подтверждён')).toBeVisible()

    const mediaRow=contributor.locator('.photo-row')
      .filter({hasText:imported.mediaId.slice(0,8)})
    await expect(mediaRow).toContainText('Фото P2')
    await expect(mediaRow).toContainText('Личный медиафайл')
    contributor.once('dialog',d=>d.accept())
    await mediaRow.getByRole('button',{name:'Отправить медиа в задание'}).click()
    await expect.poll(()=>contributor.evaluate(async()=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const sent=(await a.listAssignmentOperations())
        .filter(x=>x.kind==='media-submit'&&x.state==='sent')
      return sent.length
    }),{timeout:40000}).toBe(1)

    const signed=await contributor.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const ops=await a.listAssignmentOperations()
      const receipt=ops.find(x=>x.kind==='media-submit'&&x.state==='sent')!
      const d=JSON.parse(receipt.contract)
      const g=await import('/src/features/media/application/media-grants.ts')
      const grants=await g.listOutgoingMediaGrants()
      const grant=grants.find(x=>x.id===d.mediaGrantId)!
      return {receipt:d,grant:JSON.parse(grant.contract),grantState:grant.state,
        privateLeak:JSON.stringify(grant).includes('submission-only')}
    },assignmentId)
    expect(signed).toMatchObject({
      receipt:{version:3,assignmentId,mediaId:imported.mediaId,
        kind:'photo',contributorAccountId:contributorId},
      grant:{version:2,scope:'read',assignmentId,
        mediaId:imported.mediaId,recipientAccountId:ownerId},
      grantState:'sent',privateLeak:false,
    })
    expect(signed.receipt.captureContract).toBeUndefined()
    expect(signed.receipt.captureSignature).toBeUndefined()

    await owner.goto('/assignments')
    await owner.getByRole('button',{name:'Обновить',exact:true}).click()
    await owner.getByRole('button',{name:'Открыть',exact:true}).first().click()
    await owner.getByRole('button',{name:'Обновить материалы'}).click()
    const item=owner.getByTestId('assignment-media-submission')
    await expect(item).toHaveCount(1,{timeout:20000})
    await expect(item).toContainText('Фото P2')
    await expect(item).toContainText('Личный файл · передан вручную')
    const count=await owner.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const rows=await a.listServerAssignments()
      const selected=rows.items.find(x=>x.assignmentId===id)
      return {photos:selected?.confirmedPhotoCount,
        submissions:(await a.listAssignmentMediaSubmissions(id)).items.map(v=>({
          kind:v.mediaType,captured:v.capturedInAssignment,
        }))}
    },assignmentId)
    expect(count).toEqual({photos:1,
      submissions:[{kind:'photo',captured:false}]})
    await item.getByRole('button',{name:'Открыть медиа задания'}).click()
    await expect(owner.getByTestId('assignment-decrypted-private-metadata'))
      .toContainText('Теги: submission-only',{timeout:30000})
    await expect(owner.getByTestId('assignment-decrypted-private-metadata'))
      .toContainText('Категория: Photo report')

    // Revocation blocks new ciphertext/DEK retrieval, but preserves the
    // contributor's original and does not rewrite private metadata.
    await contributor.evaluate(async grantId=>{
      const g=await import('/src/features/media/application/media-grants.ts')
      await g.revokeMediaGrant(grantId)
    },signed.receipt.mediaGrantId)
    await owner.getByRole('button',{name:'Обновить',exact:true}).click()
    await owner.getByRole('button',{name:'Обновить материалы'}).click()
    await expect(owner.getByTestId('assignment-media-submission')).toHaveCount(0)
    const after=await owner.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const page=await a.listServerAssignments()
      return page.items.find(x=>x.assignmentId===id)?.confirmedPhotoCount
    },assignmentId)
    expect(after).toBe(0)
    const remains=await contributor.evaluate(async id=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).find(x=>x.mediaId===id)?.state
    },imported.mediaId)
    expect(remains).toBe('synced')
  }finally{
    await ownerCtx.close()
    await contributorCtx.close()
  }
})
