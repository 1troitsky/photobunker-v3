import {expect,test} from '@playwright/test'

test('P2 Viewer: before/after shows original without exporting or changing edited E2EE derivative',async({browser})=>{
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
      canvas.width=240;canvas.height=160
      const ctx=canvas.getContext('2d')!
      ctx.fillStyle='#f02438';ctx.fillRect(0,0,120,160)
      ctx.fillStyle='#1038d0';ctx.fillRect(120,0,120,160)
      const blob=await new Promise<Blob>((resolve,reject)=>
        canvas.toBlob(v=>v?resolve(v):reject(Error('no_jpeg')),
          'image/jpeg',0.91))
      const m=await import('/src/features/media/application/media-outbox.ts')
      const id=await m.enqueueEncryptedMedia(
        new File([blob],'PRIVATE-COMPARE.jpg',{type:'image/jpeg'}),
        undefined,{category:'Original only',tags:['original']})
      return {id,bytes:blob.size}
    })
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+source.id)
    // Accepted File Viewer opens media in a fixed scene; editor is a sheet.
    await page.getByTestId('viewer-action-edit').click()
    const originalImage=page.getByTestId('file-viewer-image')
    await expect.poll(()=>originalImage.evaluate(
      (el:HTMLImageElement)=>el.naturalWidth)).toBe(240)
    const originalUrl=await originalImage.getAttribute('src')
    await context.setOffline(true)

    const saturation=page.getByTestId('file-viewer-photo-saturation')
    await saturation.focus();await saturation.press('Home')
    await expect(page.getByText('Насыщенность · 0%')).toBeVisible()
    await page.getByTestId('file-viewer-create-crop').click()
    const preview=page.getByTestId('file-viewer-crop-preview')
    await expect(preview).toBeVisible({timeout:30000})
    const readPixel=async()=>{
      return preview.evaluate(async(el:HTMLImageElement)=>{
        await el.decode()
        const c=document.createElement('canvas')
        c.width=el.naturalWidth;c.height=el.naturalHeight
        const ctx=c.getContext('2d')!
        ctx.drawImage(el,0,0)
        return [...ctx.getImageData(30,80,1,1).data.slice(0,3)]
      })
    }
    const after=await readPixel()
    expect(Math.abs(after[0]!-after[1]!)).toBeLessThanOrEqual(4)
    expect(Math.abs(after[1]!-after[2]!)).toBeLessThanOrEqual(4)
    expect(await preview.getAttribute('src')).not.toBe(originalUrl)
    const compare=page.getByTestId('file-viewer-photo-compare')
    await compare.click()
    await expect(compare).toHaveAttribute('aria-pressed','true')
    await expect(page.getByTestId('file-viewer-photo-before-notice')).toBeVisible()
    await expect(preview).toHaveAttribute('src',originalUrl!)
    await expect(page.getByTestId('file-viewer-save-crop')).toHaveCount(0)
    await expect(page.getByTestId('file-viewer-download-crop')).toHaveCount(0)
    await expect(page.getByTestId('file-viewer-create-crop')).toBeDisabled()
    await expect(page.getByTestId('file-viewer-photo-paint-canvas')).toHaveCount(0)
    const before=await readPixel()
    expect(before[0]!).toBeGreaterThan(before[1]!+80)
    expect(before[0]!).toBeGreaterThan(before[2]!+70)
    expect(await page.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).length
    })).toBe(1)

    await compare.click()
    await expect(compare).toHaveAttribute('aria-pressed','false')
    await expect(page.getByTestId('file-viewer-photo-before-notice')).toHaveCount(0)
    const returned=await readPixel()
    expect(Math.abs(returned[0]!-returned[1]!)).toBeLessThanOrEqual(4)
    expect(Math.abs(returned[1]!-returned[2]!)).toBeLessThanOrEqual(4)
    await expect(page.getByTestId('file-viewer-save-crop')).toBeEnabled()
    let downloads=0;page.on('download',()=>{downloads++})
    await page.getByTestId('file-viewer-save-crop').click()
    await expect(page.getByTestId('file-viewer-crop-status'))
      .toContainText('зашифрована в очереди Browser',{timeout:30000})
    const out=await page.evaluate(async id=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const rows=await m.listLocalMedia()
      const first=rows.find(x=>x.mediaId===id)
      const next=rows.find(x=>x.mediaId!==id)
      if(!first||!next)throw Error('missing_independent_copy')
      const file=await m.readLocalMedia(next.mediaId)
      const bitmap=await createImageBitmap(file.blob)
      const ctx=document.createElement('canvas')
      ctx.width=bitmap.width;ctx.height=bitmap.height
      const g=ctx.getContext('2d')!
      g.drawImage(bitmap,0,0)
      const pixel=[...g.getImageData(30,80,1,1).data.slice(0,3)]
      bitmap.close()
      return {
        count:rows.length,sourceBytes:first.plainBytes,
        name:file.metadata.fileName,state:next.state,type:next.mediaType,
        category:file.metadata.category??null,tags:file.metadata.tags??[],
        gps:file.metadata.gps??null,pixel,
      }
    },source.id)
    expect(out).toMatchObject({
      count:2,sourceBytes:source.bytes,state:'queued',type:'photo',
      category:null,tags:[],gps:null,
    })
    expect(out.name).toBe('PRIVATE-COMPARE-crop-0-0-100-100-r0-fx-100-100-0.jpg')
    expect(Math.abs(out.pixel[0]!-out.pixel[1]!)).toBeLessThanOrEqual(4)
    expect(downloads).toBe(0)
    await compare.click()
    await expect(preview).toHaveAttribute('src',originalUrl!)
    await compare.click()
    expect(await preview.getAttribute('src')).not.toBe(originalUrl)

    page.once('dialog',d=>d.accept())
    const download=page.waitForEvent('download')
    await page.getByTestId('file-viewer-download-crop').click()
    expect((await download).suggestedFilename()).toBe(out.name)
    const temporary=await preview.getAttribute('src')
    await page.evaluate(async()=>{
      const {logout}=await import('/src/features/identity/application/session.ts')
      await logout()
    })
    await expect(preview).toHaveCount(0)
    expect(await page.evaluate(async u=>{
      try{return (await fetch(u!)).ok}catch{return false}
    },temporary)).toBe(false)
  }finally{await context.close()}
})
