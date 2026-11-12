import {expect,test} from '@playwright/test'

test('P2 V55: >4096px / >16.8MP encrypted JPEG preserves native pixels; low-memory fails closed',async({browser})=>{
  test.setTimeout(240000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    await expect.poll(()=>page.evaluate(async()=>{
      const m=await import('/src/features/identity/application/session.ts')
      return !!m.activeSession.value?.accountId
    }),{timeout:30000}).toBe(true)
    await context.setOffline(true)
    // Real photo wider than old 4096 cap AND with more than old 16.8MP.
    const original=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas')
      canvas.width=5200;canvas.height=3400
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('large_source_canvas_unavailable')
      ctx.fillStyle='#ec3b40';ctx.fillRect(0,0,5200,3400)
      ctx.fillStyle='#1976d2';ctx.fillRect(0,0,450,500)
      const blob=await new Promise<Blob>((resolve,reject)=>
        canvas.toBlob(x=>x?resolve(x):reject(Error('large_source_encode_failed')),
          'image/jpeg',0.89))
      canvas.width=0;canvas.height=0
      const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())
      const media=await import('/src/features/media/application/media-outbox.ts')
      const id=await media.enqueueEncryptedMedia(new File(
        [blob],'PRIVATE-FULLRES-SOURCE.jpg',{type:'image/jpeg'}),
        undefined,{category:'Never inherited in derivative',tags:['private']})
      return {id,size:blob.size,hash:[...new Uint8Array(hash)]}
    })
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+original.id)
    await page.getByTestId('viewer-action-edit').click()
    const image=page.getByTestId('file-viewer-image')
    await expect.poll(()=>image.evaluate((img:HTMLImageElement)=>img.naturalWidth),{
      timeout:30000,
    }).toBe(5200)
    await context.setOffline(true)
    // Even when preview is visible at <=1MP, an underpowered device must
    // REFUSE a full-resolution encode rather than silently save 4096px.
    const live=page.getByTestId('file-viewer-photo-live-preview')
    await expect(live).toBeVisible()
    const previewWidth=await live.evaluate((c:HTMLCanvasElement)=>c.width)
    expect(previewWidth).toBeLessThanOrEqual(1024)
    await page.evaluate(()=>Object.defineProperty(navigator,'deviceMemory',{
      configurable:true,value:2,
    }))
    await page.getByTestId('file-viewer-create-crop').click()
    await expect(page.getByTestId('file-viewer-crop-error'))
      .toContainText('не будет уменьшено автоматически',{timeout:15000})
    await expect(page.getByTestId('file-viewer-crop-preview')).toHaveCount(0)
    await expect(page.getByTestId('editor-shell-save')).toBeDisabled()
    expect((await page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia()).length
    }))).toBe(1)

    // Simulate adequate memory in this disposable Chromium context only.
    // The actual encoder, decoded raster and encrypted outbox remain real.
    await page.evaluate(()=>Object.defineProperty(navigator,'deviceMemory',{
      configurable:true,value:8,
    }))
    await page.getByTestId('file-viewer-create-crop').click()
    const raster=page.getByTestId('file-viewer-crop-preview')
    await expect(raster).toBeVisible({timeout:90000})
    await expect.poll(()=>raster.evaluate((img:HTMLImageElement)=>({
      width:img.naturalWidth,height:img.naturalHeight,
    })),{timeout:90000}).toEqual({width:5200,height:3400})

    await page.getByTestId('file-viewer-add-blackout').click()
    await page.getByTestId('file-viewer-blackout-width').fill('50')
    await page.getByTestId('file-viewer-blackout-height').fill('50')
    await expect(page.locator('.file-viewer-photo-blackout-layer'))
      .toHaveCount(1)
    await page.getByTestId('file-viewer-save-crop').click()
    await expect(page.getByTestId('file-viewer-crop-status'))
      .toContainText('зашифрована в очереди Browser',{timeout:90000})

    // This is decrypted ciphertext from the genuine Local-First AES-GCM
    // pipeline, not a screenshot or an untrusted filename/DOM assertion.
    const saved=await page.evaluate(async originalId=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const rows=await media.listLocalMedia()
      const source=rows.find(x=>x.mediaId===originalId)
      const derivative=rows.find(x=>x.mediaId!==originalId)
      if(!source||!derivative||rows.length!==2)throw Error('missing_encrypted_pair')
      const decrypted=await media.readLocalMedia(derivative.mediaId)
      const originalRead=await media.readLocalMedia(originalId)
      const bitmap=await createImageBitmap(decrypted.blob)
      const canvas=document.createElement('canvas')
      canvas.width=bitmap.width;canvas.height=bitmap.height
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('missing_decrypted_jpeg_canvas')
      ctx.drawImage(bitmap,0,0)
      const mask=[...ctx.getImageData(2600,1700,1,1).data.slice(0,3)]
      const unmasked=[...ctx.getImageData(1000,100,1,1).data.slice(0,3)]
      const dimensions={width:bitmap.width,height:bitmap.height}
      bitmap.close();canvas.width=0;canvas.height=0
      const hash=await crypto.subtle.digest('SHA-256',
        await originalRead.blob.arrayBuffer())
      return {
        dimensions,mask,unmasked,
        sourceBytes:source.plainBytes,sourceHash:[...new Uint8Array(hash)],
        mediaCount:rows.length,
        mediaState:derivative.state,type:derivative.mediaType,
        fileName:decrypted.metadata.fileName,
        category:decrypted.metadata.category??null,
        gps:decrypted.metadata.gps??null,
        capture:derivative.capture??null,
      }
    },original.id)
    expect(saved).toMatchObject({
      dimensions:{width:5200,height:3400},
      mediaCount:2,mediaState:'queued',type:'photo',
      sourceBytes:original.size,sourceHash:original.hash,
      category:null,gps:null,capture:null,
    })
    expect(saved.fileName).not.toContain('PRIVATE-FULLRES-SOURCE.jpg')
    expect(Math.max(...saved.mask)).toBeLessThan(12)
    expect(saved.unmasked[0]).toBeGreaterThan(140)
  }finally{
    await context.close()
  }
})
