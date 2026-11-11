import {expect,test} from '@playwright/test'

test('P2 Viewer: shape stroke and fill flatten into separate E2EE JPEG without leaking mark data',async({browser})=>{
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
    const source=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas')
      canvas.width=320;canvas.height=240
      const ctx=canvas.getContext('2d')!
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,320,240)
      const file=await new Promise<Blob>((resolve,reject)=>
        canvas.toBlob(blob=>blob?resolve(blob):reject(Error('no_jpeg')),
          'image/jpeg',0.9))
      const m=await import('/src/features/media/application/media-outbox.ts')
      const id=await m.enqueueEncryptedMedia(
        new File([file],'SOURCE-SHAPE.jpg',{type:'image/jpeg'}),undefined,{
          category:'Оригинал',tags:['only-original'],
        })
      return {id,bytes:file.size}
    })
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+source.id)
    await expect.poll(()=>page.getByTestId('file-viewer-image')
      .evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(320)
    await context.setOffline(true)
    await page.getByTestId('file-viewer-create-crop').click()
    await expect(page.getByTestId('file-viewer-photo-shape-editor'))
      .toBeVisible({timeout:30000})

    await page.getByTestId('file-viewer-add-shape').click()
    await expect(page.locator('.file-viewer-photo-shape-layer')).toHaveCount(1)
    await page.getByTestId('file-viewer-delete-shape-0').click()
    await expect(page.locator('.file-viewer-photo-shape-layer')).toHaveCount(0)
    await page.getByTestId('file-viewer-add-shape').click()
    await page.getByTestId('file-viewer-shape-kind').selectOption('circle')
    await page.getByTestId('file-viewer-shape-fill').fill('#00ff00')
    await page.getByTestId('file-viewer-shape-stroke').fill('#ff0000')
    await page.getByTestId('file-viewer-shape-filled').check()
    await expect(page.getByTestId('file-viewer-shape-filled')).toBeChecked()
    await page.getByTestId('file-viewer-shape-x').fill('25')
    await page.getByTestId('file-viewer-shape-y').fill('30')
    await expect(page.getByTestId('file-viewer-shape-x')).toHaveValue('25')
    await expect(page.getByTestId('file-viewer-shape-y')).toHaveValue('30')
    const overlay=page.locator('.file-viewer-photo-shape-layer')
    await overlay.scrollIntoViewIfNeeded()
    const box=await overlay.boundingBox()
    if(!box)throw Error('shape_not_positioned')
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2)
    await page.mouse.down()
    await page.mouse.move(box.x+box.width/2+25,box.y+box.height/2+10,
      {steps:6})
    await page.mouse.up()
    await expect.poll(()=>page.getByTestId('file-viewer-shape-x').inputValue())
      .not.toBe('25')
    const rowsBefore=await page.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).length
    })
    expect(rowsBefore).toBe(1)
    let automaticDownloads=0
    page.on('download',()=>{automaticDownloads++})
    expect(automaticDownloads).toBe(0)

    await page.getByTestId('file-viewer-save-crop').click()
    await expect(page.getByTestId('file-viewer-crop-status'))
      .toContainText('зашифрована в очереди Browser',{timeout:30000})
    const data=await page.evaluate(async originalId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const rows=await m.listLocalMedia()
      const initial=rows.find(r=>r.mediaId===originalId)
      const newAsset=rows.find(r=>r.mediaId!==originalId)
      if(!initial||!newAsset)throw Error('missing_asset')
      const decoded=await m.readLocalMedia(newAsset.mediaId)
      const bitmap=await createImageBitmap(decoded.blob)
      const canvas=document.createElement('canvas')
      canvas.width=bitmap.width;canvas.height=bitmap.height
      const ctx=canvas.getContext('2d')!
      ctx.drawImage(bitmap,0,0)
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data
      let green=0,red=0
      for(let i=0;i<pixels.length;i+=4){
        if(pixels[i+1]!>pixels[i]!+70&&pixels[i+1]!>pixels[i+2]!+70)green++
        if(pixels[i]!>pixels[i+1]!+70&&pixels[i]!>pixels[i+2]!+70)red++
      }
      bitmap.close()
      return {
        count:rows.length,sourceBytes:initial.plainBytes,
        mime:decoded.metadata.mime,filename:decoded.metadata.fileName,
        category:decoded.metadata.category??null,tags:decoded.metadata.tags??[],
        gps:decoded.metadata.gps??null,capture:newAsset.capture??null,
        state:newAsset.state,kind:newAsset.mediaType,green,red,
        plaintextLeak:JSON.stringify(newAsset).includes('#00ff00'),
      }
    },source.id)
    expect(data).toMatchObject({
      count:2,sourceBytes:source.bytes,mime:'image/jpeg',
      category:null,tags:[],gps:null,capture:null,
      state:'queued',kind:'photo',plaintextLeak:false,
    })
    expect(data.filename).toBe('SOURCE-SHAPE-crop-0-0-100-100-r0-shape.jpg')
    expect(data.green).toBeGreaterThan(60)
    expect(data.red).toBeGreaterThan(4)
    expect(automaticDownloads).toBe(0)
    await expect(page.locator('.file-viewer-photo-shape-layer')).toHaveCount(0)

    page.once('dialog',d=>d.accept())
    const download=page.waitForEvent('download')
    await page.getByTestId('file-viewer-download-crop').click()
    expect((await download).suggestedFilename()).toBe(data.filename)
    const url=await page.getByTestId('file-viewer-crop-preview').getAttribute('src')
    await page.evaluate(async()=>{
      const {logout}=await import('/src/features/identity/application/session.ts')
      await logout()
    })
    await expect(page.getByTestId('file-viewer-photo-shape-editor')).toHaveCount(0)
    expect(await page.evaluate(async source=>{
      try{return (await fetch(source!)).ok}catch{return false}
    },url)).toBe(false)
  }finally{await context.close()}
})
