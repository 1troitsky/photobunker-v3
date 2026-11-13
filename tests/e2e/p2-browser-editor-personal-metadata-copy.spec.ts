import {test,expect} from '@playwright/test'

test('P2 V-47: private Info edits create only a separate AES-GCM personal copy without GPS/ACL inheritance',async({browser})=>{
  test.setTimeout(180000)
  const context=await browser.newContext({viewport:{width:390,height:844}})
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    await expect.poll(()=>page.evaluate(async()=>{
      const {activeSession}=await import('/src/features/identity/application/session.ts')
      return !!activeSession.value?.accountId
    }),{timeout:30000}).toBe(true)
    await context.setOffline(true)
    const source=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas')
      canvas.width=160;canvas.height=100
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('no_canvas')
      ctx.fillStyle='#0a7';ctx.fillRect(0,0,160,100)
      const blob=await new Promise<Blob>((resolve,reject)=>
        canvas.toBlob(b=>b?resolve(b):reject(Error('jpeg_failed')),
          'image/jpeg',0.85))
      const m=await import('/src/features/media/application/media-outbox.ts')
      const id=await m.enqueueEncryptedMedia(
        new File([blob],'PRIVATE-METADATA-SOURCE.jpg',{type:'image/jpeg'}),
        undefined,{
          category:'Исходная категория',description:'Приватное описание',
          tags:['source-tag'],gps:{latitude:41.63,longitude:41.61,
            accuracyMeters:9,recordedAt:Date.now()},
        })
      return {id,size:blob.size}
    })
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+source.id)
    await expect(page.getByTestId('file-viewer-image')).toBeVisible()
    await page.getByTestId('viewer-action-edit').click()
    await expect(page).toHaveURL(new RegExp('/browser/file/media/'+source.id+'/edit$'))
    await page.getByTestId('file-editor-tabs')
      .getByRole('button',{name:'Информация'}).click()
    const name=page.getByTestId('private-copy-name')
    await expect(name).toBeVisible({timeout:30000})
    await expect(name).toHaveValue('PRIVATE-METADATA-SOURCE.jpg')
    await expect(page.getByTestId('file-viewer-info'))
      .toContainText('PRIVATE-METADATA-SOURCE.jpg')
    await expect(page.getByTestId('editor-shell-save')).toBeDisabled()
    await name.fill('MISLEADING-MIME.mp4')
    await expect(page.getByTestId('private-copy-invalid')).toBeVisible()
    await expect(page.getByTestId('editor-shell-save')).toBeDisabled()
    await name.fill('PRIVATE-METADATA-EDITED.jpg')
    await page.getByTestId('private-copy-description')
      .fill('Новое описание, зашифрованное на устройстве')
    await page.getByTestId('private-copy-category').fill('Фасад')
    await page.getByRole('button',{name:'Изменить тег source-tag'}).click()
    await page.getByTestId('private-copy-tag-text').fill('visible-private')
    await page.getByTestId('private-copy-tag-editor')
      .getByRole('button',{name:'Готово'}).click()
    await page.getByTestId('private-copy-add-tag').click()
    await page.getByTestId('private-copy-tag-text').fill('field-notes')
    await page.getByTestId('private-copy-tag-editor')
      .getByRole('button',{name:'Готово'}).click()
    await expect(page.getByTestId('private-copy-tags'))
      .toContainText('visible-private')
    await expect(page.getByTestId('editor-shell-save')).toBeEnabled()

    // A refused Cancel preserves ALL unsaved private fields and file identity.
    page.once('dialog',d=>d.dismiss())
    await page.getByTestId('editor-shell-cancel').click()
    await expect(page).toHaveURL(/\/edit$/)
    await expect(name).toHaveValue('PRIVATE-METADATA-EDITED.jpg')
    await expect(page.getByTestId('private-copy-tags'))
      .toContainText('field-notes')

    // Continue entirely offline: E2EE media and metadata must be durable
    // locally without a synthetic Garage ACK or public plaintext metadata.
    await context.setOffline(true)
    page.once('dialog',d=>d.accept())
    await page.getByTestId('editor-shell-save').click()
    await expect(page).toHaveURL(
      new RegExp('/browser/file/media/'+source.id+'$'),{timeout:30000})
    await expect(page.getByText(/Личная копия зашифрована в локальной очереди Browser/))
      .toBeVisible()
    const saved=await page.evaluate(async originalId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const rows=await m.listLocalMedia()
      const before=rows.find(row=>row.mediaId===originalId)
      const copy=rows.find(row=>row.mediaId!==originalId)
      if(!before||!copy)throw Error('missing_personal_copy')
      const original=await m.readLocalMedia(originalId)
      const derivative=await m.readLocalMedia(copy.mediaId)
      const digest=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest(
        'SHA-256',await blob.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
      return {
        count:rows.length,sourceName:original.metadata.fileName,
        sourceDescription:original.metadata.description,
        sourceTags:original.metadata.tags,sourceGps:original.metadata.gps??null,
        copyName:derivative.metadata.fileName,
        copyDescription:derivative.metadata.description,
        copyCategory:derivative.metadata.category,
        copyTags:derivative.metadata.tags,copyGps:derivative.metadata.gps??null,
        copyCaptured:copy.capture??null,sourceBytes:original.blob.size,
        copyBytes:derivative.blob.size,hashEqual:await digest(original.blob)
          ===await digest(derivative.blob),state:copy.state,
        plaintextLeak:JSON.stringify(copy)
          .includes('PRIVATE-METADATA-EDITED.jpg')
          ||JSON.stringify(copy).includes('visible-private'),
      }
    },source.id)
    expect(saved).toMatchObject({
      count:2,sourceName:'PRIVATE-METADATA-SOURCE.jpg',
      sourceDescription:'Приватное описание',sourceTags:['source-tag'],
      sourceGps:{latitude:41.63,longitude:41.61,accuracyMeters:9},
      copyName:'PRIVATE-METADATA-EDITED.jpg',
      copyDescription:'Новое описание, зашифрованное на устройстве',
      copyCategory:'Фасад',copyTags:['visible-private','field-notes'],
      copyGps:null,copyCaptured:null,sourceBytes:source.size,
      copyBytes:source.size,hashEqual:true,state:'queued',
      plaintextLeak:false,
    })
    await page.goBack()
    await expect(page).toHaveURL(/\/browser$/)
  }finally{await context.close()}
})
