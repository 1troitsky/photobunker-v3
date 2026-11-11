import {expect,test} from '@playwright/test'

test('P2 Viewer: decoded video frame → volatile JPEG → offline E2EE Browser file and confirmed device download',async({browser})=>{
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
    await context.setOffline(true)

    // Build a REAL decodable WebM on-device, not a fake video byte fixture.
    // The pixels remain in the browser and the file is encrypted before IDB.
    const source=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas')
      canvas.width=160;canvas.height=90
      const ctx=canvas.getContext('2d')
      if(!ctx||!('captureStream' in canvas))throw Error('canvas_video_unsupported')
      const mime=['video/webm;codecs=vp8','video/webm'].find(
        type=>MediaRecorder.isTypeSupported(type))
      if(!mime)throw Error('video_recorder_unsupported')
      const stream=canvas.captureStream(15)
      const recorder=new MediaRecorder(stream,{mimeType:mime})
      const parts:Blob[]=[]
      recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)}
      let tick=0
      const paint=()=>{
        ctx.fillStyle=tick++%2?'#396aaf':'#d8bb61'
        ctx.fillRect(0,0,160,90)
        ctx.fillStyle='#111';ctx.fillRect(25,25,65,35)
      }
      paint()
      const interval=setInterval(paint,65)
      try{
        await new Promise<void>((resolve,reject)=>{
          recorder.onerror=()=>reject(Error('recorder_failed'))
          recorder.onstop=()=>resolve()
          recorder.start(100)
          setTimeout(()=>recorder.stop(),1150)
        })
      }finally{
        clearInterval(interval)
        stream.getTracks().forEach(track=>track.stop())
      }
      const file=new File(parts,'PRIVATE-SOURCE-VIDEO.webm',{type:'video/webm'})
      if(file.size<256)throw Error('video_encoder_empty')
      const media=await import('/src/features/media/application/media-outbox.ts')
      const id=await media.enqueueEncryptedMedia(file,undefined,{
        category:'Приватный оригинал',description:'Оригинал не меняется',
        tags:['source'],
      })
      return {id,bytes:file.size}
    })
    // Cold offline app boot is not supported yet. Navigate while online,
    // then take and encrypt the frame on an offline, already loaded page.
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+source.id)
    const video=page.getByTestId('file-viewer-video')
    await expect(video).toBeVisible()
    await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.readyState),
      {timeout:30000}).toBeGreaterThanOrEqual(2)
    await expect(page.getByTestId('file-viewer-info'))
      .toContainText('PRIVATE-SOURCE-VIDEO.webm')
    await context.setOffline(true)
    let unconfirmedDownloads=0
    page.on('download',()=>{unconfirmedDownloads++})
    await page.getByTestId('file-viewer-create-still').click()
    await expect(page.getByTestId('file-viewer-still-image')).toBeVisible()
    await expect(page.getByTestId('file-viewer-still-status'))
      .toContainText('не сохранён на устройство')
    expect(unconfirmedDownloads).toBe(0)
    let before=await page.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).length
    })
    expect(before).toBe(1) // the preview must not silently queue an upload

    await page.getByTestId('file-viewer-save-still').click()
    await expect(page.getByTestId('file-viewer-still-status'))
      .toContainText('зашифрован и сохранён',{timeout:30000})
    const saved=await page.evaluate(async originalId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const rows=await m.listLocalMedia()
      const original=rows.find(x=>x.mediaId===originalId)
      const derived=rows.find(x=>x.mediaId!==originalId)
      if(!derived||!original)throw Error('missing_derived_file')
      const result=await m.readLocalMedia(derived.mediaId)
      const metadata=result.metadata
      const bytes=new Uint8Array(await result.blob.arrayBuffer())
      return {
        count:rows.length,originalBytes:original.plainBytes,
        originalState:original.state,kind:derived.mediaType,
        generatedState:derived.state,capture:derived.capture??null,
        mime:metadata.mime,fileName:metadata.fileName,
        category:metadata.category??null,tags:metadata.tags??[],
        gps:metadata.gps??null,head:[...bytes.slice(0,3)],
        tail:[...bytes.slice(-2)],derivedId:derived.mediaId,
        leaked:JSON.stringify(derived).includes('PRIVATE-SOURCE-VIDEO'),
      }
    },source.id)
    expect(saved).toMatchObject({
      count:2,originalBytes:source.bytes,kind:'photo',
      generatedState:'queued',capture:null,mime:'image/jpeg',
      category:null,tags:[],gps:null,head:[255,216,255],tail:[255,217],
      leaked:false,
    })
    expect(saved.fileName).toMatch(/^PRIVATE-SOURCE-VIDEO-frame-\d+ms\.jpg$/)
    expect(unconfirmedDownloads).toBe(0)
    await expect(page.getByRole('link',{name:'Открыть сохранённый файл'}))
      .toHaveAttribute('href','/browser/file/media/'+saved.derivedId)

    // Explicit OS export is distinct from an encrypted Browser save.
    page.once('dialog',d=>d.accept())
    const exported=page.waitForEvent('download')
    await page.getByTestId('file-viewer-download-still').click()
    expect((await exported).suggestedFilename()).toBe(saved.fileName)

    const blobUrl=await page.getByTestId('file-viewer-still-image')
      .getAttribute('src')
    await page.evaluate(async()=>{
      const {logout}=await import('/src/features/identity/application/session.ts')
      await logout()
    })
    await expect(page.getByTestId('file-viewer-still-image')).toHaveCount(0)
    await expect(page.getByTestId('file-viewer-video')).toHaveCount(0)
    expect(await page.evaluate(async url=>{
      try{const res=await fetch(url!);return res.ok}catch{return false}
    },blobUrl)).toBe(false)
  }finally{await context.close()}
})
