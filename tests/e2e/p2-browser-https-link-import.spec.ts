import {test,expect} from '@playwright/test'

test('P2 Browser: explicit CORS HTTPS fetch -> local AES-GCM -> chosen folder -> Garage -> recovered device, no source URL in API',async({browser})=>{
  test.setTimeout(180000)
  const aContext=await browser.newContext(),bContext=await browser.newContext()
  const a=await aContext.newPage(),b=await bContext.newPage()
  const token='URL-SECRET-NOT-PERSISTED'
  const source='https://assets.example.org/evidence/cors-audio.wav?token='+token
  const bytes=Buffer.alloc(8192,0x5b)
  const apiRequests:string[]=[]
  let externalHeaders:Record<string,string>|null=null
  let sourceHits=0
  try{
    await a.goto('/settings')
    await a.getByRole('button',{name:'Создать ключ'}).click()
    const recoveryKey=await a.locator('#generated-key').inputValue()
    await a.getByLabel('Я сохранил ключ восстановления').check()
    await a.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(a.getByText('Подтверждённая сессия')).toBeVisible()
    await a.goto('/browser')
    await expect(a.getByTestId('browser-v3')).toBeVisible()
    await a.getByRole('button',{name:'Новая папка'}).click()
    await a.getByTestId('browser-folder-name').fill('HTTPS Evidence')
    await a.getByRole('button',{name:'Создать',exact:true}).click()
    await a.locator('#media-import-category').fill('Private HTTPS')
    await a.locator('#media-import-description').fill('Client-side-only CORS source')
    await a.getByTestId('media-import-destination')
      .selectOption({label:'HTTPS Evidence'})

    a.on('request',request=>{
      if(/\/(?:media|photos)\/v1/.test(request.url()))
        apiRequests.push(request.url()+(request.postData()??''))
    })
    await a.route('https://assets.example.org/**',async route=>{
      sourceHits++
      externalHeaders=route.request().headers()
      await route.fulfill({status:200,contentType:'audio/wav',
        headers:{'access-control-allow-origin':'*',
          'content-length':String(bytes.length)},
        body:bytes})
    })
    await a.getByTestId('media-import-https-url').fill(source)
    // No fetch on typing or rerender; explicit click is required.
    expect(sourceHits).toBe(0)
    await a.getByTestId('media-import-https-submit').click()
    const panel=a.locator('.media-import-p1')
    await expect(panel.getByText(/Файл зашифрован и сохранён на устройстве/))
      .toBeVisible({timeout:30000})
    expect(sourceHits).toBe(1)
    expect(externalHeaders).toBeTruthy()
    expect(externalHeaders).not.toHaveProperty('authorization')
    expect(externalHeaders).not.toHaveProperty('cookie')
    expect(externalHeaders).not.toHaveProperty('referer')
    const local=await a.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const folders=await import('/src/features/browser/application/folder-workspace.ts')
      const rows=await media.listLocalMedia()
      if(rows.length!==1)throw Error('expected exactly one encrypted local MediaFile')
      const row=rows[0]!
      const workspace=await folders.loadFolderWorkspace()
      return {
        mediaId:row.mediaId,state:row.state,bytes:row.plainBytes,
        folder:workspace.placements['media:'+row.mediaId]??null,
        folderId:Object.values(workspace.folders).find(x=>x.name==='HTTPS Evidence')?.id,
        metadata:await media.readLocalMediaMetadata(row.mediaId),
        ciphertextOnly:row.chunks.every(x=>x.blob.type==='application/octet-stream'),
        serialized:JSON.stringify({
          contract:row.contract,capture:row.capture,signature:row.signature,
        }),
      }
    })
    expect(local.bytes).toBe(bytes.length)
    expect(local.state).toBe('queued')
    expect(local.folder).toBe(local.folderId)
    expect(local.ciphertextOnly).toBe(true)
    expect(local.metadata).toMatchObject({
      fileName:'cors-audio.wav',category:'Private HTTPS',
      description:'Client-side-only CORS source',mime:'audio/wav',
    })
    expect(local.serialized).not.toContain(token)
    expect(local.serialized).not.toContain('assets.example.org')
    expect(apiRequests.join('\n')).not.toContain(token)
    expect(apiRequests.join('\n')).not.toContain('assets.example.org')
    await panel.getByRole('button',{name:'Отправить медиа'}).click()
    await expect.poll(()=>a.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia())[0]?.state
    }),{timeout:35000}).toBe('synced')
    expect(apiRequests.join('\n')).not.toContain(token)

    await b.goto('/settings')
    await b.locator('#recovery-key').fill(recoveryKey)
    await b.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(b.getByText('Подтверждённая сессия')).toBeVisible()
    const received=await b.evaluate(async(id:string)=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const found=await media.readCloudMedia(id)
      const b=new Uint8Array(await found.blob.arrayBuffer())
      return {
        fileName:found.metadata.fileName,category:found.metadata.category,
        bytes:b.length,first:b[0],last:b.at(-1),
      }
    },local.mediaId)
    expect(received).toEqual({
      fileName:'cors-audio.wav',category:'Private HTTPS',
      bytes:8192,first:0x5b,last:0x5b,
    })
  }finally{
    await aContext.close();await bContext.close()
  }
})

test('P2 Browser: rejects private/HTTP address locally and never contacts the source',async({browser})=>{
  const context=await browser.newContext(),page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await page.goto('/browser')
    await expect(page.getByTestId('browser-v3')).toBeVisible()
    const seen:string[]=[]
    page.on('request',request=>{
      if(request.url().includes('127.0.0.1')||request.url().includes('host.local'))
        seen.push(request.url())
    })
    await page.getByTestId('media-import-https-url')
      .fill('https://127.0.0.1/private.wav')
    await page.getByTestId('media-import-https-submit').click()
    await expect(page.locator('.media-import-p1').getByRole('alert'))
      .toContainText('media.link_private_host',{timeout:15000})
    expect(seen).toEqual([])
    const local=await page.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return m.listLocalMedia()
    })
    expect(local).toHaveLength(0)
  }finally{await context.close()}
})
