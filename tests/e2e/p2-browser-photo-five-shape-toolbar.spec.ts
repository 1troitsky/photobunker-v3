import {expect,test} from '@playwright/test'

test('P2 V-50: five real shape tools stay on one mobile row, fill and stroke flatten into encrypted JPEG',async({browser})=>{
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
      const {activeSession}=await import('/src/features/identity/application/session.ts')
      return !!activeSession.value?.accountId
    }),{timeout:30000}).toBe(true)
    await context.setOffline(true)
    const original=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas')
      canvas.width=320;canvas.height=240
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('missing_canvas')
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height)
      const image=await new Promise<Blob>((resolve,reject)=>
        canvas.toBlob(blob=>blob?resolve(blob):reject(Error('jpeg_failed')),
          'image/jpeg',0.9))
      const {enqueueEncryptedMedia}=await import(
        '/src/features/media/application/media-outbox.ts')
      const id=await enqueueEncryptedMedia(new File([image],
        'FIVE-SHAPES-PRIVATE.jpg',{type:'image/jpeg'}),
        undefined,{tags:['private-source']})
      return {id,bytes:image.size}
    })
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+original.id)
    await expect(page.getByTestId('file-viewer-image')).toBeVisible()
    await page.getByTestId('viewer-action-edit').click()
    await expect.poll(()=>page.getByTestId('file-viewer-image')
      .evaluate((image:HTMLImageElement)=>image.naturalWidth)).toBe(320)
    await context.setOffline(true)
    await page.getByTestId('file-viewer-create-crop').click()
    await expect(page.getByTestId('file-viewer-crop-preview'))
      .toBeVisible({timeout:30000})

    const choices=page.getByTestId('file-viewer-shape-choices')
    const kinds=['arrow','circle','square','triangle','star'] as const
    const tools=await Promise.all(kinds.map(async kind=>{
      const button=page.getByTestId('file-viewer-shape-type-'+kind)
      await expect(button).toBeVisible()
      const box=await button.boundingBox()
      if(!box)throw Error('shape_tool_not_positioned_'+kind)
      return box
    }))
    const top=tools[0]!.y
    // The accepted 3.2 five-icon toolbar remains one row at 390px.
    for(const box of tools)expect(Math.abs(box.y-top)).toBeLessThan(2)
    expect(await choices.evaluate(el=>
      el.scrollWidth<=el.clientWidth+1)).toBe(true)
    await expect(page.getByTestId('file-viewer-photo-shape-editor'))
      .toContainText('Фигуры (0/12)')

    // Selecting a type creates a shape only when there is no selection;
    // subsequent type choices mutate the one selected shape, no duplicates.
    await page.getByTestId('file-viewer-shape-type-arrow').click()
    const overlay=page.locator('.file-viewer-photo-shape-layer')
    await expect(overlay).toHaveCount(1)
    await expect(page.getByTestId('file-viewer-shape-filled'))
      .not.toBeChecked()
    for(const kind of ['triangle','square','star','circle'] as const){
      const button=page.getByTestId('file-viewer-shape-type-'+kind)
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed','true')
      await expect(overlay).toHaveCount(1)
      await expect(page.getByTestId('file-viewer-photo-shape-editor'))
        .toContainText('Фигуры (1/12)')
    }
    const stroke=page.getByTestId('file-viewer-shape-stroke-row')
    const fill=page.getByTestId('file-viewer-shape-fill-row')
    await expect(stroke).toBeVisible()
    await expect(fill).toBeVisible()
    const strokeBox=await stroke.boundingBox(),fillBox=await fill.boundingBox()
    if(!strokeBox||!fillBox)throw Error('missing_shape_control_rows')
    expect(fillBox.y).toBeGreaterThan(strokeBox.y+strokeBox.height-1)
    await page.getByTestId('file-viewer-shape-stroke').fill('#ff0000')
    const thickness=page.getByTestId('file-viewer-shape-stroke-width')
    await thickness.focus()
    await thickness.press('Home')
    for(let i=1;i<12;i++)await thickness.press('ArrowRight')
    await expect(thickness).toHaveValue('12')
    await page.getByTestId('file-viewer-shape-fill').fill('#00ff00')
    await expect(page.getByTestId('file-viewer-shape-filled'))
      .not.toBeChecked()
    await page.getByTestId('file-viewer-shape-filled').check()
    await expect(page.getByTestId('file-viewer-shape-filled')).toBeChecked()
    await page.getByTestId('file-viewer-shape-x').fill('25')
    await page.getByTestId('file-viewer-shape-y').fill('25')
    await page.getByTestId('file-viewer-shape-width').fill('50')
    await page.getByTestId('file-viewer-shape-height').fill('50')

    // Undo/Redo must restore the same selected kind, not just the icon.
    await page.getByTestId('file-viewer-photo-undo').click()
    await expect(page.getByTestId('file-viewer-shape-height')).not.toHaveValue('50')
    await page.getByTestId('file-viewer-photo-redo').click()
    await expect(page.getByTestId('file-viewer-shape-height')).toHaveValue('50')

    // A browser pointercancel (touch interruption/app switch) must restore
    // the initial shape position, without recording a partial drag in Undo.
    const shape=page.locator('.file-viewer-photo-shape-layer').first()
    await shape.scrollIntoViewIfNeeded()
    const bounds=await shape.boundingBox()
    if(!bounds)throw Error('shape_overlay_absent')
    const initialX=await page.getByTestId('file-viewer-shape-x').inputValue()
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2)
    await page.mouse.down()
    await page.mouse.move(bounds.x+bounds.width/2+25,
      bounds.y+bounds.height/2+12,{steps:7})
    await expect.poll(()=>page.getByTestId('file-viewer-shape-x').inputValue())
      .not.toBe(initialX)
    await shape.dispatchEvent('pointercancel',{pointerId:1,bubbles:true})
    await page.mouse.up()
    await expect(page.getByTestId('file-viewer-shape-x')).toHaveValue(initialX)

    await expect(page.getByTestId('editor-shell-save')).toBeEnabled()
    await page.getByTestId('editor-shell-save').click()
    await expect(page).toHaveURL(
      new RegExp('/browser/file/media/'+original.id+'$'),{timeout:30000})
    const saved=await page.evaluate(async id=>{
      const {listLocalMedia,readLocalMedia}=await import(
        '/src/features/media/application/media-outbox.ts')
      const rows=await listLocalMedia()
      const source=rows.find(row=>row.mediaId===id)
      const next=rows.find(row=>row.mediaId!==id)
      if(!source||!next)throw Error('missing_shape_derivative')
      const result=await readLocalMedia(next.mediaId)
      const bitmap=await createImageBitmap(result.blob)
      const canvas=document.createElement('canvas')
      canvas.width=bitmap.width;canvas.height=bitmap.height
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('missing_output_canvas')
      ctx.drawImage(bitmap,0,0)
      const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data
      let green=0,red=0
      for(let i=0;i<bytes.length;i+=4){
        if(bytes[i+1]!>bytes[i]!+70&&bytes[i+1]!>bytes[i+2]!+70)green++
        if(bytes[i]!>bytes[i+1]!+70&&bytes[i]!>bytes[i+2]!+70)red++
      }
      bitmap.close()
      return {
        count:rows.length,sourceBytes:source.plainBytes,kind:next.mediaType,
        state:next.state,name:result.metadata.fileName,
        tags:result.metadata.tags??[],gps:result.metadata.gps??null,
        capture:next.capture??null,green,red,
        leak:JSON.stringify(next).includes('#00ff00')
          ||JSON.stringify(next).includes('#ff0000'),
      }
    },original.id)
    expect(saved).toMatchObject({
      count:2,sourceBytes:original.bytes,kind:'photo',state:'queued',
      tags:[],gps:null,capture:null,leak:false,
    })
    expect(saved.name).toContain('-shape.jpg')
    expect(saved.green).toBeGreaterThan(80)
    expect(saved.red).toBeGreaterThan(10)
    await page.goBack()
    await expect(page).toHaveURL(/\/browser$/)
  }finally{await context.close()}
})
