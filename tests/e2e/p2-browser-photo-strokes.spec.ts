import {expect,test} from '@playwright/test'

test('P2 Viewer: real brush/pencil/eraser + Undo/Redo -> isolated E2EE JPEG pixels',async({browser})=>{
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
      const session=await import('/src/features/identity/application/session.ts')
      return !!session.activeSession.value?.accountId
    }),{timeout:30000}).toBe(true)
    await context.setOffline(true)

    const original=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas')
      canvas.width=320;canvas.height=240
      const ctx=canvas.getContext('2d')
      if(!ctx)throw Error('missing_canvas')
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,320,240)
      const blob=await new Promise<Blob>((resolve,reject)=>
        canvas.toBlob(v=>v?resolve(v):reject(Error('jpeg_failed')),
          'image/jpeg',0.92))
      const media=await import('/src/features/media/application/media-outbox.ts')
      const id=await media.enqueueEncryptedMedia(new File([blob],
        'PRIVATE-SOURCE-BRUSH.jpg',{type:'image/jpeg'}),undefined,{
        category:'Оригинал',tags:['do-not-share'],description:'Исходный файл',
      })
      return {id,size:blob.size}
    })
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+original.id)
    // Accepted File Viewer opens media in a fixed scene; editor is a sheet.
    await page.getByTestId('viewer-action-edit').click()
    await expect.poll(()=>page.getByTestId('file-viewer-image')
      .evaluate((v:HTMLImageElement)=>v.naturalWidth),
      {timeout:30000}).toBe(320)
    await context.setOffline(true)
    await page.getByTestId('file-viewer-create-crop').click()
    const canvas=page.getByTestId('file-viewer-photo-paint-canvas')
    await expect(canvas).toBeVisible({timeout:30000})
    // Approved Photo Editor 3.2: three actual SVG icon tools in ONE mobile row,
    // followed by Color + Thickness in another single horizontal row.
    const toolKinds=['brush','pencil','eraser'] as const
    const coords=[] as {x:number;y:number;width:number;height:number}[]
    for(const kind of toolKinds){
      const button=page.getByTestId('file-viewer-tool-'+kind)
      await expect(button).toBeVisible()
      await expect(button.locator('svg')).toHaveCount(1)
      const box=await button.boundingBox()
      if(!box)throw Error('tool_not_positioned_'+kind)
      coords.push(box)
    }
    for(const box of coords)
      expect(Math.abs(box.y-coords[0]!.y)).toBeLessThan(2)
    const settings=page.getByTestId('file-viewer-photo-paint-settings')
    await expect(settings).toBeVisible()
    const color=await page.getByTestId('file-viewer-paint-color').boundingBox()
    const thickness=await page.getByTestId('file-viewer-paint-width').boundingBox()
    if(!color||!thickness)throw Error('paint_controls_not_positioned')
    expect(Math.abs(color.y-thickness.y)).toBeLessThan(23)
    expect(await settings.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
      .toBe(true)
    await page.getByTestId('file-viewer-tool-brush').click()
    await expect(page.getByTestId('file-viewer-tool-brush'))
      .toHaveAttribute('aria-pressed','true')
    await expect(page.getByTestId('file-viewer-tool-brush'))
      .toHaveClass(/selected/)
    await page.getByTestId('file-viewer-paint-color').fill('#00cc00')
    const width=page.getByTestId('file-viewer-paint-width')
    await width.focus()
    await width.press('Home')
    for(let i=2;i<24;i++)await width.press('ArrowRight')
    await expect(page.getByText('Толщина · 24')).toBeVisible()
    await canvas.scrollIntoViewIfNeeded()
    let area=await canvas.boundingBox()
    if(!area)throw Error('missing_canvas_bounds')
    const draw=async(startX:number,startY:number,endX:number,endY:number)=>{
      await page.mouse.move(startX,startY)
      await page.mouse.down()
      await page.mouse.move(endX,endY,{steps:18})
      await page.mouse.up()
    }
    const x=(n:number)=>area!.x+area!.width*n/320
    const y=(n:number)=>area!.y+area!.height*n/240
    const countInk=()=>canvas.evaluate((el:HTMLCanvasElement)=>{
      const data=el.getContext('2d')!.getImageData(0,0,el.width,el.height).data
      let total=0
      for(let i=3;i<data.length;i+=4)if(data[i]!>16)total++
      return total
    })
    // Interrupt a real pointer drag as an app switch/touch cancellation.
    // It must NOT leave an ink mark or commit an undo snapshot.
    await page.mouse.move(x(40),y(60))
    await page.mouse.down()
    await page.mouse.move(x(180),y(60),{steps:9})
    await expect.poll(countInk).toBeGreaterThan(30)
    await canvas.dispatchEvent('pointercancel',{pointerId:1,bubbles:true})
    await page.mouse.up()
    await expect.poll(countInk).toBe(0)
    await expect(page.getByTestId('file-viewer-photo-undo')).toBeDisabled()
    await draw(x(40),y(100),x(280),y(100))
    const painted=await countInk()
    expect(painted).toBeGreaterThan(100)
    await expect(page.getByTestId('file-viewer-photo-undo')).toBeEnabled()
    await page.getByTestId('file-viewer-photo-undo').click()
    await expect.poll(countInk).toBe(0)
    await page.getByTestId('file-viewer-photo-redo').click()
    await expect.poll(countInk).toBeGreaterThan(100)

    // Pencil is opaque colored ink; eraser must subtract ONLY the paint
    // layer, never punch holes in the signed original JPEG.
    await page.getByTestId('file-viewer-tool-eraser').click()
    await canvas.scrollIntoViewIfNeeded()
    area=await canvas.boundingBox()
    if(!area)throw Error('eraser_canvas_bounds')
    await draw(x(130),y(100),x(190),y(100))
    const erased=await countInk()
    expect(erased).toBeLessThan(painted)
    await page.getByTestId('file-viewer-photo-undo').click()
    await expect.poll(countInk).toBeGreaterThan(erased)
    await page.getByTestId('file-viewer-photo-redo').click()
    await expect.poll(countInk).toBeLessThan(painted)

    await page.getByTestId('file-viewer-tool-pencil').click()
    await page.getByTestId('file-viewer-paint-color').fill('#ff0000')
    await canvas.scrollIntoViewIfNeeded()
    area=await canvas.boundingBox()
    if(!area)throw Error('pencil_canvas_bounds')
    await draw(x(40),y(170),x(280),y(170))
    await expect(page.getByTestId('file-viewer-photo-redo')).toBeDisabled()
    expect(await page.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).length
    })).toBe(1)
    let automaticDownloads=0
    page.on('download',()=>{automaticDownloads++})

    await page.getByTestId('file-viewer-save-crop').click()
    await expect(page.getByTestId('file-viewer-crop-status'))
      .toContainText('зашифрована в очереди Browser',{timeout:30000})
    const derived=await page.evaluate(async sourceId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const rows=await m.listLocalMedia()
      const source=rows.find(row=>row.mediaId===sourceId)
      const next=rows.find(row=>row.mediaId!==sourceId)
      if(!source||!next)throw Error('missing_source_or_derivative')
      const decoded=await m.readLocalMedia(next.mediaId)
      const image=await createImageBitmap(decoded.blob)
      const output=document.createElement('canvas')
      output.width=image.width;output.height=image.height
      const ctx=output.getContext('2d')!
      ctx.drawImage(image,0,0)
      const data=ctx.getImageData(0,0,output.width,output.height).data
      const colors={green:0,red:0,white:0}
      for(let i=0;i<data.length;i+=4){
        const rr=data[i]!,gg=data[i+1]!,bb=data[i+2]!
        if(gg>rr+50&&gg>bb+50)colors.green++
        if(rr>gg+50&&rr>bb+50)colors.red++
        if(rr>240&&gg>240&&bb>240)colors.white++
      }
      const center=ctx.getImageData(160,100,1,1).data
      image.close()
      return {count:rows.length,sourceBytes:source.plainBytes,
        kind:next.mediaType,state:next.state,mime:decoded.metadata.mime,
        filename:decoded.metadata.fileName,
        category:decoded.metadata.category??null,
        tags:decoded.metadata.tags??[],gps:decoded.metadata.gps??null,
        capture:next.capture??null,colors,center:[...center.slice(0,3)],
        leaked:JSON.stringify(next).includes('#00cc00')||
          JSON.stringify(next).includes('do-not-share'),
      }
    },original.id)
    expect(derived).toMatchObject({
      count:2,sourceBytes:original.size,kind:'photo',state:'queued',
      mime:'image/jpeg',category:null,tags:[],gps:null,capture:null,
      leaked:false,
    })
    expect(derived.filename).toBe('PRIVATE-SOURCE-BRUSH-crop-0-0-100-100-r0-draw.jpg')
    expect(derived.colors.green).toBeGreaterThan(30)
    expect(derived.colors.red).toBeGreaterThan(20)
    expect(derived.colors.white).toBeGreaterThan(5000)
    expect(derived.center[0]).toBeGreaterThan(220)
    expect(derived.center[1]).toBeGreaterThan(220)
    expect(derived.center[2]).toBeGreaterThan(220)
    expect(automaticDownloads).toBe(0)

    page.once('dialog',dialog=>dialog.accept())
    const fileDownload=page.waitForEvent('download')
    await page.getByTestId('file-viewer-download-crop').click()
    expect((await fileDownload).suggestedFilename()).toBe(derived.filename)
    const previewUrl=await page.getByTestId('file-viewer-crop-preview')
      .getAttribute('src')
    await page.evaluate(async()=>{
      const {logout}=await import('/src/features/identity/application/session.ts')
      await logout()
    })
    await expect(page.getByTestId('file-viewer-photo-paint-canvas')).toHaveCount(0)
    expect(await page.evaluate(async url=>{
      try{return (await fetch(url!)).ok}catch{return false}
    },previewUrl)).toBe(false)
  }finally{await context.close()}
})
