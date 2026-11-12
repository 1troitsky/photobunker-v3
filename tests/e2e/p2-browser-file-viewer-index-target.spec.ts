import {test,expect} from '@playwright/test'

test('P2 File Viewer: authenticated deep-link target on opaque index page 2, reject replay and preserve ciphertext',async({browser})=>{
  test.setTimeout(185000)
  const owner=await browser.newContext(),recovered=await browser.newContext()
  const A=await owner.newPage(),B=await recovered.newPage()
  const fakeId=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
  const fake=(n:number)=>({
    mediaId:fakeId(n),mediaType:'audio',plainBytes:8192,
    expiresAt:Date.now()+3600000,
  })
  try{
    await A.goto('/settings')
    await A.getByRole('button',{name:'Создать ключ'}).click()
    const recoveryKey=await A.locator('#generated-key').inputValue()
    await A.getByLabel('Я сохранил ключ восстановления').check()
    await A.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(A.getByText('Подтверждённая сессия')).toBeVisible()
    await A.goto('/browser')
    await A.getByTestId('media-import-file').setInputFiles({
      name:'VIEWER-PAGE-2-E2EE.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(8192,0x5c),
    })
    await expect(A.locator('.media-import-p1')
      .getByText('Файл зашифрован и сохранён на устройстве.'))
      .toBeVisible({timeout:30000})
    await A.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      await m.synchronizeMedia()
    })
    const mediaId=await A.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const rows=await m.listLocalMedia()
      if(rows.length!==1||rows[0]!.state!=='synced')
        throw Error('server_ACK_required')
      return rows[0]!.mediaId
    })
    // These opaque IDs are synthetic INDEX rows only; the actual MediaFile
    // is fully server-authorized, receipt-verified and AES-GCM-decrypted.
    // Malicious listing cannot create an authentic manifest or DEK.
    expect(mediaId>fakeId(50)).toBe(true)
    await B.goto('/settings')
    await B.locator('#recovery-key').fill(recoveryKey)
    await B.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(B.getByText('Подтверждённая сессия')).toBeVisible()
    let firstRequests=0,secondRequests=0
    const real=await B.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listCloudMedia()).items[0]
    })
    expect(real.mediaId).toBe(mediaId)
    await B.route(/\/media\/v1(?:\?after=[^#]*)?$/,async route=>{
      const url=new URL(route.request().url())
      const after=url.searchParams.get('after')
      if(!after){
        firstRequests++
        await route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({items:Array.from({length:50},(_,i)=>fake(i+1)),
            nextCursor:fakeId(50)})})
        return
      }
      expect(after).toBe(fakeId(50))
      secondRequests++
      await route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({items:[real],nextCursor:null})})
    })
    await B.goto('/browser/file/media/'+mediaId)
    await expect(B.getByTestId('file-viewer-audio'))
      .toBeVisible({timeout:35000})
    await expect(B.getByTestId('file-viewer-info'))
      .toContainText('VIEWER-PAGE-2-E2EE.wav',{timeout:35000})
    await expect(B.getByTestId('file-viewer-position'))
      .toHaveText('51 / 51',{timeout:35000})
    expect(firstRequests).toBeGreaterThan(0)
    expect(secondRequests).toBeGreaterThan(0)
    const clear=await B.evaluate(async(id:string)=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const file=await m.readCloudMedia(id)
      const bytes=new Uint8Array(await file.blob.arrayBuffer())
      return {len:bytes.length,first:bytes[0],last:bytes.at(-1),
        name:file.metadata.fileName}
    },mediaId)
    expect(clear).toEqual({
      len:8192,first:0x5c,last:0x5c,name:'VIEWER-PAGE-2-E2EE.wav',
    })

    // A different authorized index response can be malformed/stale. A
    // first page containing the true item must survive a hostile Load more.
    await B.unroute(/\/media\/v1(?:\?after=[^#]*)?$/)
    let badPageDelivered=0
    await B.route(/\/media\/v1(?:\?after=[^#]*)?$/,async route=>{
      const after=new URL(route.request().url()).searchParams.get('after')
      const initial=[...Array.from({length:49},(_,i)=>fake(i+1)),real]
      if(after){
        expect(after).toBe(mediaId)
        badPageDelivered++
        await route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({items:initial,nextCursor:mediaId})})
      }else{
        await route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({items:initial,nextCursor:mediaId})})
      }
    })
    await B.reload()
    await expect(B.getByTestId('file-viewer-position'))
      .toHaveText('50 / 50',{timeout:35000})
    await B.getByTestId('file-viewer-load-more').click()
    await expect(B.getByRole('status'))
      .toContainText('Ранее проверенные файлы и курсоры сохранены.',{timeout:30000})
    expect(badPageDelivered).toBeGreaterThan(0)
    await expect(B.getByTestId('file-viewer-position')).toHaveText('50 / 50')
    await expect(B.getByTestId('file-viewer-audio')).toBeVisible()
  }finally{
    await owner.close();await recovered.close()
  }
})
