import {test,expect} from '@playwright/test'

test('P1-13: owner-signed video/audio policy, fingerprint-confirmed contributor grants and server-authoritative assignment receipts',async({browser})=>{
  test.setTimeout(180000)
  const ownerCtx=await browser.newContext()
  const contributorCtx=await browser.newContext()
  const A=await ownerCtx.newPage()
  const B=await contributorCtx.newPage()
  async function enroll(page:typeof A):Promise<string>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    const id=await page.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      return identity.requireSession().accountId
    })
    await page.goto('/browser')
    await expect(page.getByText('Ключ обмена подготовлен'))
      .toBeVisible({timeout:20000})
    return id
  }
  try{
    const ownerId=await enroll(A)
    const contributorId=await enroll(B)
    // Contributor already has fully signed and synced encrypted media.
    const mediaPanel=B.locator('.media-import-p1')
    for(const [kind,mime,name,byte]of [
      ['audio','audio/wav','ASSIGNMENT-PRIVATE-AUDIO.wav',0x31],
      ['video','video/webm','ASSIGNMENT-PRIVATE-VIDEO.webm',0x52],
    ] as const){
      await mediaPanel.getByTestId('media-import-file').setInputFiles({
        name,mimeType:mime,buffer:Buffer.alloc(2048,byte),
      })
      await mediaPanel.getByRole('button',{name:'Отправить медиа'}).click()
      await expect.poll(()=>B.evaluate(async()=>{
        const m=await import('/src/features/media/application/media-outbox.ts')
        return (await m.listLocalMedia()).filter(x=>x.state==='synced').length
      }),{timeout:30000}).toBe(kind==='audio'?1:2)
    }
    await A.goto('/assignments')
    await A.getByRole('button',{name:'Создать задание'}).click()
    await A.locator('#assignment-title').fill('Media v3 opt-in assignment')
    await A.locator('#assignment-instructions').fill('Signed E2EE video and audio')
    await A.getByRole('button',{name:'Создать зашифрованное задание'}).click()
    await A.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(A.locator('.assignment-detail code').first()).toBeVisible()
    const assignmentId=(await A.locator('.assignment-detail code').first()
      .textContent())?.trim()??''
    expect(assignmentId).toMatch(/^[0-9a-f-]{36}$/)
    await expect(A.locator('.assignment-detail')).toContainText('Разрешённые типы: photo')

    // Explicit signed policy v3; never widen the immutable photo-only root.
    await A.locator('#assignment-allow-video').check()
    await A.locator('#assignment-allow-audio').check()
    await A.getByRole('button',{name:'Подписать новые правила'}).click()
    await expect(A.getByText('Версия правил: 2')).toBeVisible({timeout:20000})
    await expect(A.locator('.assignment-detail'))
      .toContainText('Разрешённые типы: photo, video, audio')
    const policy=await A.evaluate(async id=>{
      const res=await fetch('/assignments/v1/'+id+'/policy-history',{
        credentials:'same-origin',
      })
      const body=await res.json()
      return {
        http:res.status,
        version:JSON.parse(body.events[0].contract).version,
        allowed:JSON.parse(body.events[0].contract).allowedMedia,
      }
    },assignmentId)
    expect(policy).toEqual({http:200,version:3,allowed:['photo','video','audio']})

    await A.locator('#assignment-recipient-id').fill(contributorId)
    await A.getByRole('button',{name:'Проверить ключ исполнителя'}).click()
    await A.getByLabel('Я сверил отпечаток исполнителя').check()
    await A.getByRole('button',{name:'Подтвердить исполнителя'}).click()
    await A.getByRole('button',{name:'Пригласить исполнителя'}).click()
    await A.getByRole('button',{name:'Синхронизировать'}).click()

    await B.goto('/assignments')
    await B.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(B.getByText('Приглашения',{exact:true})).toBeVisible()
    await B.getByRole('button',{name:'Ключ владельца'}).click()
    await B.getByLabel('Я сверил отпечаток владельца').check()
    await B.getByRole('button',{name:'Подтвердить владельца'}).click()
    await B.getByRole('button',{name:'Принять задание'}).click()
    await expect(B.locator('.assignment-card-name').getByText('Media v3 opt-in assignment'))
      .toBeVisible({timeout:20000})
    await B.getByRole('button',{name:'Открыть',exact:true}).first().click()
    await B.getByRole('button',{name:'Проверить ключ владельца'}).click()
    await expect(B.getByText('Владелец подтверждён')).toBeVisible()
    const buttons=B.getByRole('button',{name:'Отправить медиа в задание'})
    await expect(buttons).toHaveCount(2)
    B.on('dialog',dialog=>dialog.accept())
    await buttons.first().click()
    await buttons.last().click()
    await expect.poll(()=>B.evaluate(async()=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      return (await a.listAssignmentOperations())
        .filter(x=>x.kind==='media-submit'&&x.state==='sent').length
    }),{timeout:30000}).toBe(2)

    await A.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(A.getByTestId('assignment-media-counts'))
      .toContainText('Видео: 1 · Аудио: 1',{timeout:20000})
    await A.getByRole('button',{name:'Обновить материалы'}).click()
    await expect(A.getByTestId('assignment-media-submission')).toHaveCount(2)
    const entries=await A.evaluate(async id=>{
      const session=await import('/src/features/assignments/application/assignment-outbox.ts')
      const m=await session.listAssignmentMediaSubmissions(id)
      return m.items.map(x=>({type:x.mediaType,grantId:x.mediaGrantId}))
    },assignmentId)
    expect(entries.map(x=>x.type).sort()).toEqual(['audio','video'])
    for(const item of entries){
      // Owner's independent recipient grant verification, original media
      // receipt, every SHA and AES-GCM tag checked before plaintext return.
      const result=await A.evaluate(async grantId=>{
        const grants=await import('/src/features/media/application/media-grants.ts')
        const media=await grants.readReceivedMediaGrant(grantId)
        const b=new Uint8Array(await media.blob.arrayBuffer())
        return {
          name:media.metadata.fileName,mime:media.blob.type,
          size:b.length,first:b[0],last:b[b.length-1],
        }
      },item.grantId)
      expect(result).toEqual(item.type==='video'
        ?{name:'ASSIGNMENT-PRIVATE-VIDEO.webm',mime:'video/webm',
          size:2048,first:0x52,last:0x52}
        :{name:'ASSIGNMENT-PRIVATE-AUDIO.wav',mime:'audio/wav',
          size:2048,first:0x31,last:0x31})
    }
    // Revocation immediately removes contribution from authoritative
    // live-grant count and list; owner never acquires the contributor's AKEK.
    const video=entries.find(x=>x.type==='video')!
    await B.evaluate(async grantId=>{
      const grants=await import('/src/features/media/application/media-grants.ts')
      await grants.revokeMediaGrant(grantId)
    },video.grantId)
    const unavailable=await A.evaluate(async grantId=>{
      const res=await fetch('/media-shares/v1/grants/'+grantId,{
        credentials:'same-origin',
      })
      return res.status
    },video.grantId)
    expect(unavailable).toBe(410)
    await A.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(A.getByTestId('assignment-media-counts'))
      .toContainText('Видео: 0 · Аудио: 1',{timeout:20000})
    const intact=await B.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia())
        .filter(x=>x.state==='synced').length
    })
    expect(intact).toBe(2)
    expect(ownerId).not.toBe(contributorId)
  }finally{
    await ownerCtx.close();await contributorCtx.close()
  }
})
