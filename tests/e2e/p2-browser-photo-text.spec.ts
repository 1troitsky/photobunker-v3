import {expect,test} from '@playwright/test'

test('P2 Viewer: editable movable photo text is flattened only into new E2EE JPEG',async({browser})=>{
  test.setTimeout(150000)
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
    const original=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas')
      canvas.width=320;canvas.height=240
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('no_canvas')
      ctx.fillStyle='#ffffff'
      ctx.fillRect(0,0,canvas.width,canvas.height)
      const source=await new Promise<Blob>((resolve,reject)=>
        canvas.toBlob(blob=>blob?resolve(blob):reject(Error('jpeg_failed')),
          'image/jpeg',0.92))
      const media=await import('/src/features/media/application/media-outbox.ts')
      const id=await media.enqueueEncryptedMedia(new File([source],
        'PRIVATE-UNANNOTATED.jpg',{type:'image/jpeg'}),undefined,{
        category:'Изначальный оригинал',tags:['do-not-copy'],
      })
      return {id,bytes:source.size}
    })
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+original.id)
    await expect.poll(()=>page.getByTestId('file-viewer-image')
      .evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(320)
    await context.setOffline(true)

    await page.getByTestId('file-viewer-create-crop').click()
    // Report the actual viewer error if a frame was not generated, instead of
    // falsely labeling an asynchronous codec/identity failure as missing UI.
    await expect.poll(()=>page.evaluate(()=>{
      const preview=document.querySelector('[data-testid="file-viewer-crop-preview"]')
      const error=document.querySelector('[data-testid="file-viewer-crop-error"]')
      return error?'error: '+error.textContent:
        preview?'ready':'waiting'
    }),{timeout:30000}).toBe('ready')
    const editor=page.getByTestId('file-viewer-photo-text-editor')
    await expect(editor).toBeVisible()
    // A new Session object with the SAME unlocked package/device may not
    // erase the editor or dispose the image in a Local-First workflow.
    await page.evaluate(async()=>{
      const m=await import('/src/features/identity/application/session.ts')
      const current=m.activeSession.value
      if(!current)throw Error('identity_missing')
      m.activeSession.value={...current,online:false}
    })
    await expect(editor).toBeVisible()
    await page.getByTestId('file-viewer-add-text').click()
    await expect(editor).toContainText('Надписи (1/12)')
    await page.getByTestId('file-viewer-edit-text').fill('Удалить меня')
    await expect(page.locator('.file-viewer-photo-text-layer'))
      .toContainText('Удалить меня')
    await page.getByTestId('file-viewer-delete-text-0').click()
    await expect(editor).toContainText('Надписи (0/12)')
    await expect(page.locator('.file-viewer-photo-text-layer')).toHaveCount(0)

    // Empty edit cannot silently publish a blank or malformed text layer.
    await page.getByTestId('file-viewer-add-text').click()
    await page.getByTestId('file-viewer-edit-text').fill('')
    await page.getByTestId('file-viewer-save-crop').click()
    await expect(page.getByTestId('file-viewer-crop-error'))
      .toContainText('viewer.text_invalid_mark')
    expect(await page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia()).length
    })).toBe(1)

    await page.getByTestId('file-viewer-edit-text').fill('СЕКРЕТ')
    await page.getByTestId('file-viewer-text-color').fill('#ff0000')
    await page.getByTestId('file-viewer-text-x').fill('20')
    await page.getByTestId('file-viewer-text-y').fill('25')
    await expect(page.getByTestId('file-viewer-text-x')).toHaveValue('20')
    await expect(page.getByTestId('file-viewer-text-y')).toHaveValue('25')
    const layer=page.locator('.file-viewer-photo-text-layer')
    await expect(layer).toHaveCount(1)
    await expect(layer).toContainText('СЕКРЕТ')
    const rect=await layer.boundingBox()
    if(!rect)throw Error('text_layer_not_positioned')
    await page.mouse.move(rect.x+Math.min(7,rect.width/2),
      rect.y+Math.min(7,rect.height/2))
    await page.mouse.down()
    await page.mouse.move(rect.x+Math.min(7,rect.width/2)+32,
      rect.y+Math.min(7,rect.height/2)+13,{steps:8})
    await page.mouse.up()
    await expect.poll(()=>page.getByTestId('file-viewer-text-x').inputValue())
      .not.toBe('20')
    let downloads=0
    page.on('download',()=>{downloads++})
    expect(downloads).toBe(0)
    expect(await page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia()).length
    })).toBe(1)

    await page.getByTestId('file-viewer-save-crop').click()
    await expect(page.getByTestId('file-viewer-crop-status'))
      .toContainText('зашифрована в очереди Browser',{timeout:30000})
    const saved=await page.evaluate(async sourceId=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const rows=await media.listLocalMedia()
      const initial=rows.find(x=>x.mediaId===sourceId)
      const next=rows.find(x=>x.mediaId!==sourceId)
      if(!initial||!next)throw Error('missing_encrypted_derivative')
      const decoded=await media.readLocalMedia(next.mediaId)
      const image=await createImageBitmap(decoded.blob)
      const canvas=document.createElement('canvas')
      canvas.width=image.width;canvas.height=image.height
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('missing_canvas_context')
      ctx.drawImage(image,0,0)
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data
      let redPixels=0
      for(let i=0;i<pixels.length;i+=4){
        if(pixels[i]!>pixels[i+1]!+65
          &&pixels[i]!>pixels[i+2]!+65)redPixels++
      }
      image.close()
      return {
        count:rows.length,sourceBytes:initial.plainBytes,
        state:next.state,type:next.mediaType,name:decoded.metadata.fileName,
        category:decoded.metadata.category??null,tags:decoded.metadata.tags??[],
        gps:decoded.metadata.gps??null,capture:next.capture??null,
        width:canvas.width,height:canvas.height,redPixels,
        leak:JSON.stringify(next).includes('СЕКРЕТ'),
        id:next.mediaId,
      }
    },original.id)
    expect(saved).toMatchObject({
      count:2,sourceBytes:original.bytes,state:'queued',type:'photo',
      category:null,tags:[],gps:null,capture:null,
      width:320,height:240,leak:false,
    })
    expect(saved.redPixels).toBeGreaterThan(20)
    expect(saved.name).toBe('PRIVATE-UNANNOTATED-crop-0-0-100-100-r0-text.jpg')
    await expect(page.locator('.file-viewer-photo-text-layer')).toHaveCount(0)
    expect(downloads).toBe(0)
    const visibleUrl=await page.getByTestId('file-viewer-crop-preview')
      .getAttribute('src')

    page.once('dialog',d=>d.accept())
    const download=page.waitForEvent('download')
    await page.getByTestId('file-viewer-download-crop').click()
    expect((await download).suggestedFilename()).toBe(saved.name)
    await page.evaluate(async()=>{
      const {logout}=await import('/src/features/identity/application/session.ts')
      await logout()
    })
    await expect(page.getByTestId('file-viewer-photo-text-editor')).toHaveCount(0)
    expect(await page.evaluate(async url=>{
      try{return (await fetch(url!)).ok}catch{return false}
    },visibleUrl)).toBe(false)
  }finally{await context.close()}
})
