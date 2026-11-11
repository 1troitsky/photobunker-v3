import {expect,test} from '@playwright/test'

test('P2 Viewer: real JPEG crop/rotate → preview only → independent encrypted Browser copy',async({browser})=>{
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
      canvas.width=200;canvas.height=100
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('canvas_unsupported')
      ctx.fillStyle='#e44';ctx.fillRect(0,0,100,100)
      ctx.fillStyle='#25a';ctx.fillRect(100,0,100,100)
      const blob=await new Promise<Blob>((resolve,reject)=>
        canvas.toBlob(x=>x?resolve(x):reject(Error('jpeg_failed')),
          'image/jpeg',0.9))
      const media=await import('/src/features/media/application/media-outbox.ts')
      const id=await media.enqueueEncryptedMedia(
        new File([blob],'PRIVATE-ORIGINAL-PHOTO.jpg',{type:'image/jpeg'}),
        undefined,{category:'Оригинал',tags:['keep-original']})
      return {id,bytes:blob.size}
    })
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+original.id)
    const picture=page.getByTestId('file-viewer-image')
    await expect(picture).toBeVisible()
    await expect.poll(()=>picture.evaluate(
      (img:HTMLImageElement)=>img.naturalWidth)).toBe(200)
    await context.setOffline(true)

    // Exercise real native range events. Direct DOM value assignment can
    // bypass Vue's state update and produce a false screenshot-only pass.
    const setRange=async(id:string,value:number,min:number)=>{
      const slider=page.getByTestId(id)
      await slider.focus()
      await slider.press('Home')
      for(let i=min;i<value;i++)await slider.press('ArrowRight')
    }
    // Shrink before shifting — user cannot move a 100%-wide crop off-image.
    await setRange('file-viewer-crop-width',50,10)
    await setRange('file-viewer-crop-height',60,10)
    await setRange('file-viewer-crop-left',10,0)
    await setRange('file-viewer-crop-top',10,0)
    await page.getByTestId('file-viewer-crop-turn').selectOption('1')
    // Native slider input must be reflected in the final encrypted pixels,
    // not merely in a CSS filter on an unmodified image preview.
    const brightness=page.getByTestId('file-viewer-photo-brightness')
    await brightness.focus()
    await brightness.press('ArrowRight')
    await brightness.press('ArrowRight')
    const saturation=page.getByTestId('file-viewer-photo-saturation')
    await saturation.focus()
    await saturation.press('Home')
    const editor=page.getByTestId('file-viewer-photo-editor')
    await expect(editor).toContainText('Ширина · 50%')
    await expect(editor).toContainText('Высота · 60%')
    await expect(editor).toContainText('Слева · 10%')
    await expect(editor).toContainText('Сверху · 10%')
    await expect(editor).toContainText('Яркость · 120%')
    await expect(editor).toContainText('Насыщенность · 0%')

    let downloads=0;page.on('download',()=>{downloads++})
    await page.getByTestId('file-viewer-create-crop').click()
    await expect(page.getByTestId('file-viewer-crop-preview')).toBeVisible()
    const dimensions=await page.getByTestId('file-viewer-crop-preview')
      .evaluate((img:HTMLImageElement)=>({w:img.naturalWidth,h:img.naturalHeight}))
    expect(dimensions).toEqual({w:60,h:100})
    expect(downloads).toBe(0)
    expect(await page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia()).length
    })).toBe(1)

    await page.getByTestId('file-viewer-save-crop').click()
    await expect(page.getByTestId('file-viewer-crop-status'))
      .toContainText('зашифрована в очереди Browser',{timeout:30000})
    const result=await page.evaluate(async originalId=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const rows=await media.listLocalMedia()
      const origin=rows.find(x=>x.mediaId===originalId)
      const derivative=rows.find(x=>x.mediaId!==originalId)
      if(!origin||!derivative)throw Error('no_original_or_derivative')
      const result=await media.readLocalMedia(derivative.mediaId)
      const bytes=new Uint8Array(await result.blob.arrayBuffer())
      const image=await createImageBitmap(result.blob)
      const size={width:image.width,height:image.height}
      const canvas=document.createElement('canvas')
      canvas.width=image.width;canvas.height=image.height
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('missing_derived_canvas')
      ctx.drawImage(image,0,0)
      const grayscale=[...ctx.getImageData(30,20,1,1).data.slice(0,3)]
      image.close()
      return {
        count:rows.length,originalBytes:origin.plainBytes,
        originalState:origin.state,derivativeState:derivative.state,
        type:derivative.mediaType,mime:result.metadata.mime,
        fileName:result.metadata.fileName,category:result.metadata.category??null,
        tags:result.metadata.tags??[],gps:result.metadata.gps??null,
        capture:derivative.capture??null,head:[...bytes.slice(0,3)],
        size,grayscale,derivedId:derivative.mediaId,
        leaked:JSON.stringify(derivative)
          .includes('PRIVATE-ORIGINAL-PHOTO'),
      }
    },original.id)
    expect(result).toMatchObject({
      count:2,originalBytes:original.bytes,derivativeState:'queued',
      type:'photo',mime:'image/jpeg',category:null,tags:[],
      gps:null,capture:null,head:[255,216,255],
      size:{width:60,height:100},leaked:false,
    })
    expect(result.fileName)
      .toBe('PRIVATE-ORIGINAL-PHOTO-crop-10-10-50-60-r90-fx-120-100-0.jpg')
    // Source is split red/blue; actual exported grayscale JPEG must have
    // nearly equal channels even after lossy compression.
    const [rr,gg,bb]=result.grayscale
    expect(Math.abs(rr-gg)).toBeLessThanOrEqual(3)
    expect(Math.abs(gg-bb)).toBeLessThanOrEqual(3)
    expect(downloads).toBe(0)

    page.once('dialog',dialog=>dialog.accept())
    const awaitedDownload=page.waitForEvent('download')
    await page.getByTestId('file-viewer-download-crop').click()
    expect((await awaitedDownload).suggestedFilename()).toBe(result.fileName)
    const previewUrl=await page.getByTestId('file-viewer-crop-preview')
      .getAttribute('src')
    await page.evaluate(async()=>{
      const {logout}=await import('/src/features/identity/application/session.ts')
      await logout()
    })
    await expect(page.getByTestId('file-viewer-crop-preview')).toHaveCount(0)
    expect(await page.evaluate(async url=>{
      try{const res=await fetch(url!);return res.ok}catch{return false}
    },previewUrl)).toBe(false)
  }finally{await context.close()}
})
