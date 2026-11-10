import {test,expect} from '@playwright/test'

test('P1-13: owner-signed video/audio policy, fingerprint-confirmed contributor grants and server-authoritative assignment receipts',async({browser})=>{
  test.setTimeout(240000)
  const ownerCtx=await browser.newContext()
  const contributorCtx=await browser.newContext({
    permissions:['camera','microphone','geolocation'],
    geolocation:{latitude:41.647849,longitude:41.639411,accuracy:6},
  })
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
      // The real file chooser is disabled during encryption/refresh/sync.
      // Playwright setInputFiles bypasses disabled input, so wait explicitly
      // instead of pretending a user could select while the form is busy.
      await expect(mediaPanel.getByTestId('media-import-file'))
        .toBeEnabled({timeout:30000})
      await mediaPanel.getByTestId('media-import-file').setInputFiles({
        name,mimeType:mime,buffer:Buffer.alloc(2048,byte),
      })
      await mediaPanel.getByRole('button',{name:'Отправить медиа'}).click()
      // Explicitly drain the durable encrypted outbox. Clicking Sync while
      // the upload started by chooseFile is still running is safe/idempotent.
      await B.evaluate(async()=>{
        const m=await import('/src/features/media/application/media-outbox.ts')
        await m.synchronizeMedia()
      })
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

    // P1-17: owner-signed v6 targets, advanced vocabularies and per-kind rules.
    // Original root remains photo-only and older signed versions unchanged.
    await A.locator('#assignment-allow-video').check()
    await A.locator('#assignment-allow-audio').check()
    await A.locator('#assignment-video-goal').fill('2')
    await A.locator('#assignment-audio-goal').fill('1')
    await A.locator('#assignment-photo-allowed').fill('Report')
    await A.locator('#assignment-photo-required-tags').fill('photo-evidence')
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
        videoGoal:JSON.parse(body.events[0].contract).videoGoal,
        audioGoal:JSON.parse(body.events[0].contract).audioGoal,
      }
    },assignmentId)
    expect(policy).toEqual({http:200,version:6,
      allowed:['photo','video','audio'],videoGoal:2,audioGoal:1})

    // P1-18: the real four-tab editor is a separate route, not a static
    // prototype. It decrypts the private owner envelope and publishes a new
    // owner-account-signed v6 policy after explicit confirmation.
    await A.getByTestId('open-fieldwork-editor').click()
    await expect(A.getByTestId('fieldwork-assignment-editor')).toBeVisible()
    await expect(A.getByTestId('editor-private-title'))
      .toHaveValue('Media v3 opt-in assignment')
    await expect(A.getByRole('tab')).toHaveCount(4)
    await A.getByRole('tab',{name:'Файлы'}).click()
    await expect(A.locator('#editor-video-goal')).toHaveValue('2')
    await expect(A.locator('#editor-audio-goal')).toHaveValue('1')
    await A.getByRole('tab',{name:'Правила'}).click()
    await expect(A.locator('#editor-photo-categories')).toHaveValue('Report')
    await expect(A.locator('#editor-photo-tags')).toHaveValue('photo-evidence')
    const submitEditor=A.getByRole('button',{name:'Подписать и сохранить'})
    await expect(submitEditor).toBeDisabled() // no implicit autosave
    await A.locator('#editor-photo-description-min').fill('0')
    await A.getByRole('tab',{name:'Файлы'}).click()
    await A.getByRole('tab',{name:'Правила'}).click()
    await expect(submitEditor).toBeDisabled() // no semantic change
    await A.getByRole('tab',{name:'Файлы'}).click()
    await A.getByRole('tab',{name:'Участники'}).click()
    await expect(A.getByLabel('ID аккаунта исполнителя')).toBeVisible()
    await A.getByRole('tab',{name:'Правила'}).click()
    await A.locator('#editor-photo-description-min').fill('1')
    await expect(submitEditor).toBeEnabled()
    await submitEditor.click()
    await expect(A.getByText('Изменение подписано и принято сервером.'))
      .toBeVisible({timeout:25000})
    await expect(submitEditor).toBeDisabled()
    const signedEditor=await A.evaluate(async id=>{
      const res=await fetch('/assignments/v1/'+id+'/policy-history',{
        credentials:'same-origin',
      })
      const json=await res.json()
      const latest=JSON.parse(json.events.at(-1).contract)
      return {status:res.status,revision:json.policyRevision,version:latest.version,
        descriptionMinLength:latest.descriptionMinLength,
        advanced:latest.photoAdvanced}
    },assignmentId)
    expect(signedEditor).toEqual({
      status:200,revision:3,version:6,descriptionMinLength:1,
      advanced:{allowedCategories:['Report'],requiredTags:['photo-evidence']},
    })
    // P1-18: real participants tab verifies the peer fingerprint before
    // signing and delivering a contributor invitation, never a media DEK.
    await A.getByRole('tab',{name:'Участники'}).click()
    await A.locator('#editor-recipient-id').fill(contributorId)
    await A.getByRole('button',{name:'Проверить ключ исполнителя'}).click()
    await A.getByLabel('Я независимо сверил отпечаток').check()
    await A.getByRole('button',{name:'Подтвердить ключ'}).click()
    await expect(A.getByText('Отпечаток независимо подтверждён на этом устройстве.'))
      .toBeVisible()
    await A.getByRole('button',{name:'Отправить подписанное приглашение'}).click()
    await expect(A.getByText(/Подписанное приглашение в очереди:/))
      .toBeVisible({timeout:20000})
    // P1-23: the owner sees a real signed invite, NOT an optimistic
    // "accepted participant" inferred from a queued outbox operation.
    await expect(A.getByTestId('editor-participant-'+contributorId))
      .toContainText('Ожидает принятия',{timeout:20000})
    await A.getByRole('link',{name:'Назад к заданиям'}).click()
    await A.getByRole('button',{name:'Открыть',exact:true}).first().click()
    await A.getByRole('button',{name:'Синхронизировать'}).click()

    await B.goto('/assignments')
    await B.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(B.getByText('Приглашения',{exact:true})).toBeVisible()
    await B.getByRole('button',{name:'Ключ владельца'}).click()
    await B.getByLabel('Я сверил отпечаток владельца').check()
    await B.getByRole('button',{name:'Подтвердить владельца'}).click()
    await B.getByRole('button',{name:'Принять задание'}).click()
    // The recipient cannot enumerate the owner's other participants.
    const rosterRecipientStatus=await B.evaluate(async id=>{
      return (await fetch('/assignments/v1/'+id+'/participants')).status
    },assignmentId)
    expect(rosterRecipientStatus).toBe(404)
    await A.goto('/assignments/'+assignmentId+'/edit')
    await A.getByRole('tab',{name:'Участники'}).click()
    const rosterServer=await A.evaluate(async id=>{
      const res=await fetch('/assignments/v1/'+id+'/participants')
      const body=await res.json()
      return {status:res.status,
        recipients:body.items?.map((x:{recipientAccountId:string;state:string})=>
          ({id:x.recipientAccountId,state:x.state}))??[],error:body.error??null}
    },assignmentId)
    expect(rosterServer.status).toBe(200)
    expect(rosterServer.recipients).toContainEqual({
      id:contributorId,state:'accepted',
    })
    // Check the entire panel for a useful diagnostic when the UI is stale.
    await expect(A.getByTestId('editor-participant-roster'))
      .toContainText('Принято сервером',{timeout:20000})
    await expect(A.getByTestId('editor-participant-'+contributorId))
      .toContainText('Принято сервером')
    // Return to the existing owner media-review flow after inspecting roster.
    await A.goto('/assignments')
    await A.getByRole('button',{name:'Открыть',exact:true}).first().click()
    await expect(B.locator('.assignment-card-name').getByText('Media v3 opt-in assignment'))
      .toBeVisible({timeout:20000})
    await B.getByRole('button',{name:'Открыть',exact:true}).first().click()
    await B.getByRole('button',{name:'Проверить ключ владельца'}).click()
    await expect(B.getByText('Владелец подтверждён')).toBeVisible()
    // P1-17: prove the PHOTO path is just as strict as audio/video:
    // no ciphertext when a signed category/tag obligation is unmet.
    await B.goto('/camera?assignmentId='+assignmentId)
    await expect(B.locator('#camera-assignment'))
      .toHaveValue(assignmentId,{timeout:20000})
    await expect.poll(()=>B.evaluate(()=>{
      const video=document.querySelector('.video-frame video') as HTMLVideoElement|null
      return video?.videoWidth??0
    }),{timeout:20000}).toBeGreaterThan(0)
    // The owner's additional signed 1-character description requirement
    // is checked before the independent signed category allowlist.
    await B.locator('#camera-description').fill('Verified photo description for signed v6')
    await B.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(B.getByText('assignment.category_not_allowed')).toBeVisible()
    await B.locator('#camera-category').fill('Report')
    await B.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(B.getByText('assignment.required_tags_missing')).toBeVisible()
    await B.locator('#camera-tags').fill('photo-evidence')
    await B.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(B.getByText(/Зашифровано и сохранено локально/)).toBeVisible()
    const photo=await B.evaluate(async()=>{
      const p=await import('/src/features/photo-sync/application/p1-photo.ts')
      const row=(await p.listLocalPhotos()).find(x=>x.capture)
      if(!row)throw Error('photo.capture_missing')
      const meta=await p.readLocalPhotoMetadata(row.photoId)
      const serialized=JSON.stringify(row)
      return {id:row.photoId,version:meta.version,tags:meta.tags,
        category:meta.category,ciphertextOnly:row.assets.every(x=>x.blob.type==='application/octet-stream'),
        leakedTags:serialized.includes('photo-evidence')}
    })
    expect(photo).toMatchObject({
      version:3,tags:['photo-evidence'],category:'Report',
      ciphertextOnly:true,leakedTags:false,
    })
    await B.evaluate(async()=>{
      const p=await import('/src/features/photo-sync/application/p1-photo.ts')
      await p.flushOutbox()
    })
    await expect.poll(()=>B.evaluate(async id=>{
      const p=await import('/src/features/photo-sync/application/p1-photo.ts')
      return (await p.listLocalPhotos()).find(x=>x.photoId===id)?.state
    },photo.id),{timeout:30000}).toBe('synced')
    await B.goto('/assignments')
    await B.getByRole('button',{name:'Открыть',exact:true}).first().click()
    await B.getByRole('button',{name:'Проверить ключ владельца'}).click()
    await expect(B.getByText('Владелец подтверждён')).toBeVisible()
    await B.getByRole('button',{name:'Отправить в задание'}).click()
    await expect.poll(()=>B.evaluate(async()=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      return (await a.listAssignmentOperations()).some(x=>x.kind==='submit'&&x.state==='sent')
    }),{timeout:30000}).toBe(true)
    await A.getByRole('button',{name:'Обновить материалы'}).click()
    // P1-22: every newly submitted assignment photo uses contributor-signed
    // v2, never a general-purpose v1 personal share.
    const photoScope=await A.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const submission=(await a.listAssignmentSubmissions(id))[0]!
      const res=await fetch('/shares/v1/grants/'+submission.photoGrantId)
      const detail=await res.json()
      const grant=JSON.parse(detail.contract)
      return {status:res.status,version:grant.version,
        assignmentId:grant.assignmentId,scope:grant.scope}
    },assignmentId)
    expect(photoScope).toEqual({status:200,version:2,assignmentId,scope:'read'})
    await expect(A.getByRole('button',{name:'Просмотр'})).toHaveCount(1)
    await A.getByRole('button',{name:'Просмотр'}).click()
    await expect(A.getByTestId('assignment-decrypted-private-metadata'))
      .toContainText('Теги: photo-evidence',{timeout:20000})
    await expect(A.getByTestId('assignment-decrypted-private-metadata'))
      .toContainText('Категория: Report')

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
      .toContainText('Видео: 1 / 2 · Аудио: 1 / 1',{timeout:20000})
    await expect(A.locator('.assignment-detail'))
      .toContainText('Общий прогресс 67%',{timeout:20000})
    await A.getByRole('button',{name:'Обновить материалы'}).click()
    await expect(A.getByTestId('assignment-media-submission')).toHaveCount(2)
    const entries=await A.evaluate(async id=>{
      const session=await import('/src/features/assignments/application/assignment-outbox.ts')
      const m=await session.listAssignmentMediaSubmissions(id)
      return m.items.map(x=>({type:x.mediaType,grantId:x.mediaGrantId}))
    },assignmentId)
    expect(entries.map(x=>x.type).sort()).toEqual(['audio','video'])
    // Both signed v2 media grants bind their DEK-wrapping context to the
    // same accepted assignment ID, not just to their media owner/recipient.
    const scopes=await A.evaluate(async grants=>{
      const checks=[]
      for(const id of grants){
        const res=await fetch('/media-shares/v1/grants/'+id)
        const detail=await res.json()
        const grant=JSON.parse(detail.contract)
        checks.push({status:res.status,version:grant.version,
          assignmentId:grant.assignmentId,scope:grant.scope})
      }
      return checks
    },entries.map(x=>x.grantId))
    expect(scopes).toEqual([
      {status:200,version:2,assignmentId,scope:'read'},
      {status:200,version:2,assignmentId,scope:'read'},
    ])
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
      .toContainText('Видео: 0 / 2 · Аудио: 1 / 1',{timeout:20000})
    await expect(A.locator('.assignment-detail'))
      .toContainText('Общий прогресс 33%',{timeout:20000})
    const intact=await B.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia())
        .filter(x=>x.state==='synced').length
    })
    expect(intact).toBe(2)

    // P1-18 regression: after returning from the separate editor, a fast
    // click on the locally restored card must rebase UNTOUCHED legacy fields
    // when the owner-signed current server policy arrives asynchronously.
    await expect(A.locator('#assignment-allow-audio')).toBeChecked({timeout:20000})
    await expect(A.locator('#assignment-allow-video')).toBeChecked()
    await expect(A.locator('#assignment-audio-goal')).toHaveValue('1')
    // Owner now tightens only AUDIO requirements in signed v6.
    await A.locator('#assignment-audio-required-category').check()
    await A.locator('#assignment-audio-description-min').fill('12')
    await A.locator('#assignment-audio-required-gps').check()
    await A.locator('#assignment-audio-allowed').fill('Report')
    await A.locator('#assignment-audio-required-tags').fill('evidence')
    await A.getByRole('button',{name:'Подписать новые правила'}).click()
    await expect(A.getByText('Версия правил: 4')).toBeVisible({timeout:20000})
    await expect(A.getByTestId('assignment-audio-requirements'))
      .toContainText('описание минимум 12 символов')
    // An already-imported personal audio has NO authenticated private fields:
    // it must never gain an E2EE recipient grant under tightened rules.
    const preflightResult=await B.evaluate(async({assignmentId,ownerId})=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const p=await import('/src/features/assignments/application/media-submission-preflight.ts')
      const g=await import('/src/features/media/application/media-grants.ts')
      const audio=(await m.listLocalMedia()).find(x=>x.mediaType==='audio'&&!x.capture)!
      const before=(await g.listOutgoingMediaGrants()).length
      let rejected=''
      try{await p.preflightAssignmentMediaGrant(assignmentId,audio.mediaId,ownerId)}
      catch(e){rejected=e instanceof Error?e.message:'unknown'}
      return {rejected,before,after:(await g.listOutgoingMediaGrants()).length}
    },{assignmentId,ownerId})
    expect(preflightResult).toEqual({
      rejected:'assignment.category_required',
      before:preflightResult.before,after:preflightResult.before,
    })

    // P1-14: actual Chromium MediaRecorder microphone stream (not a fake
    // uploaded audio file) while the accepted signed policy is cached.
    await B.goto('/camera?assignmentId='+assignmentId)
    await expect(B.locator('#camera-assignment'))
      .toHaveValue(assignmentId,{timeout:20000})
    await B.getByTestId('camera-mode').selectOption('audio')
    await expect(B.getByTestId('camera-start-recording'))
      .toBeEnabled({timeout:20000})
    await B.getByTestId('camera-start-recording').click()
    await expect(B.getByText('assignment.category_required')).toBeVisible()
    await B.locator('#camera-category').fill('Wrong')
    await B.getByTestId('camera-start-recording').click()
    await expect(B.getByText('assignment.description_too_short')).toBeVisible()
    await B.locator('#camera-description').fill('PRIVATE-AUDIO-CAPTURE-METADATA')
    await B.getByTestId('camera-start-recording').click()
    await expect(B.getByText('assignment.gps_required')).toBeVisible()
    await B.getByRole('button',{name:'Получить GPS'}).click()
    await expect(B.getByText(/GPS получен/)).toBeVisible({timeout:12000})
    await B.getByTestId('camera-start-recording').click()
    await expect(B.getByText('assignment.category_not_allowed')).toBeVisible()
    await B.locator('#camera-category').fill('Report')
    await B.getByTestId('camera-start-recording').click()
    await expect(B.getByText('assignment.required_tags_missing')).toBeVisible()
    await B.locator('#camera-tags').fill('evidence')
    await B.getByTestId('camera-start-recording').click()
    await expect(B.getByTestId('camera-recording-status')).toBeVisible()
    await B.waitForTimeout(1600) // actual microphone media data, not debounce
    await B.getByTestId('camera-stop-recording').click()
    await expect(B.getByText(/Запись зашифрована и сохранена локально/))
      .toBeVisible({timeout:30000})
    const recorded=await B.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const row=(await media.listLocalMedia()).find(x=>!!x.capture)
      if(!row?.capture)throw Error('captured.audio_missing')
      const proof=JSON.parse(row.capture.contract)
      const ciphertextOnly=row.chunks.every(c=>c.blob.type==='application/octet-stream')
      return {
        id:row.mediaId,
        type:row.mediaType,
        capturePolicy:proof.policyRevision,
        captureMediaId:proof.mediaId,
        captureAssignment:proof.assignmentId,
        captureKind:proof.mediaType,
        hasPrivateFilename:row.capture.contract.includes('recording-'),
        leakedActualTags:row.capture.contract.includes('evidence'),
        signed:row.capture.signature.length>64,
        ciphertextOnly,
      }
    })
    expect(recorded).toMatchObject({
      type:'audio',capturePolicy:4,captureMediaId:recorded.id,
      captureAssignment:assignmentId,captureKind:'audio',
      hasPrivateFilename:false,leakedActualTags:false,signed:true,ciphertextOnly:true,
    })
    await B.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      await media.synchronizeMedia()
    })
    await expect.poll(()=>B.evaluate(async id=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia()).find(x=>x.mediaId===id)?.state
    },recorded.id),{timeout:30000}).toBe('synced')
    await B.goto('/assignments')
    await B.getByRole('button',{name:'Открыть',exact:true}).first().click()
    await B.getByRole('button',{name:'Проверить ключ владельца'}).click()
    await expect(B.getByText('Владелец подтверждён')).toBeVisible()
    const recordedRow=B.locator('.assignment-detail .photo-row')
      .filter({hasText:recorded.id.slice(0,8)})
      .filter({hasText:'Снято по заданию'})
    await expect(recordedRow).toBeVisible()
    await recordedRow.getByRole('button',{name:'Отправить медиа в задание'}).click()
    await expect.poll(()=>B.evaluate(async()=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      return (await a.listAssignmentOperations())
        .filter(x=>x.kind==='media-submit'&&x.state==='sent').length
    }),{timeout:30000}).toBe(3)
    await A.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(A.getByTestId('assignment-media-counts'))
      .toContainText('Видео: 0 / 2 · Аудио: 2 / 1',{timeout:20000})
    const capturedReceipt=await A.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const res=await a.listAssignmentMediaSubmissions(id)
      return res.items.find(x=>x.capturedInAssignment===true)
    },assignmentId)
    expect(capturedReceipt?.mediaId).toBe(recorded.id)
    const verified=await A.evaluate(async id=>{
      const grant=await import('/src/features/media/application/media-grants.ts')
      const data=await grant.readReceivedMediaGrant(id)
      return {mime:data.blob.type,bytes:data.blob.size,
        fileName:data.metadata.fileName,version:data.metadata.version,
        tags:data.metadata.tags,
        category:data.metadata.category,description:data.metadata.description,
        gps:data.metadata.gps&&{
          latitude:data.metadata.gps.latitude,
          longitude:data.metadata.gps.longitude,
        }}
    },capturedReceipt!.mediaGrantId)
    expect(verified.mime).toMatch(/^audio\//)
    expect(verified.bytes).toBeGreaterThan(128)
    expect(verified.fileName).toMatch(/^recording-/)
    expect(verified.version).toBe(3)
    expect(verified.tags).toEqual(['evidence'])
    expect(verified.category).toBe('Report')
    expect(verified.description).toBe('PRIVATE-AUDIO-CAPTURE-METADATA')
    expect(verified.gps).toEqual({latitude:41.647849,longitude:41.639411})

    // Verify the separate camera+microphone MediaRecorder branch as well.
    await B.goto('/camera?assignmentId='+assignmentId)
    await expect(B.locator('#camera-assignment'))
      .toHaveValue(assignmentId,{timeout:20000})
    await B.getByTestId('camera-mode').selectOption('video')
    await expect(B.getByTestId('camera-start-recording'))
      .toBeEnabled({timeout:20000})
    await B.getByTestId('camera-start-recording').click()
    await expect(B.getByTestId('camera-recording-status')).toBeVisible()
    await B.waitForTimeout(1800) // actual camera+microphone recording
    await B.getByTestId('camera-stop-recording').click()
    await expect(B.getByText(/Запись зашифрована и сохранена локально/))
      .toBeVisible({timeout:30000})
    const videoRecording=await B.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const row=(await media.listLocalMedia()).find(x=>
        x.mediaType==='video'&&!!x.capture)
      if(!row?.capture)throw Error('captured.video_missing')
      const capture=JSON.parse(row.capture.contract)
      return {id:row.mediaId,assignmentId:capture.assignmentId,
        contractId:capture.mediaId,kind:capture.mediaType,
        encrypted:row.chunks.every(c=>c.blob.type==='application/octet-stream')}
    })
    expect(videoRecording).toMatchObject({
      assignmentId,contractId:videoRecording.id,
      kind:'video',encrypted:true,
    })
    await B.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      await media.synchronizeMedia()
    })
    await expect.poll(()=>B.evaluate(async id=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia()).find(x=>x.mediaId===id)?.state
    },videoRecording.id),{timeout:30000}).toBe('synced')
    await B.goto('/assignments')
    await B.getByRole('button',{name:'Открыть',exact:true}).first().click()
    await B.getByRole('button',{name:'Проверить ключ владельца'}).click()
    await expect(B.getByText('Владелец подтверждён')).toBeVisible()
    const videoRow=B.locator('.assignment-detail .photo-row')
      .filter({hasText:videoRecording.id.slice(0,8)})
      .filter({hasText:'Снято по заданию'})
    await expect(videoRow).toBeVisible()
    await videoRow.getByRole('button',{name:'Отправить медиа в задание'}).click()
    await expect.poll(()=>B.evaluate(async()=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      return (await a.listAssignmentOperations())
        .filter(x=>x.kind==='media-submit'&&x.state==='sent').length
    }),{timeout:30000}).toBe(4)
    await A.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(A.getByTestId('assignment-media-counts'))
      .toContainText('Видео: 1 / 2 · Аудио: 2 / 1',{timeout:20000})
    const videoReceipt=await A.evaluate(async({assignmentId,mediaId})=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const res=await a.listAssignmentMediaSubmissions(assignmentId)
      return res.items.find(x=>x.mediaId===mediaId)
    },{assignmentId,mediaId:videoRecording.id})
    expect(videoReceipt?.capturedInAssignment).toBe(true)
    const videoVerified=await A.evaluate(async id=>{
      const grant=await import('/src/features/media/application/media-grants.ts')
      const data=await grant.readReceivedMediaGrant(id)
      return {mime:data.blob.type,bytes:data.blob.size,name:data.metadata.fileName}
    },videoReceipt!.mediaGrantId)
    expect(videoVerified.mime).toMatch(/^video\//)
    expect(videoVerified.bytes).toBeGreaterThan(128)
    expect(videoVerified.name).toMatch(/^recording-/)

    // P1-19: owner can edit E2EE private text AFTER the contributor accepted
    // the original invitation. The same old ECDH invitation decrypts the
    // new, independently signed AEAD envelope with the original shared DEK.
    await A.goto('/assignments/'+assignmentId+'/edit')
    await expect(A.locator('#editor-private-title'))
      .toHaveValue('Media v3 opt-in assignment',{timeout:20000})
    await A.locator('#editor-private-title').fill('PRIVATE UPDATED TITLE 1')
    await A.locator('#editor-private-instructions')
      .fill('NEW CONFIDENTIAL INSTRUCTIONS 1')
    await A.getByRole('tab',{name:'Файлы'}).click()
    await A.locator('#editor-photo-instructions').fill('PRIVATE PHOTO FRAMING 1')
    await A.locator('#editor-video-instructions').fill('PRIVATE VIDEO MOTION 1')
    await A.locator('#editor-audio-instructions').fill('PRIVATE AUDIO NOTES 1')
    await A.getByRole('button',{name:'Подписать и сохранить'}).click()
    await expect(A.getByText('Изменение подписано и принято сервером.'))
      .toBeVisible({timeout:20000})
    const firstPrivate=await A.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const row=(await a.listServerAssignments()).items.find(x=>x.assignmentId===id)!
      const event=row.privateAmendmentContract!
      const contract=JSON.parse(event)
      return {
        rev:row.privateRevision,root:row.privateEnvelope,
        sameWrappedKey:JSON.stringify(contract.privateEnvelope.wrappedKey)
          ===JSON.stringify(row.privateEnvelope.wrappedKey),
        leakTitle:event.includes('PRIVATE UPDATED TITLE 1'),
        leakInstructions:event.includes('NEW CONFIDENTIAL INSTRUCTIONS 1'),
        leakMedia:['PRIVATE PHOTO FRAMING 1','PRIVATE VIDEO MOTION 1',
          'PRIVATE AUDIO NOTES 1'].some(secret=>event.includes(secret)),
      }
    },assignmentId)
    expect(firstPrivate.rev).toBe(2)
    expect(firstPrivate.sameWrappedKey).toBe(true)
    expect(firstPrivate.leakTitle).toBe(false)
    expect(firstPrivate.leakInstructions).toBe(false)
    expect(firstPrivate.leakMedia).toBe(false)
    await B.goto('/assignments')
    await expect(B.locator('.assignment-card-name'))
      .toContainText('PRIVATE UPDATED TITLE 1',{timeout:20000})
    await expect(B.locator('.assignment-card'))
      .toContainText('NEW CONFIDENTIAL INSTRUCTIONS 1')
    await A.getByRole('tab',{name:'Основное'}).click()
    await A.locator('#editor-private-title').fill('PRIVATE UPDATED TITLE 2')
    await A.locator('#editor-private-instructions')
      .fill('SECOND CONFIDENTIAL INSTRUCTIONS 2')
    await A.getByRole('tab',{name:'Файлы'}).click()
    await expect(A.locator('#editor-photo-instructions'))
      .toHaveValue('PRIVATE PHOTO FRAMING 1')
    await A.locator('#editor-photo-instructions').fill('PRIVATE PHOTO FRAMING 2')
    await A.getByRole('button',{name:'Подписать и сохранить'}).click()
    await expect(A.getByText('Изменение подписано и принято сервером.'))
      .toBeVisible({timeout:20000})
    const history=await A.evaluate(async id=>{
      const r=await fetch('/assignments/v1/'+id+'/private-history')
      const data=await r.json()
      return {status:r.status,privateRevision:data.privateRevision,
        events:data.events?.length}
    },assignmentId)
    expect(history).toEqual({status:200,privateRevision:3,events:2})
    await B.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(B.locator('.assignment-card-name'))
      .toContainText('PRIVATE UPDATED TITLE 2',{timeout:20000})
    await expect(B.locator('.assignment-card'))
      .toContainText('SECOND CONFIDENTIAL INSTRUCTIONS 2')
    await B.getByRole('button',{name:'Открыть',exact:true}).click()
    await expect(B.locator('[data-testid="assignment-private-media-instructions"]'))
      .toContainText('PRIVATE PHOTO FRAMING 2')
    await expect(B.locator('[data-testid="assignment-private-media-instructions"]'))
      .toContainText('PRIVATE VIDEO MOTION 1')
    await expect(B.locator('[data-testid="assignment-private-media-instructions"]'))
      .toContainText('PRIVATE AUDIO NOTES 1')
    // P1-24: a contributor reopening the camera gets only the exact
    // CURRENT signed-revision-bound, account-AEAD cached private instructions.
    // They never become server-visible policy fields or media grants.
    await B.goto('/camera?assignmentId='+assignmentId)
    await expect(B.locator('#camera-assignment'))
      .toHaveValue(assignmentId,{timeout:20000})
    await expect(B.getByTestId('camera-private-instructions'))
      .toContainText('PRIVATE PHOTO FRAMING 2',{timeout:20000})
    await expect(B.getByTestId('camera-private-instructions'))
      .not.toContainText('PRIVATE VIDEO MOTION 1')
    // No stale decrypted text may survive assignment deselection.
    await B.locator('#camera-assignment').selectOption('')
    await expect(B.getByTestId('camera-private-instructions')).toHaveCount(0)
    await B.locator('#camera-assignment').selectOption(assignmentId)
    await expect(B.getByTestId('camera-media-instruction'))
      .toContainText('PRIVATE PHOTO FRAMING 2')
    await B.locator('#camera-mode').selectOption('video')
    await expect(B.getByTestId('camera-media-instruction'))
      .toContainText('PRIVATE VIDEO MOTION 1')
    await expect(B.getByTestId('camera-media-instruction'))
      .not.toContainText('PRIVATE AUDIO NOTES 1')
    await B.locator('#camera-mode').selectOption('audio')
    await expect(B.getByTestId('camera-media-instruction'))
      .toContainText('PRIVATE AUDIO NOTES 1')
    // Keep the already restored account alive during this warm-offline
    // assertion. A full page navigation immediately before setOffline()
    // races the asynchronous key-only session bootstrap.
    await B.context().setOffline(true)
    await expect(B.getByTestId('camera-media-instruction'))
      .toContainText('PRIVATE AUDIO NOTES 1')
    const cached=await B.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const row=(await a.listCachedAssignmentSnapshots())
        .find(x=>x.assignmentId===id)!
      const opened=await a.readCachedPrivateAssignment(id,
        a.assignmentPrivateCacheScope(row))
      return {rev:row.privateRevision,title:opened?.title,
        instructions:opened?.instructions,
        photoInstructions:opened?.version===2?opened.photoInstructions:null,
        videoInstructions:opened?.version===2?opened.videoInstructions:null,
        audioInstructions:opened?.version===2?opened.audioInstructions:null}
    },assignmentId)
    expect(cached).toEqual({
      rev:3,title:'PRIVATE UPDATED TITLE 2',
      instructions:'SECOND CONFIDENTIAL INSTRUCTIONS 2',
      photoInstructions:'PRIVATE PHOTO FRAMING 2',
      videoInstructions:'PRIVATE VIDEO MOTION 1',
      audioInstructions:'PRIVATE AUDIO NOTES 1',
    })
    await B.context().setOffline(false)
    // Offline transitions intentionally mark the in-memory identity as
    // offline; restoring network connectivity does NOT silently certify the
    // session. Reauthenticate before making the next verified server read.
    await B.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
    })
    // The participant is still on Camera after P1-24 display assertions.
    // Return through SPA navigation before later schedule checks click
    // the assignment-list "Обновить" action; no cold session bootstrap.
    await B.getByRole('link',{name:'Задания',exact:true}).click()
    await expect(B.getByRole('button',{name:'Обновить',exact:true}))
      .toBeVisible({timeout:20000})

    // P1-20: edit a REAL owner-signed schedule with an accepted contributor
    // still using the original ECDH invitation and the original root policy.
    await A.goto('/assignments/'+assignmentId+'/edit')
    // Route renders an authenticated *local* snapshot immediately. Wait for
    // the network session proof before demanding fresh server authority.
    await A.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
    })
    await expect(A.locator('#editor-schedule-start'))
      .toBeVisible({timeout:20000})
    await expect(A.locator('#editor-schedule-start')).not.toHaveValue('')
    const future=await A.evaluate(()=>{
      const d=new Date(Date.now()+2*86400000)
      d.setSeconds(0,0)
      const pad=(n:number)=>String(n).padStart(2,'0')
      return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())
        +'T'+pad(d.getHours())+':'+pad(d.getMinutes())
    })
    const originalRoot=await A.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const item=(await a.listServerAssignments()).items.find(x=>x.assignmentId===id)!
      return {startsAt:item.startsAt,endsAt:item.endsAt,
        policyContract:item.policyContract,policyRevision:item.policyRevision,
        privateRevision:item.privateRevision}
    },assignmentId)
    await A.locator('#editor-schedule-start').fill(future)
    await expect(A.locator('#editor-block-before')).toBeChecked()
    await A.getByRole('button',{name:'Подписать и сохранить'}).click()
    await expect(A.getByText('Изменение подписано и принято сервером.'))
      .toBeVisible({timeout:20000})
    const blocked=await B.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const row=(await a.listServerAssignments()).items.find(x=>x.assignmentId===id)!
      const e=a.signedAssignmentSchedule(row)
      return {revision:row.scheduleRevision,rawStart:row.startsAt,
        rawEnd:row.endsAt,policyContract:row.policyContract,
        policyRevision:row.policyRevision,privateRevision:row.privateRevision,
        effectiveStartsAt:e.startsAt,blockBeforeStart:e.blockBeforeStart,
        allowedNow:a.schedulePermitsAt(row,Date.now())}
    },assignmentId)
    expect(blocked.revision).toBe(2)
    expect(blocked.rawStart).toBe(originalRoot.startsAt)
    expect(blocked.rawEnd).toBe(originalRoot.endsAt)
    expect(blocked.policyContract).toBe(originalRoot.policyContract)
    expect(blocked.policyRevision).toBe(originalRoot.policyRevision)
    expect(blocked.privateRevision).toBe(originalRoot.privateRevision)
    expect(blocked.effectiveStartsAt).toBeGreaterThan(Date.now())
    expect(blocked.blockBeforeStart).toBe(true)
    expect(blocked.allowedNow).toBe(false)

    // Independently turn OFF only the before-start restriction and enable
    // a future after-end cutoff. Neither action deletes any media ciphertext.
    await A.locator('#editor-block-before').uncheck()
    const finish=await A.evaluate(()=>{
      const d=new Date(Date.now()+4*86400000)
      d.setSeconds(0,0)
      const pad=(n:number)=>String(n).padStart(2,'0')
      return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())
        +'T'+pad(d.getHours())+':'+pad(d.getMinutes())
    })
    await A.locator('#editor-schedule-end').fill(finish)
    await A.locator('#editor-block-after').check()
    await A.getByRole('button',{name:'Подписать и сохранить'}).click()
    await expect(A.getByText('Изменение подписано и принято сервером.'))
      .toBeVisible({timeout:20000})
    const schedule=await B.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const row=(await a.listServerAssignments()).items.find(x=>x.assignmentId===id)!
      const policy=a.signedAssignmentSchedule(row)
      const history=await fetch('/assignments/v1/'+id+'/schedule-history')
      const signed=await history.json()
      return {revision:row.scheduleRevision,
        rootPolicyUnchanged:row.policyContract,
        allowedNow:a.schedulePermitsAt(row,Date.now()),
        allowedAfterEnd:a.schedulePermitsAt(row,policy.endsAt!+1000),
        blockBeforeStart:policy.blockBeforeStart,
        blockAfterEnd:policy.blockAfterEnd,
        historyStatus:history.status,historyCount:signed.events?.length}
    },assignmentId)
    expect(schedule.revision).toBe(3)
    expect(schedule.rootPolicyUnchanged).toBe(originalRoot.policyContract)
    expect(schedule.allowedNow).toBe(true)
    expect(schedule.allowedAfterEnd).toBe(false)
    expect(schedule.blockBeforeStart).toBe(false)
    expect(schedule.blockAfterEnd).toBe(true)
    expect(schedule.historyStatus).toBe(200)
    expect(schedule.historyCount).toBe(2)
    await B.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(B.locator('.assignment-card-name'))
      .toContainText('PRIVATE UPDATED TITLE 2',{timeout:20000})


    // P1-21: retain real contributor originals while adding independent,
    // owner-account-signed future access cutoffs to the same assignment.
    const deadline=(days:number)=>A.evaluate(offset=>{
      const d=new Date(Date.now()+offset*86400000)
      d.setSeconds(0,0)
      const pad=(n:number)=>String(n).padStart(2,'0')
      return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())
        +'T'+pad(d.getHours())+':'+pad(d.getMinutes())
    },days)
    const filesDeadline=await deadline(6)
    const assignmentDeadline=await deadline(8)
    await expect(A.locator('#editor-retention-files-enabled'))
      .toBeEnabled({timeout:20000})
    await A.locator('#editor-retention-files-enabled').check()
    await A.locator('#editor-retention-files-date').fill(filesDeadline)
    await A.locator('#editor-retention-assignment-enabled').check()
    await A.locator('#editor-retention-assignment-date').fill(assignmentDeadline)
    await expect(A.getByRole('checkbox',{
      name:'Удалить также исходные файлы исполнителей',
    })).toBeDisabled()
    await A.getByRole('button',{name:'Подписать и сохранить'}).click()
    await expect(A.getByText('Изменение подписано и принято сервером.'))
      .toBeVisible({timeout:20000})
    const signedRetention=await B.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const row=(await a.listServerAssignments()).items.find(x=>x.assignmentId===id)!
      const retention=a.signedAssignmentRetention(row)
      const res=await fetch('/assignments/v1/'+id+'/retention-history')
      const history=await res.json()
      return {
        revision:row.retentionRevision,
        policyContract:row.policyContract,
        privateRevision:row.privateRevision,
        fileAccessBefore:a.assignmentFilesOpenAt(
          row,retention.filesAccessUntil!-1),
        fileAccessAt:a.assignmentFilesOpenAt(
          row,retention.filesAccessUntil!),
        assignmentAccessAt:a.assignmentOpenAt(
          row,retention.assignmentAccessUntil!),
        removeOriginals:retention.deleteOriginals,
        historyStatus:res.status,historyCount:history.events?.length,
      }
    },assignmentId)
    expect(signedRetention).toEqual({
      revision:2,policyContract:originalRoot.policyContract,
      privateRevision:originalRoot.privateRevision,
      fileAccessBefore:true,fileAccessAt:false,
      assignmentAccessAt:false,removeOriginals:false,
      historyStatus:200,historyCount:1,
    })
    const retentionStatus=await A.evaluate(async id=>{
      const r=await fetch('/assignments/v1/'+id+'/retention-status')
      const status=await r.json()
      return {http:r.status,physicalDeleted:status.physicalDeletionConfirmed,
        physicalStatus:status.physicalStatus}
    },assignmentId)
    expect(retentionStatus).toEqual({
      http:200,physicalDeleted:false,physicalStatus:'not_authorized',
    })

    expect(ownerId).not.toBe(contributorId)
  }finally{
    await ownerCtx.close();await contributorCtx.close()
  }
})
