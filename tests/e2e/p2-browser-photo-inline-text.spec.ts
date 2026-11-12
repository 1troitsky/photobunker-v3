import {expect,test} from '@playwright/test'

test('P2 V-49: tap a photo to type text inline, synchronize list/undo/redo, save genuine encrypted JPEG',async({browser})=>{
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
      canvas.width=320;canvas.height=240
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('no_canvas')
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,320,240)
      const blob=await new Promise<Blob>((resolve,reject)=>
        canvas.toBlob(file=>file?resolve(file):reject(Error('no_jpeg')),
          'image/jpeg',0.92))
      const {enqueueEncryptedMedia}=await import(
        '/src/features/media/application/media-outbox.ts')
      const id=await enqueueEncryptedMedia(new File([blob],
        'INLINE-PRIVATE-ORIGINAL.jpg',{type:'image/jpeg'}),
        undefined,{description:'Оригинал нельзя менять',tags:['original']})
      return {id,size:blob.size}
    })
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+source.id)
    await expect(page.getByTestId('file-viewer-image')).toBeVisible()
    await page.getByTestId('viewer-action-edit').click()
    await expect(page).toHaveURL(
      new RegExp('/browser/file/media/'+source.id+'/edit$'))
    await expect.poll(()=>page.getByTestId('file-viewer-image')
      .evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(320)
    await page.getByTestId('file-viewer-create-crop').click()
    const image=page.getByTestId('file-viewer-crop-preview')
    await expect(image).toBeVisible({timeout:30000})
    await expect(page.getByTestId('file-viewer-photo-text-editor'))
      .toContainText('Нажми на фотографию, чтобы добавить текст.')
    const list=page.getByTestId('file-viewer-photo-text-editor')
    await expect(list).toContainText('Надписи (0/12)')
    const marks=page.locator('.file-viewer-photo-text-layer')
    await expect(marks).toHaveCount(0)

    // A blank tap never creates a ghost annotation or history step.
    await image.click({position:{x:50,y:45}})
    await expect(page.getByTestId('file-viewer-inline-text-editor')).toBeVisible()
    await expect(marks).toHaveCount(0)
    await expect(page.getByTestId('editor-shell-save')).toBeDisabled()
    await page.getByTestId('file-viewer-inline-text-cancel').click()
    await expect(page.getByTestId('file-viewer-inline-text-editor')).toHaveCount(0)
    await expect(marks).toHaveCount(0)

    // Place a real label at an actual image pixel and commit with Enter.
    await image.click({position:{x:40,y:35}})
    await page.getByTestId('file-viewer-inline-text-input').fill('ПЕРВАЯ')
    await expect(marks).toHaveCount(0)
    await page.getByTestId('file-viewer-inline-text-input').press('Enter')
    await expect(marks).toHaveCount(1)
    await expect(list).toContainText('Надписи (1/12)')
    await expect(marks.first()).toContainText('ПЕРВАЯ')
    await expect(page.getByTestId('file-viewer-select-text-0'))
      .toContainText('ПЕРВАЯ')

    // Second independently positioned label must appear in BOTH surfaces.
    await image.click({position:{x:105,y:105}})
    await page.getByTestId('file-viewer-inline-text-input').fill('ВТОРАЯ')
    await page.getByTestId('file-viewer-inline-text-done').click()
    await expect(marks).toHaveCount(2)
    await expect(list).toContainText('Надписи (2/12)')
    await expect(page.getByTestId('file-viewer-select-text-1'))
      .toContainText('ВТОРАЯ')

    // Edit from list directly ON image, not a detached decorative label.
    await page.getByRole('button',{
      name:'Редактировать надпись 2 на фото',
    }).click()
    await expect(page.getByTestId('file-viewer-inline-text-input'))
      .toHaveValue('ВТОРАЯ')
    await page.getByTestId('file-viewer-inline-text-input')
      .fill('ОБНОВЛЁННАЯ')
    await page.getByTestId('file-viewer-inline-text-done').click()
    await expect(marks.nth(1)).toContainText('ОБНОВЛЁННАЯ')
    await expect(page.getByTestId('file-viewer-select-text-1'))
      .toContainText('ОБНОВЛЁННАЯ')

    // Undo/Redo changes both the list and image; delete also participates
    // in the same existing 50-state production annotation history.
    await page.getByTestId('file-viewer-photo-undo').click()
    await expect(marks.nth(1)).toContainText('ВТОРАЯ')
    await expect(page.getByTestId('file-viewer-select-text-1'))
      .toContainText('ВТОРАЯ')
    await page.getByTestId('file-viewer-photo-redo').click()
    await expect(marks.nth(1)).toContainText('ОБНОВЛЁННАЯ')
    await page.getByTestId('file-viewer-delete-text-0').click()
    await expect(marks).toHaveCount(1)
    await expect(list).toContainText('Надписи (1/12)')
    await page.getByTestId('file-viewer-photo-undo').click()
    await expect(marks).toHaveCount(2)
    await expect(list).toContainText('Надписи (2/12)')
    await page.getByTestId('file-viewer-photo-redo').click()
    await expect(marks).toHaveCount(1)

    // Selected second label remains visible. Accepted Photo Editor 3.2
    // keeps Color + Size SIDE BY SIDE at 390px, with no clipped native range.
    await page.getByTestId('file-viewer-select-text-0').click()
    const controls=page.getByTestId('file-viewer-text-color-size')
    const rows=await controls.locator('label').evaluateAll(labels=>
      labels.map(label=>{
        const rect=label.getBoundingClientRect()
        return {x:rect.x,y:rect.y,width:rect.width}
      }))
    expect(rows).toHaveLength(2)
    expect(Math.abs(rows[0]!.y-rows[1]!.y)).toBeLessThan(2)
    expect(rows[1]!.x).toBeGreaterThan(rows[0]!.x+rows[0]!.width)
    const overflow=await controls.evaluate(el=>({
      outer:el.scrollWidth-el.clientWidth,
      labels:[...el.querySelectorAll('label')].map(label=>
        label.scrollWidth-label.clientWidth),
    }))
    expect(overflow.outer).toBeLessThanOrEqual(1)
    for(const excess of overflow.labels)expect(excess).toBeLessThanOrEqual(1)
    const fontSizeBefore=await marks.first().evaluate(el=>
      Number.parseFloat(getComputedStyle(el).fontSize))
    // Real HTML range interaction: each input records an undoable change.
    const size=page.getByTestId('file-viewer-text-size')
    await size.focus()
    await size.press('Home')
    for(let i=0;i<8;i++)await size.press('ArrowRight')
    await expect(size).toHaveValue('10')
    await expect.poll(()=>marks.first().evaluate(el=>
      Number.parseFloat(getComputedStyle(el).fontSize)))
      .toBeGreaterThan(fontSizeBefore)
    await page.getByTestId('file-viewer-photo-undo').click()
    await expect(size).toHaveValue('9')
    await page.getByTestId('file-viewer-photo-redo').click()
    await expect(size).toHaveValue('10')

    // Make the actual raster annotation bright red so decrypting the
    // separate E2EE JPEG proves no CSS-only/DOM-only representation.
    await page.getByTestId('file-viewer-text-color').fill('#ff0000')
    await expect(page.getByTestId('editor-shell-save')).toBeEnabled()
    await context.setOffline(true)
    await page.getByTestId('editor-shell-save').click()
    await expect(page).toHaveURL(
      new RegExp('/browser/file/media/'+source.id+'$'),{timeout:30000})
    const result=await page.evaluate(async sourceId=>{
      const {listLocalMedia,readLocalMedia}=await import(
        '/src/features/media/application/media-outbox.ts')
      const rows=await listLocalMedia()
      const original=rows.find(row=>row.mediaId===sourceId)
      const copy=rows.find(row=>row.mediaId!==sourceId)
      if(!original||!copy)throw Error('missing_encrypted_derived_photo')
      const output=await readLocalMedia(copy.mediaId)
      const bitmap=await createImageBitmap(output.blob)
      const canvas=document.createElement('canvas')
      canvas.width=bitmap.width;canvas.height=bitmap.height
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('no_output_canvas')
      ctx.drawImage(bitmap,0,0)
      const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data
      let redPixels=0
      for(let i=0;i<rgba.length;i+=4)
        if(rgba[i]!>rgba[i+1]!+70&&rgba[i]!>rgba[i+2]!+70)redPixels++
      bitmap.close()
      return {
        count:rows.length,originalBytes:original.plainBytes,
        name:output.metadata.fileName,state:copy.state,kind:copy.mediaType,
        width:canvas.width,height:canvas.height,redPixels,
        copyGps:output.metadata.gps??null,capture:copy.capture??null,
        tags:output.metadata.tags??[],
        plaintextLeak:JSON.stringify(copy).includes('ОБНОВЛЁННАЯ'),
      }
    },source.id)
    expect(result).toMatchObject({
      count:2,originalBytes:source.size,state:'queued',kind:'photo',
      width:320,height:240,copyGps:null,capture:null,tags:[],
      plaintextLeak:false,
    })
    expect(result.name).toContain('-text.jpg')
    expect(result.redPixels).toBeGreaterThan(15)
    await page.goBack()
    await expect(page).toHaveURL(/\/browser$/)
  }finally{await context.close()}
})
