import {expect,test} from '@playwright/test'

test('P2 V-45 Editor: Browser → Viewer → Photo Editor, draft gate, E2EE save → same Viewer → Browser',async({browser})=>{
  test.setTimeout(165000)
  const context=await browser.newContext({viewport:{width:390,height:844}})
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    const id=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas')
      canvas.width=160;canvas.height=100
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('no_canvas')
      ctx.fillStyle='#183';ctx.fillRect(0,0,160,100)
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(
        x=>x?resolve(x):reject(Error('jpeg_failed')),'image/jpeg',.88))
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.enqueueEncryptedMedia(new File([blob],
        'EDITOR-PRIVATE-ORIGINAL.jpg',{type:'image/jpeg'}))).id
    })
    await page.goto('/browser')
    await expect(page.getByTestId('browser-row-media:'+id)).toBeVisible()
    await page.getByTestId('browser-row-media:'+id)
      .getByRole('link',{name:'Полный просмотр файла '+id}).click()
    await expect(page).toHaveURL(new RegExp('/browser/file/media/'+id+'$'))
    await expect(page.getByTestId('file-viewer-image')).toBeVisible()

    await page.getByTestId('viewer-action-edit').click()
    await expect(page).toHaveURL(new RegExp('/browser/file/media/'+id+'/edit$'))
    await expect(page.getByTestId('file-editor-tabs').locator('button'))
      .toHaveCount(3)
    await expect(page.getByTestId('editor-shell-save')).toBeDisabled()
    await expect(page.getByTestId('file-viewer-image')).toBeVisible()
    await page.getByTestId('file-editor-tabs').getByRole('button',
      {name:'Информация'}).click()
    await expect(page.getByTestId('file-viewer-info'))
      .toContainText('EDITOR-PRIVATE-ORIGINAL.jpg')
    await page.getByTestId('file-editor-tabs').getByRole('button',
      {name:'Проверка'}).click()
    await expect(page.getByTestId('file-editor-review')).toBeVisible()
    await expect(page.getByTestId('file-editor-review')
      .getByRole('button',{name:'Принять'})).toBeDisabled()
    await page.getByTestId('file-editor-tabs').getByRole('button',
      {name:'Фото'}).click()
    // Verify true Local-First queuing, not a race with Garage's fast ACK.
    // The source was decrypted before going offline; no server call is
    // needed to edit and enqueue a separate encrypted derivative.
    await context.setOffline(true)

    // Compose actual JPEG pixels. Save is NOT available until a derivative
    // is prepared, and an unsaved original must never be silently discarded.
    await expect.poll(()=>page.getByTestId('file-viewer-image')
      .evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(160)
    await page.getByTestId('file-viewer-create-crop').click()
    await expect(page.getByTestId('file-viewer-crop-preview')).toBeVisible()
    await expect(page.getByTestId('editor-shell-save')).toBeEnabled()
    page.once('dialog',dialog=>dialog.dismiss())
    await page.getByTestId('editor-shell-cancel').click()
    await expect(page).toHaveURL(new RegExp('/browser/file/media/'+id+'/edit$'))
    await expect(page.getByTestId('file-viewer-crop-preview')).toBeVisible()

    // Header Save delegates to the existing real E2EE outbox function,
    // not to the prototype IndexedDB or to a synthetic server ACK.
    await page.getByTestId('editor-shell-save').click()
    await expect(page).toHaveURL(new RegExp('/browser/file/media/'+id+'$'))
    await expect(page.getByText(/зашифрован в локальной очереди Browser/))
      .toBeVisible()
    const result=await page.evaluate(async sourceId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const rows=await m.listLocalMedia()
      const original=rows.find(r=>r.mediaId===sourceId)
      const derived=rows.find(r=>r.mediaId!==sourceId)
      if(!original||!derived)throw Error('missing_E2EE_output')
      const source=await m.readLocalMedia(sourceId)
      const output=await m.readLocalMedia(derived.mediaId)
      const bytes=new Uint8Array(await output.blob.arrayBuffer())
      return {count:rows.length,sourceName:source.metadata.fileName,
        derivativeName:output.metadata.fileName,
        derivativeState:derived.state,derivativeType:derived.mediaType,
        jpegHeader:[...bytes.slice(0,3)],gps:output.metadata.gps??null,
        tags:output.metadata.tags??[]}
    },id)
    expect(result).toMatchObject({
      count:2,sourceName:'EDITOR-PRIVATE-ORIGINAL.jpg',
      derivativeState:'queued',derivativeType:'photo',
      jpegHeader:[255,216,255],gps:null,tags:[],
    })
    expect(result.derivativeName).toContain('EDITOR-PRIVATE-ORIGINAL')
    await page.goBack()
    await expect(page).toHaveURL(/\/browser$/)
    await expect(page.getByTestId('viewer-shell-actions')).toHaveCount(0)
  }finally{await context.close()}
})
