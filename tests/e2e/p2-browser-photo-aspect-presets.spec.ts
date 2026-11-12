import {expect,test} from '@playwright/test'

test('P2 V-48: authenticated JPEG ratio presets and +90° rotate are real raster pixels, then E2EE save',async({browser})=>{
  test.setTimeout(175000)
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
      const m=await import('/src/features/identity/application/session.ts')
      return !!m.activeSession.value?.accountId
    }),{timeout:30000}).toBe(true)
    await context.setOffline(true)
    const id=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas')
      canvas.width=200;canvas.height=100
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('canvas_unsupported')
      ctx.fillStyle='#e44';ctx.fillRect(0,0,100,100)
      ctx.fillStyle='#25a';ctx.fillRect(100,0,100,100)
      const blob=await new Promise<Blob>((resolve,reject)=>
        canvas.toBlob(x=>x?resolve(x):reject(Error('jpeg_failed')),
          'image/jpeg',0.92))
      const media=await import('/src/features/media/application/media-outbox.ts')
      return media.enqueueEncryptedMedia(new File([blob],
        'RATIO-ORIGINAL.jpg',{type:'image/jpeg'}))
    })
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+id)
    await expect(page.getByTestId('file-viewer-image')).toBeVisible()
    await page.getByTestId('viewer-action-edit').click()
    const img=page.getByTestId('file-viewer-image')
    await expect.poll(()=>img.evaluate((e:HTMLImageElement)=>e.naturalWidth))
      .toBe(200)
    await expect(page.getByTestId('file-viewer-aspect-original'))
      .toHaveAttribute('aria-pressed','true')
    await page.getByTestId('file-viewer-aspect-four-three').click()
    await expect(page.getByTestId('file-viewer-aspect-four-three'))
      .toHaveAttribute('aria-pressed','true')
    await page.getByTestId('file-viewer-create-crop').click()
    const preview=page.getByTestId('file-viewer-crop-preview')
    await expect(preview).toBeVisible({timeout:30000})
    const first=await preview.evaluate((image:HTMLImageElement)=>({
      width:image.naturalWidth,height:image.naturalHeight}))
    expect(first.width/first.height).toBeGreaterThan(1.32)
    expect(first.width/first.height).toBeLessThan(1.35)

    // Recompose after the next preset, not just visually restyle the old blob.
    await page.getByTestId('file-viewer-aspect-square').click()
    await expect(preview).toHaveCount(0)
    await expect(page.getByTestId('file-viewer-aspect-square'))
      .toHaveAttribute('aria-pressed','true')
    await page.getByTestId('file-viewer-rotate-right').click()
    await expect(page.getByTestId('file-viewer-crop-turn')).toHaveValue('1')
    await expect(page.getByTestId('file-viewer-aspect-square'))
      .toHaveAttribute('aria-pressed','true')
    await page.getByTestId('file-viewer-create-crop').click()
    await expect(preview).toBeVisible({timeout:30000})
    const square=await preview.evaluate((image:HTMLImageElement)=>({
      width:image.naturalWidth,height:image.naturalHeight}))
    expect(square).toEqual({width:100,height:100})
    await expect(page.getByTestId('editor-shell-save')).toBeEnabled()
    await context.setOffline(true)
    await page.getByTestId('editor-shell-save').click()
    await expect(page).toHaveURL(
      new RegExp('/browser/file/media/'+id+'$'),{timeout:30000})
    const result=await page.evaluate(async originalId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const records=await m.listLocalMedia()
      const original=records.find(x=>x.mediaId===originalId)
      const derivative=records.find(x=>x.mediaId!==originalId)
      if(!original||!derivative)throw Error('not_saved')
      const output=await m.readLocalMedia(derivative.mediaId)
      const bitmap=await createImageBitmap(output.blob)
      const canvas=document.createElement('canvas')
      canvas.width=bitmap.width;canvas.height=bitmap.height
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('preview_canvas_failed')
      ctx.drawImage(bitmap,0,0)
      const top=[...ctx.getImageData(50,20,1,1).data.slice(0,3)]
      const bottom=[...ctx.getImageData(50,80,1,1).data.slice(0,3)]
      bitmap.close()
      return {
        count:records.length,sourceBytes:original.plainBytes,
        kind:derivative.mediaType,state:derivative.state,
        width:canvas.width,height:canvas.height,
        name:output.metadata.fileName,
        category:output.metadata.category??null,
        gps:output.metadata.gps??null,
        capture:derivative.capture??null,top,bottom,
      }
    },id)
    expect(result).toMatchObject({
      count:2,kind:'photo',state:'queued',width:100,height:100,
      category:null,gps:null,capture:null,
    })
    expect(result.name).toContain('-crop-')
    expect(result.name).toContain('-r90')
    expect(Math.abs(result.top[0]!-result.bottom[0]!)).toBeGreaterThan(40)
    expect(Math.abs(result.top[2]!-result.bottom[2]!)).toBeGreaterThan(40)
    await page.goBack()
    await expect(page).toHaveURL(/\/browser$/)
  }finally{await context.close()}
})
