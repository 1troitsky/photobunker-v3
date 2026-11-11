import {expect,test} from '@playwright/test'

test('P2 safe-only: source-bound signed E2EE grant decrypts ONLY masked JPEG and revokes read',async({browser})=>{
  test.setTimeout(200000)
  const ownerContext=await browser.newContext()
  const recipientContext=await browser.newContext()
  const owner=await ownerContext.newPage()
  const recipient=await recipientContext.newPage()
  try{
    await owner.goto('/settings')
    await owner.getByRole('button',{name:'Создать ключ'}).click()
    await owner.getByLabel('Я сохранил ключ восстановления').check()
    await owner.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(owner.getByText('Подтверждённая сессия')).toBeVisible()
    await owner.goto('/browser')
    // Registration can leave the initial browser session offline until
    // account proof is refreshed. Test the real authenticated outbox,
    // not a queued-only local bootstrap.
    await owner.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
    })
    const original=await owner.evaluate(async()=>{
      const canvas=document.createElement('canvas')
      canvas.width=320;canvas.height=240
      const ctx=canvas.getContext('2d')!
      ctx.fillStyle='#ed1a36';ctx.fillRect(0,0,320,240)
      ctx.fillStyle='#1ac5ff';ctx.fillRect(12,12,60,45)
      const source=await new Promise<Blob>((resolve,reject)=>
        canvas.toBlob(blob=>blob?resolve(blob):reject(Error('jpeg_failed')),
          'image/jpeg',0.93))
      const media=await import('/src/features/media/application/media-outbox.ts')
      const id=await media.enqueueEncryptedMedia(new File([source],
        'PRIVATE-FACE-ORIGINAL.jpg',{type:'image/jpeg'}),undefined,{
        category:'Private original category',description:'Original secret',
        tags:['never-share-original'],
      })
      return {id,size:source.size}
    })
    await owner.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      await media.synchronizeMedia()
    })
    await expect.poll(()=>owner.evaluate(async sourceId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).find(x=>x.mediaId===sourceId)?.state
    },original.id),{timeout:30000}).toBe('synced')

    await recipient.goto('/settings')
    await recipient.getByRole('button',{name:'Создать ключ'}).click()
    await recipient.getByLabel('Я сохранил ключ восстановления').check()
    await recipient.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(recipient.getByText('Подтверждённая сессия')).toBeVisible()
    const recipientId=await recipient.evaluate(async()=>{
      const s=await import('/src/features/identity/application/session.ts')
      return s.requireSession().accountId
    })
    await recipient.goto('/browser')
    await recipient.evaluate(async()=>{
      const auth=await import('/src/features/identity/application/session.ts')
      await auth.reauthenticate()
      const keys=await import('/src/features/sharing/key-directory.ts')
      await keys.ensureOwnExchangeKey()
    })

    await owner.goto('/browser/file/media/'+original.id)
    await expect.poll(()=>owner.getByTestId('file-viewer-image')
      .evaluate((img:HTMLImageElement)=>img.naturalWidth),
      {timeout:30000}).toBe(320)
    await ownerContext.setOffline(true)
    await owner.getByTestId('file-viewer-create-crop').click()
    await expect(owner.getByTestId('file-viewer-photo-blackout-editor'))
      .toBeVisible({timeout:30000})
    await owner.getByTestId('file-viewer-add-blackout').click()
    await owner.getByTestId('file-viewer-blackout-width').fill('50')
    await owner.getByTestId('file-viewer-blackout-height').fill('50')
    // Only an explicit owner decision may register the local binding. No
    // share is created or transmitted in this offline step.
    const optin=owner.getByTestId('file-viewer-safe-intent')
    await expect(optin).toBeVisible()
    await optin.getByTestId('file-viewer-mark-safe-candidate').check()
    const before=await owner.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).length
    })
    expect(before).toBe(1)
    await owner.getByTestId('file-viewer-save-crop').click()
    await expect(owner.getByTestId('file-viewer-crop-status'))
      .toContainText('Копия отмечена как кандидат Safe',{timeout:30000})
    const edited=await owner.evaluate(async sourceId=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const rows=await media.listLocalMedia()
      const next=rows.find(row=>row.mediaId!==sourceId)
      if(!next)throw Error('safe_copy_not_written')
      const safe=await media.readLocalMedia(next.mediaId)
      const bitmap=await createImageBitmap(safe.blob)
      const canvas=document.createElement('canvas')
      canvas.width=bitmap.width;canvas.height=bitmap.height
      const ctx=canvas.getContext('2d')!
      ctx.drawImage(bitmap,0,0)
      const center=[...ctx.getImageData(160,120,1,1).data.slice(0,3)]
      const side=[...ctx.getImageData(300,120,1,1).data.slice(0,3)]
      bitmap.close()
      return {
        safeId:next.mediaId,state:next.state,center,side,
        mime:safe.metadata.mime,category:safe.metadata.category??null,
        tags:safe.metadata.tags??[],gps:safe.metadata.gps??null,
        originalChunks:rows.find(row=>row.mediaId===sourceId)!.contract.chunks
          .map(chunk=>chunk.chunkId),
      }
    },original.id)
    expect(edited.state).toBe('queued')
    expect(edited.mime).toBe('image/jpeg')
    expect(edited.category).toBeNull()
    expect(edited.tags).toEqual([])
    expect(edited.gps).toBeNull()
    edited.center.forEach(channel=>expect(channel).toBeLessThan(12))
    expect(edited.side[0]).toBeGreaterThan(170)
    expect(await owner.evaluate(async()=>{
      const grants=await import('/src/features/media/application/media-grants.ts')
      return (await grants.listOutgoingMediaGrants()).length
    })).toBe(0)
    await ownerContext.setOffline(false)
    await owner.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      await media.synchronizeMedia()
    })
    await expect.poll(()=>owner.evaluate(async mediaId=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia()).find(x=>x.mediaId===mediaId)?.state
    },edited.safeId),{timeout:30000}).toBe('synced')

    await owner.goto('/browser')
    const share=owner.getByTestId('media-share-panel')
    await expect(share).toBeVisible()
    // A future Public Card policy can be drafted and signed, but MUST
    // neither grant B any read permission nor create a public token.
    await expect(share.getByTestId('media-open-preview-draft'))
      .toBeVisible({timeout:30000})
    await share.getByTestId('media-open-preview-draft').click()
    const futurePolicy=share.getByTestId('media-file-preview-settings')
    await expect.poll(async()=>{
      const problem=await share.locator('[role="alert"]').allTextContents()
      if(problem.length)return 'error: '+problem.join(' | ')
      return await futurePolicy.isVisible()?'visible':'waiting'
    },{timeout:20000}).toBe('visible')
    await expect(futurePolicy).toBeVisible()
    await futurePolicy.getByTestId('media-preview-field-description').check()
    await futurePolicy.getByTestId('media-preview-field-tags').check()
    await expect(futurePolicy.getByText('публикация выключена'))
      .toBeVisible()
    await futurePolicy.getByTestId('media-save-preview-draft').click()
    await expect(share.getByText('Подписанный черновик сохранён. Публикация выключена.'))
      .toBeVisible({timeout:30000})
    await expect(futurePolicy).toContainText('Подписанная ревизия: 1')
    const previewOnly=await owner.evaluate(async safeId=>{
      const api=await import('/src/features/media/application/media-file-preview-policy.ts')
      const policy=await api.loadFilePreviewDraft(safeId)
      const contract=policy.contract!
      const res=await fetch('/media-file-preview/v1/policies/'+safeId)
      const reply=await res.json()
      return {state:policy.state,revision:contract.toRevision,
        publication:contract.publication,fields:contract.fields,
        actions:contract.actions,published:reply.published,
        exposedTokens:JSON.stringify(reply).includes('publicUrl')
          ||JSON.stringify(reply).includes('envelope'),
      }
    },edited.safeId)
    expect(previewOnly).toMatchObject({
      state:'sent',revision:1,publication:'disabled',
      fields:{description:true,tags:true,gps:false},
      actions:{view:false,copy:false,download:false,share:false},
      published:false,exposedTokens:false,
    })
    const unavailable=await recipient.evaluate(async safeId=>{
      const [policy,media]=await Promise.all([
        fetch('/media-file-preview/v1/policies/'+safeId),
        fetch('/media/v1/'+safeId+'/manifests'),
      ])
      return {policy:policy.status,media:media.status}
    },edited.safeId)
    expect(unavailable).toEqual({policy:404,media:404})
    expect(await owner.evaluate(async()=>{
      const grants=await import('/src/features/media/application/media-grants.ts')
      return (await grants.listOutgoingMediaGrants()).length
    })).toBe(0)
    // Revisions form an immutable owner-signed hash chain. No publication
    // or recipient access is created by selecting more metadata fields.
    await futurePolicy.getByTestId('media-preview-field-tags').uncheck()
    await futurePolicy.getByTestId('media-preview-field-updatedAt').check()
    await futurePolicy.getByTestId('media-save-preview-draft').click()
    await expect(share.getByText('Подписанный черновик сохранён. Публикация выключена.'))
      .toBeVisible({timeout:30000})
    await expect(futurePolicy).toContainText('Подписанная ревизия: 2')
    // P2: an owner can sign a PRIVATE editorial association between
    // their own assignment and the separately E2EE-encrypted masked JPEG.
    // The signature cannot prove that a distinct contributor performed it.
    await owner.goto('/assignments')
    await owner.getByRole('button',{name:'Создать задание'}).click()
    await owner.locator('#assignment-title').fill('Private masked editorial assignment')
    await owner.locator('#assignment-instructions')
      .fill('Original and safe copy remain encrypted; not public')
    await owner.getByRole('button',{name:'Создать зашифрованное задание'}).click()
    await owner.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(owner.locator('.assignment-detail code').first())
      .toBeVisible({timeout:30000})
    const assignmentId=(await owner.locator('.assignment-detail code').first()
      .textContent())?.trim()??''
    expect(assignmentId).toMatch(/^[0-9a-f-]{36}$/)
    await owner.getByTestId('open-fieldwork-editor').click()
    await expect(owner.getByTestId('fieldwork-assignment-editor'))
      .toBeVisible()
    await owner.getByRole('tab',{name:'Правила'}).click()
    const ceiling=owner.getByTestId('assignment-preview-ceiling')
    await expect(ceiling).toBeVisible()
    await ceiling.getByTestId('assignment-preview-field-description').check()
    await ceiling.getByTestId('assignment-preview-field-gps').check()
    await ceiling.getByTestId('assignment-preview-save').click()
    await expect(ceiling.getByText(
      'Подписанный черновик потолка задания сохранён. Публичный доступ выключен.',
    )).toBeVisible({timeout:30000})
    await owner.goto('/browser')
    const associatedPanel=owner.getByTestId('media-share-panel')
    await expect(associatedPanel.getByTestId('media-safe-candidate'))
      .toHaveCount(1)
    await associatedPanel.getByTestId('media-open-editorial-binding').click()
    const editorial=associatedPanel.getByTestId('media-editorial-assignment')
    await expect(editorial).toBeVisible()
    await editorial.getByTestId('media-editorial-select')
      .selectOption(assignmentId)
    owner.once('dialog',d=>d.accept())
    await editorial.getByTestId('media-editorial-bind').click()
    await expect(editorial.getByTestId('media-editorial-linked'))
      .toBeVisible({timeout:30000})
    const bound=await owner.evaluate(async safeId=>{
      const res=await fetch('/media-file-preview/v1/assignment-links/'+safeId)
      const data=await res.json()
      return {status:res.status,linked:data.linked,
        published:data.published,assignmentId:data.assignmentId,
        safeMediaId:data.safeMediaId,sourceMediaId:data.sourceMediaId,
        candidateFields:data.candidateFields,
        effectivePublicFields:data.effectivePublicFields,
        contractHash:data.contractHash,
        signed:!!data.contract&&!!data.signature,
      }
    },edited.safeId)
    expect(bound).toMatchObject({
      status:200,linked:true,published:false,assignmentId,
      safeMediaId:edited.safeId,sourceMediaId:original.id,signed:true,
      candidateFields:{description:true,gps:false},
    })
    expect(Object.values(bound.effectivePublicFields).every(x=>x===false))
      .toBe(true)
    const foreign=await recipient.evaluate(async id=>{
      const [link,media]=await Promise.all([
        fetch('/media-file-preview/v1/assignment-links/'+id),
        fetch('/media/v1/'+id+'/manifests'),
      ])
      return {link:link.status,media:media.status}
    },edited.safeId)
    expect(foreign).toEqual({link:404,media:404})
    expect(await owner.evaluate(async()=>{
      const g=await import('/src/features/media/application/media-grants.ts')
      return (await g.listOutgoingMediaGrants()).length
    })).toBe(0)
    owner.once('dialog',d=>d.accept())
    await editorial.getByTestId('media-editorial-detach').click()
    await expect(associatedPanel.getByText(
      'Редакционная привязка отозвана. Файлы и ключи не затронуты.',
    )).toBeVisible({timeout:30000})
    const unlinked=await owner.evaluate(async id=>{
      const res=await fetch('/media-file-preview/v1/assignment-links/'+id)
      return res.status
    },edited.safeId)
    expect(unlinked).toBe(410)

    await share.locator('#media-share-peer-id').fill(recipientId)
    await share.getByRole('button',{name:'Проверить получателя медиа'}).click()
    await expect(share.getByTestId('media-recipient-fingerprint')).not.toBeEmpty()
    await share.getByLabel('Я сверил отпечаток получателя медиа').check()
    await share.getByRole('button',{name:'Подтвердить получателя медиа'}).click()
    await expect(share.getByText('Ключ получателя подтверждён')).toBeVisible()
    await share.getByRole('button',{name:'Обновить медиа-разрешения'}).click()
    await expect(share.getByTestId('media-safe-candidate')).toHaveCount(1)
    await expect(share.getByTestId('media-safe-candidate'))
      .toContainText(edited.safeId.slice(0,8))
    owner.once('dialog',d=>d.accept())
    await share.getByTestId('media-send-safe-derivative').click()
    await expect(share.getByText(/Адресный Safe-грант записан/))
      .toBeVisible({timeout:30000})
    const grant=await owner.evaluate(async()=>{
      const g=await import('/src/features/media/application/media-grants.ts')
      const rows=await g.listOutgoingMediaGrants()
      const safe=rows.find(row=>JSON.parse(row.contract).version===3)
      if(!safe||safe.state!=='sent')throw Error('safe_grant_not_confirmed')
      return {id:safe.id,contract:JSON.parse(safe.contract),signature:safe.signature}
    })
    expect(grant.contract).toMatchObject({
      version:3,scope:'safe_read',mediaId:edited.safeId,
      sourceMediaId:original.id,
    })
    expect(grant.contract.envelope.ciphertext).not.toContain('PRIVATE-FACE')
    // Unrelated recipient and owner routes cannot read original.
    const denied=await recipient.evaluate(async arg=>{
      const manifest=await fetch('/media/v1/'+arg.source+'/manifests',{
        credentials:'same-origin',
      })
      const originalChunk=await fetch('/media-shares/v1/grants/'+arg.grant+
        '/chunks/'+arg.chunk,{credentials:'same-origin'})
      const details=await fetch('/media-shares/v1/grants/'+arg.grant,{
        credentials:'same-origin'})
      const data=await details.json()
      return {
        manifest:manifest.status,originalChunk:originalChunk.status,
        detail:details.status,mediaId:data.mediaId,
        leakedSecret:JSON.stringify(data).includes('Private original category')
          ||JSON.stringify(data).includes('never-share-original'),
      }
    },{source:original.id,grant:grant.id,chunk:edited.originalChunks[0]})
    expect(denied).toEqual({
      manifest:404,originalChunk:404,detail:200,
      mediaId:edited.safeId,leakedSecret:false,
    })
    const recv=recipient.getByTestId('media-share-panel')
    await recv.getByRole('button',{name:'Обновить медиа-разрешения'}).click()
    await expect(recv.getByText('Адресная закрытая JPEG-копия; оригинал не передан'))
      .toBeVisible()
    await recv.getByRole('button',{name:'Проверить отправителя медиа'}).click()
    await recv.getByLabel('Я сверил отпечаток отправителя медиа').check()
    await recv.getByRole('button',{name:'Подтвердить отправителя медиа'}).click()
    await recv.getByRole('button',{name:'Открыть полученное медиа'}).click()
    const revealed=await recipient.evaluate(async grantId=>{
      const g=await import('/src/features/media/application/media-grants.ts')
      const result=await g.readReceivedMediaGrant(grantId)
      const bitmap=await createImageBitmap(result.blob)
      const c=document.createElement('canvas')
      c.width=bitmap.width;c.height=bitmap.height
      const ctx=c.getContext('2d')!
      ctx.drawImage(bitmap,0,0)
      const center=[...ctx.getImageData(160,120,1,1).data.slice(0,3)]
      const side=[...ctx.getImageData(300,120,1,1).data.slice(0,3)]
      bitmap.close()
      return {
        mime:result.blob.type,filename:result.metadata.fileName,
        category:result.metadata.category??null,
        tags:result.metadata.tags??[],gps:result.metadata.gps??null,
        center,side,
      }
    },grant.id)
    expect(revealed.mime).toBe('image/jpeg')
    expect(revealed.category).toBeNull()
    expect(revealed.tags).toEqual([])
    expect(revealed.gps).toBeNull()
    revealed.center.forEach(channel=>expect(channel).toBeLessThan(12))
    expect(revealed.side[0]).toBeGreaterThan(170)
    expect(revealed.filename).toContain('-blackout.jpg')
    await share.getByRole('button',{name:'Отозвать медиа'}).click()
    await expect(share.getByText('Серверный доступ отозван'))
      .toBeVisible({timeout:30000})
    const revoked=await recipient.evaluate(async grantId=>{
      const [g,all]=await Promise.all([
        fetch('/media-shares/v1/grants/'+grantId,{credentials:'same-origin'}),
        fetch('/media-shares/v1/received',{credentials:'same-origin'}),
      ])
      return {
        status:g.status,received:(await all.json()).items.length,
      }
    },grant.id)
    expect(revoked).toEqual({status:410,received:0})
    const originalStillAvailable=await owner.evaluate(async mediaId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const original=await m.readLocalMedia(mediaId)
      return {
        filename:original.metadata.fileName,size:original.blob.size,
        category:original.metadata.category,
      }
    },original.id)
    expect(originalStillAvailable).toEqual({
      filename:'PRIVATE-FACE-ORIGINAL.jpg',size:original.size,
      category:'Private original category',
    })
  }finally{
    await ownerContext.close()
    await recipientContext.close()
  }
})
