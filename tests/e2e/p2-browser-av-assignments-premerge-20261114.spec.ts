import {test,expect} from '@playwright/test'

// P2 integration QA, not a substitute for physical native iOS/Android.
// The two accounts use genuine signed root/policy, key fingerprints, E2EE
// MediaFile/DEK grants, PostgreSQL18 and Garage. Never mock server receipts.
test.use({trace:'off',screenshot:'off',video:'off'})

test('P2 pre-main: mixed creation v6 → signed A/B invitation → AV E2EE grants → server progress',async({browser})=>{
  test.setTimeout(300_000)
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
    const accountId=await page.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      return identity.requireSession().accountId
    })
    await page.goto('/browser')
    await expect(page.getByText('Ключ обмена подготовлен'))
      .toBeVisible({timeout:20_000})
    return accountId
  }
  try{
    const ownerId=await enroll(A)
    const recipientId=await enroll(B)
    // The contributor starts with two genuinely encrypted, server-synced
    // private MediaFiles. No team role grants access to either DEK.
    const uploader=B.locator('.media-import-p1')
    for(const [mime,name,fill] of [
      ['audio/wav','A-B-SIGNED-ASSIGNMENT-209.wav',0x42],
      ['video/webm','A-B-SIGNED-ASSIGNMENT-209.webm',0x58],
    ] as const){
      await expect(uploader.getByTestId('media-import-file'))
        .toBeEnabled({timeout:30_000})
      await uploader.getByTestId('media-import-file').setInputFiles({
        name,mimeType:mime,buffer:Buffer.alloc(2048,fill),
      })
      await uploader.getByRole('button',{name:'Отправить медиа'}).click()
      await B.evaluate(async()=>{
        const m=await import('/src/features/media/application/media-outbox.ts')
        await m.synchronizeMedia()
      })
    }
    await expect.poll(()=>B.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).filter(x=>x.state==='synced').length
    }),{timeout:30_000}).toBe(2)

    await A.goto('/assignments')
    await A.getByRole('button',{name:'Создать задание'}).click()
    await A.locator('#assignment-title').fill('P2 integrated signed AV handoff')
    await A.locator('#assignment-instructions').fill('Private encrypted owner briefing')
    await A.locator('#assignment-create-video').check()
    await A.locator('#assignment-create-video-goal').fill('2')
    await A.locator('#assignment-create-audio').check()
    await A.locator('#assignment-create-audio-goal').fill('1')
    await A.getByRole('button',{name:'Создать зашифрованное задание'}).click()
    const assignmentId=await A.evaluate(async()=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const row=(await a.listLocalAssignmentDrafts()).find(x=>
        x.mixedCreation?.videoGoal===2&&x.mixedCreation?.audioGoal===1)
      if(!row)throw Error('qa.mixed_intent_not_durable')
      return row.id
    })
    await expect.poll(()=>A.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      await a.flushAssignmentOutbox()
      const signed=(await a.listAllServerAssignments())
        .find(x=>x.assignmentId===id)
      if(!signed)return 'root-pending'
      if(signed.policyRevision!==2)return 'v6-pending'
      const root=JSON.parse(signed.policyContract)
      const amendment=JSON.parse(signed.policyAmendmentContract??'{}')
      const goals=a.signedPolicyGoals(signed)
      return JSON.stringify({
        root:root.allowedMedia,policy:amendment.allowedMedia,version:amendment.version,
        video:goals.videoGoal,audio:goals.audioGoal,
      })
    },assignmentId),{timeout:70_000}).toBe(JSON.stringify({
      root:['photo'],policy:['photo','video','audio'],
      version:6,video:2,audio:1,
    }))

    // The assignment creator must explicitly fingerprint-pin recipient B.
    await A.goto('/assignments/'+assignmentId+'/edit')
    await A.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
    })
    await expect(A.getByTestId('fieldwork-assignment-editor')).toBeVisible()
    await A.getByRole('tab',{name:'Участники'}).click()
    await A.locator('#editor-recipient-id').fill(recipientId)
    await A.getByRole('button',{name:'Проверить ключ исполнителя'}).click()
    await A.getByLabel('Я независимо сверил отпечаток').check()
    await A.getByRole('button',{name:'Подтвердить ключ'}).click()
    await expect(A.getByText('Отпечаток независимо подтверждён на этом устройстве.'))
      .toBeVisible()
    await A.getByRole('button',{name:'Отправить подписанное приглашение'}).click()
    await expect(A.getByText(/Подписанное приглашение в очереди:/))
      .toBeVisible({timeout:20_000})
    await A.evaluate(async()=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      await a.flushAssignmentOutbox()
    })

    await B.goto('/assignments')
    await B.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
    })
    await B.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(B.getByText('Приглашения',{exact:true})).toBeVisible()
    await B.getByRole('button',{name:'Ключ владельца'}).click()
    await B.getByLabel('Я сверил отпечаток владельца').check()
    await B.getByRole('button',{name:'Подтвердить владельца'}).click()
    await B.getByRole('button',{name:'Принять задание'}).click()
    await B.evaluate(async()=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      await a.flushAssignmentOutbox()
    })
    // Recipient B may see only independently signed/verified owner policy,
    // not an optimistic pending media permission from A's local selection.
    const verifiedB=await B.evaluate(async({id,owner})=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const row=(await a.listAllServerAssignments())
        .find(x=>x.assignmentId===id&&x.ownerAccountId===owner)
      if(!row)return null
      const goals=a.signedPolicyGoals(row)
      return {
        media:a.signedAllowedAssignmentMedia(row),
        version:row.policyRevision,video:goals.videoGoal,audio:goals.audioGoal,
      }
    },{id:assignmentId,owner:ownerId})
    expect(verifiedB).toEqual({
      media:['photo','video','audio'],version:2,video:2,audio:1,
    })

    await B.getByRole('button',{name:'Открыть',exact:true}).first().click()
    await B.getByRole('button',{name:'Проверить ключ владельца'}).click()
    await expect(B.getByText('Владелец подтверждён')).toBeVisible()
    B.on('dialog',d=>d.accept())
    const buttons=B.getByRole('button',{name:'Отправить медиа в задание'})
    await expect(buttons).toHaveCount(2,{timeout:20_000})
    await buttons.first().click()
    await buttons.last().click()
    await expect.poll(()=>B.evaluate(async()=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      await a.flushAssignmentOutbox()
      return (await a.listAssignmentOperations()).filter(x=>
        x.kind==='media-submit'&&x.state==='sent').length
    }),{timeout:45_000}).toBe(2)

    // Owner A sees true server-confirmed media receipts per signed kind.
    const confirmed=await expect.poll(()=>A.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const row=(await a.listAllServerAssignments())
        .find(x=>x.assignmentId===id)
      return row
        ?[row.confirmedVideoCount??-1,row.confirmedAudioCount??-1].join('/')
        :'missing'
    },assignmentId),{timeout:45_000}).toBe('1/1')
    void confirmed
    const proof=await A.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const row=(await a.listAllServerAssignments()).find(x=>x.assignmentId===id)!
      const result=await a.listAssignmentMediaSubmissions(id)
      return {
        goals:a.signedPolicyGoals(row),
        kinds:result.items.map(x=>x.mediaType).sort(),
        grants:result.items.every(x=>typeof x.mediaGrantId==='string'),
      }
    },assignmentId)
    expect(proof).toEqual({
      goals:{photoGoal:null,videoGoal:2,audioGoal:1},
      kinds:['audio','video'],grants:true,
    })
  }finally{
    await ownerCtx.close()
    await contributorCtx.close()
  }
})
