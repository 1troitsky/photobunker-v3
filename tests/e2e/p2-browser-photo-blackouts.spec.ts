import {expect,test} from '@playwright/test'

test('P2 Viewer: opaque blackout overwrites JPEG pixels only in a new encrypted personal derivative',async({browser})=>{
  test.setTimeout(180000)
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
      if(!ctx)throw Error('canvas_unsupported')
      ctx.fillStyle='#ed1a36'
      ctx.fillRect(0,0,320,240)
      ctx.fillStyle='#26b8f5'
      ctx.fillRect(10,10,70,40)
      const blob=await new Promise<Blob>((resolve,reject)=>
        canvas.toBlob(x=>x?resolve(x):reject(Error('jpeg_failed')),
          'image/jpeg',0.94))
      const media=await import('/src/features/media/application/media-outbox.ts')
      const id=await media.enqueueEncryptedMedia(new File([blob],
        'PRIVATE-ORIGINAL-BLACKOUT.jpg',{type:'image/jpeg'}),undefined,{
        category:'Original evidence',tags:['never-publish-original'],
        description:'Private sensitive original',
      })
      const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())
      return {id,bytes:blob.size,sha:[...new Uint8Array(hash)]}
    })
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+original.id)
    // Accepted File Viewer opens media in a fixed scene; editor is a sheet.
    await page.getByTestId('viewer-action-edit').click()
    await expect.poll(()=>page.getByTestId('file-viewer-image')
      .evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(320)
    const sourceUrl=await page.getByTestId('file-viewer-image').getAttribute('src')
    await context.setOffline(true)
    await page.getByTestId('file-viewer-create-crop').click()
    await expect(page.getByTestId('file-viewer-crop-preview'))
      .toBeVisible({timeout:30000})
    const maskedEditor=page.getByTestId('file-viewer-photo-blackout-editor')
    await expect(maskedEditor).toBeVisible()
    await page.getByTestId('file-viewer-add-blackout').click()
    await expect(page.locator('.file-viewer-photo-blackout-layer'))
      .toHaveCount(1)
    // Removal is reversible; undo brings a volatile mask back.
    await page.getByTestId('file-viewer-delete-blackout-0').click()
    await expect(page.locator('.file-viewer-photo-blackout-layer')).toHaveCount(0)
    await page.getByTestId('file-viewer-photo-undo').click()
    await expect(page.locator('.file-viewer-photo-blackout-layer')).toHaveCount(1)
    await page.getByTestId('file-viewer-photo-redo').click()
    await expect(page.locator('.file-viewer-photo-blackout-layer')).toHaveCount(0)
    await page.getByTestId('file-viewer-add-blackout').click()
    await page.getByTestId('file-viewer-blackout-width').fill('50')
    await page.getByTestId('file-viewer-blackout-height').fill('50')
    await expect(page.getByTestId('file-viewer-blackout-width')).toHaveValue('50')
    await expect(page.getByTestId('file-viewer-blackout-height')).toHaveValue('50')
    const region=page.locator('.file-viewer-photo-blackout-layer')
    await region.scrollIntoViewIfNeeded()
    const rect=await region.boundingBox()
    if(!rect)throw Error('mask_missing_bounds')
    await page.mouse.move(rect.x+Math.min(rect.width/2,15),
      rect.y+Math.min(rect.height/2,15))
    await page.mouse.down()
    await page.mouse.move(rect.x+Math.min(rect.width/2,15)+12,
      rect.y+Math.min(rect.height/2,15)+8,{steps:6})
    await page.mouse.up()
    await expect.poll(()=>page.getByTestId('file-viewer-blackout-x').inputValue())
      .not.toBe('25')
    // Reposition exactly for pixel-level assertions.
    await page.getByTestId('file-viewer-blackout-x').fill('25')
    await page.getByTestId('file-viewer-blackout-y').fill('25')
    await expect(page.getByTestId('file-viewer-blackout-x')).toHaveValue('25')
    await expect(page.getByTestId('file-viewer-blackout-y')).toHaveValue('25')
    const compare=page.getByTestId('file-viewer-photo-compare')
    await compare.click()
    await expect(page.locator('.file-viewer-photo-blackout-layer')).toHaveCount(0)
    await expect(page.getByTestId('file-viewer-crop-preview'))
      .toHaveAttribute('src',sourceUrl!)
    await expect(page.getByTestId('file-viewer-save-crop')).toHaveCount(0)
    await compare.click()
    await expect(region).toHaveCount(1)

    // Changing brightness must NOT silently delete the SAFE blackout mask,
    // its precise geometry, private source integrity or undo history.
    const brightness=page.getByTestId('file-viewer-photo-brightness')
    await brightness.focus()
    await brightness.press('ArrowRight')
    await expect(page.getByTestId('file-viewer-crop-preview')).toHaveCount(0)
    // Live V55 preview must ALSO composite previously placed safe blackouts
    // LAST; their pixels stay fully opaque after changing RGB values.
    const live=page.getByTestId('file-viewer-photo-live-preview')
    await expect(live).toBeVisible()
    await expect.poll(()=>live.evaluate((c:HTMLCanvasElement)=>{
      const ctx=c.getContext('2d')
      if(!ctx)throw Error('missing_blackout_live_canvas')
      return [...ctx.getImageData(
        Math.floor(c.width/2),Math.floor(c.height/2),1,1).data.slice(0,3)]
    })).toEqual([0,0,0])
    await expect(page.getByTestId('file-viewer-crop-status'))
      .toContainText('закрытые области и история сохранены в памяти')
    await expect(page.getByTestId('editor-shell-save')).toBeDisabled()
    await page.getByTestId('file-viewer-create-crop').click()
    await expect(page.getByTestId('file-viewer-crop-preview'))
      .toBeVisible({timeout:30000})
    await expect(region).toHaveCount(1)
    await expect(page.getByTestId('file-viewer-blackout-x')).toHaveValue('25')
    await expect(page.getByTestId('file-viewer-blackout-y')).toHaveValue('25')
    await expect(page.getByTestId('file-viewer-blackout-width')).toHaveValue('50')
    await expect(page.getByTestId('file-viewer-blackout-height')).toHaveValue('50')
    await expect(page.getByTestId('file-viewer-photo-undo')).toBeEnabled()

    const filesBefore=await page.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).length
    })
    expect(filesBefore).toBe(1)
    let automaticDownloads=0;page.on('download',()=>automaticDownloads++)
    await page.getByTestId('file-viewer-save-crop').click()
    await expect(page.getByTestId('file-viewer-crop-status'))
      .toContainText('зашифрована в очереди Browser',{timeout:30000})
    const result=await page.evaluate(async originalId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const rows=await m.listLocalMedia()
      const old=rows.find(x=>x.mediaId===originalId)
      const next=rows.find(x=>x.mediaId!==originalId)
      if(!old||!next)throw Error('missing_source_or_masked_copy')
      const source=await m.readLocalMedia(originalId)
      const hashed=await crypto.subtle.digest('SHA-256',await source.blob.arrayBuffer())
      const saved=await m.readLocalMedia(next.mediaId)
      const bytes=new Uint8Array(await saved.blob.arrayBuffer())
      const bitmap=await createImageBitmap(saved.blob)
      const c=document.createElement('canvas')
      c.width=bitmap.width;c.height=bitmap.height
      const ctx=c.getContext('2d')!
      ctx.drawImage(bitmap,0,0)
      const center=[...ctx.getImageData(160,120,1,1).data.slice(0,3)]
      const exposed=[...ctx.getImageData(300,120,1,1).data.slice(0,3)]
      bitmap.close()
      return {
        count:rows.length,oldBytes:old.plainBytes,
        sourceHash:[...new Uint8Array(hashed)],
        originalState:old.state,derivedState:next.state,
        type:next.mediaType,mime:saved.metadata.mime,
        filename:saved.metadata.fileName,
        tags:saved.metadata.tags??[],category:saved.metadata.category??null,
        gps:saved.metadata.gps??null,capture:next.capture??null,
        center,exposed,width:c.width,height:c.height,
        jpeg:[...bytes.slice(0,3)],
        keyLeak:JSON.stringify(next).includes('never-publish-original'),
      }
    },original.id)
    expect(result).toMatchObject({
      count:2,oldBytes:original.bytes,sourceHash:original.sha,
      derivedState:'queued',type:'photo',mime:'image/jpeg',
      tags:[],category:null,gps:null,capture:null,
      jpeg:[255,216,255],width:320,height:240,keyLeak:false,
    })
    expect(result.filename)
      .toBe('PRIVATE-ORIGINAL-BLACKOUT-crop-0-0-100-100-r0-fx-110-100-100-blackout.jpg')
    for(const channel of result.center)
      expect(channel).toBeLessThan(10)
    expect(result.exposed[0]).toBeGreaterThan(175)
    expect(result.exposed[1]).toBeLessThan(110)
    expect(automaticDownloads).toBe(0)
    await expect(region).toHaveCount(0) // actual flattened JPEG, no overlay

    page.once('dialog',d=>d.accept())
    const download=page.waitForEvent('download')
    await page.getByTestId('file-viewer-download-crop').click()
    expect((await download).suggestedFilename()).toBe(result.filename)
    const previewUrl=await page.getByTestId('file-viewer-crop-preview')
      .getAttribute('src')
    await page.evaluate(async()=>{
      const {logout}=await import('/src/features/identity/application/session.ts')
      await logout()
    })
    await expect(maskedEditor).toHaveCount(0)
    expect(await page.evaluate(async url=>{
      try{return (await fetch(url!)).ok}catch{return false}
    },previewUrl)).toBe(false)
  }finally{await context.close()}
})
