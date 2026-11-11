import {expect,test} from '@playwright/test'

test('P2 Viewer: real decoded audio → WAV segment → offline E2EE Browser with separate OS export',async({browser})=>{
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

    const source=await page.evaluate(async()=>{
      // Real playable WAV, not fake media; browser AudioContext decodes it.
      const rate=8000,frames=rate*2
      const bytes=new Uint8Array(44+frames*2)
      const view=new DataView(bytes.buffer)
      const ascii=(pos:number,value:string)=>{for(let i=0;i<value.length;i++)
        view.setUint8(pos+i,value.charCodeAt(i))}
      ascii(0,'RIFF');view.setUint32(4,bytes.length-8,true)
      ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true)
      view.setUint16(20,1,true);view.setUint16(22,1,true)
      view.setUint32(24,rate,true);view.setUint32(28,rate*2,true)
      view.setUint16(32,2,true);view.setUint16(34,16,true)
      ascii(36,'data');view.setUint32(40,frames*2,true)
      for(let i=0;i<frames;i++)view.setInt16(44+i*2,
        Math.round(Math.sin(i/rate*Math.PI*440*2)*14000),true)
      const m=await import('/src/features/media/application/media-outbox.ts')
      const id=await m.enqueueEncryptedMedia(
        new File([bytes],'PRIVATE-SOURCE-AUDIO.wav',{type:'audio/wav'}),
        undefined,{category:'Оригинал',tags:['source']})
      return {id,bytes:bytes.length}
    })
    // Warm-offline editor: navigate using an online loaded shell, then
    // disconnect before the explicit local trim and encrypted save.
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+source.id)
    const audio=page.getByTestId('file-viewer-audio')
    await expect(audio).toBeVisible()
    await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.duration),
      {timeout:30000}).toBeGreaterThan(1.9)
    await expect(page.getByTestId('file-viewer-audio-editor')).toBeVisible()
    await context.setOffline(true)

    // Real native keyboard input, rather than mutating a range element's
    // DOM value without exercising Vue's v-model update.
    const start=page.getByTestId('file-viewer-audio-start')
    const end=page.getByTestId('file-viewer-audio-end')
    await start.focus()
    await start.press('ArrowRight')
    await start.press('ArrowRight')
    await end.focus()
    for(let i=0;i<13;i++)await end.press('ArrowLeft')
    await expect(page.getByTestId('file-viewer-audio-editor'))
      .toContainText('Начало · 0.2 с')
    await expect(page.getByTestId('file-viewer-audio-editor'))
      .toContainText('Конец · 0.7 с')
    // A same-device online-status session replacement must not wipe
    // user-edited range bounds (previously an actual Local-First regression).
    await page.evaluate(async()=>{
      const m=await import('/src/features/identity/application/session.ts')
      const previous=m.activeSession.value
      if(!previous)throw Error('missing_identity')
      m.activeSession.value={...previous,online:false}
    })
    await expect(page.getByTestId('file-viewer-audio-editor'))
      .toContainText('Начало · 0.2 с')
    await expect(page.getByTestId('file-viewer-audio-editor'))
      .toContainText('Конец · 0.7 с')
    let downloadCount=0
    page.on('download',()=>{downloadCount++})
    await page.getByTestId('file-viewer-make-wav').click()
    await expect(page.getByTestId('file-viewer-wav-preview'))
      .toBeVisible({timeout:30000})
    await expect(page.getByTestId('file-viewer-wav-status'))
      .toContainText('не сохранён')
    expect(downloadCount).toBe(0)
    expect(await page.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).length
    })).toBe(1)

    await page.getByTestId('file-viewer-save-wav').click()
    await expect(page.getByTestId('file-viewer-wav-status'))
      .toContainText('зашифрован в локальной очереди',{timeout:30000})
    const saved=await page.evaluate(async originalId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const rows=await m.listLocalMedia()
      const original=rows.find(x=>x.mediaId===originalId)
      const derivative=rows.find(x=>x.mediaId!==originalId)
      if(!original||!derivative)throw Error('missing_original_or_derivative')
      const file=await m.readLocalMedia(derivative.mediaId)
      const bytes=new Uint8Array(await file.blob.arrayBuffer())
      const header=new DataView(bytes.buffer)
      const ascii=(start:number,length:number)=>
        String.fromCharCode(...bytes.slice(start,start+length))
      return {
        count:rows.length,originalBytes:original.plainBytes,
        originalState:original.state,kind:derivative.mediaType,
        state:derivative.state,capture:derivative.capture??null,
        mime:file.metadata.mime,name:file.metadata.fileName,
        category:file.metadata.category??null,gps:file.metadata.gps??null,
        tags:file.metadata.tags??[],leaked:JSON.stringify(derivative)
          .includes('PRIVATE-SOURCE-AUDIO'),
        riff:ascii(0,4),wave:ascii(8,4),fmt:ascii(12,4),
        channels:header.getUint16(22,true),rate:header.getUint32(24,true),
        dataBytes:header.getUint32(40,true),actualBytes:bytes.length,
        derivedId:derivative.mediaId,
      }
    },source.id)
    expect(saved).toMatchObject({
      count:2,originalBytes:source.bytes,kind:'audio',state:'queued',
      capture:null,mime:'audio/wav',category:null,gps:null,tags:[],
      leaked:false,riff:'RIFF',wave:'WAVE',fmt:'fmt ',channels:1,
    })
    expect(saved.name).toBe('PRIVATE-SOURCE-AUDIO-clip-200-700ms.wav')
    expect(saved.actualBytes).toBe(saved.dataBytes+44)
    expect(saved.dataBytes/saved.rate/2).toBeGreaterThan(0.49)
    expect(saved.dataBytes/saved.rate/2).toBeLessThan(0.51)
    expect(downloadCount).toBe(0)

    page.once('dialog',d=>d.accept())
    const download=page.waitForEvent('download')
    await page.getByTestId('file-viewer-download-wav').click()
    expect((await download).suggestedFilename()).toBe(saved.name)
    const url=await page.getByTestId('file-viewer-wav-preview')
      .getAttribute('src')
    await page.evaluate(async()=>{
      const {logout}=await import('/src/features/identity/application/session.ts')
      await logout()
    })
    await expect(page.getByTestId('file-viewer-wav-preview')).toHaveCount(0)
    expect(await page.evaluate(async source=>{
      try{const res=await fetch(source!);return res.ok}catch{return false}
    },url)).toBe(false)
  }finally{await context.close()}
})
