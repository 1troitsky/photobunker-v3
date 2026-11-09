import {test,expect} from '@playwright/test'

test('P1-10: offline E2EE video/audio import → 1 MiB Garage chunks → independent recovered owner decrypt',async({browser})=>{
  test.setTimeout(140000)
  const primary=await browser.newContext()
  const restored=await browser.newContext()
  const outsider=await browser.newContext()
  const A=await primary.newPage()
  const B=await restored.newPage()
  const C=await outsider.newPage()
  try{
    await A.goto('/settings')
    await A.getByRole('button',{name:'Создать ключ'}).click()
    const recovery=await A.locator('#generated-key').inputValue()
    await A.getByLabel('Я сохранил ключ восстановления').check()
    await A.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(A.getByText('Подтверждённая сессия')).toBeVisible()
    await A.goto('/browser')
    const panel=A.locator('.media-import-p1')
    await expect(panel).toBeVisible()

    // Real Local-First: the application is loaded, then network disappears
    // BEFORE any media data is read, encrypted or added to IndexedDB.
    await primary.setOffline(true)
    const length=1024*1024+317
    await panel.getByTestId('media-import-file').setInputFiles({
      name:'SECRET-CLOUD-ONLY-VIDEO.webm',mimeType:'video/webm',
      buffer:Buffer.alloc(length,0x43),
    })
    await expect(panel.getByText(/Файл зашифрован и сохранён/)).toBeVisible()
    await expect(panel.locator('.photo-row').first()).toContainText('queued')
    const local=await A.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const [r]=await m.listLocalMedia()
      if(!r)throw Error('media.missing_local')
      const plaintext=await m.readLocalMedia(r.mediaId)
      return {
        mediaId:r.mediaId,chunkCount:r.chunks.length,
        size:plaintext.blob.size,name:plaintext.metadata.fileName,
        byte0:new Uint8Array(await plaintext.blob.slice(0,1).arrayBuffer())[0],
        signedHasName:JSON.stringify(r.contract).includes('SECRET-CLOUD-ONLY'),
        rowHasName:JSON.stringify(r).includes('SECRET-CLOUD-ONLY'),
      }
    })
    expect(local).toMatchObject({
      chunkCount:3,size:length,name:'SECRET-CLOUD-ONLY-VIDEO.webm',
      byte0:0x43,signedHasName:false,rowHasName:false,
    })

    await primary.setOffline(false)
    await panel.getByRole('button',{name:'Синхронизировать файлы'}).click()
    await expect(panel.locator('.photo-row').filter({hasText:local.mediaId.slice(0,8)}).first())
      .toContainText('synced',{timeout:30000})
    const server=await A.evaluate(async mediaId=>{
      const response=await fetch('/media/v1/'+mediaId+'/manifests',{
        credentials:'same-origin',cache:'no-store',
      })
      const json=await response.json()
      const list=await fetch('/media/v1',{credentials:'same-origin'})
      return {
        status:response.status,
        manifestContainsName:JSON.stringify(json).includes('SECRET-CLOUD-ONLY'),
        count:(await list.json()).items.length,
      }
    },local.mediaId)
    expect(server).toEqual({status:200,manifestContainsName:false,count:1})

    // Independently registered device from same Recovery Key holds NO old
    // IndexedDB rows. It must fetch ciphertext and decrypt client-side.
    await B.goto('/settings')
    await B.locator('#recovery-key').fill(recovery)
    await B.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(B.getByText('Подтверждённая сессия')).toBeVisible()
    await B.goto('/browser')
    const remote=B.locator('.media-import-p1')
    await expect(remote.locator('.photo-row')
      .filter({hasText:local.mediaId.slice(0,8)})).toBeVisible({timeout:20000})
    await remote.getByRole('button',{name:'Проверить из облака'}).click()
    await expect(remote.getByTestId('media-decrypted-preview'))
      .toContainText('SECRET-CLOUD-ONLY-VIDEO.webm')
    const recovered=await B.evaluate(async mediaId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const result=await m.readCloudMedia(mediaId)
      const bytes=new Uint8Array(await result.blob.arrayBuffer())
      return {
        length:bytes.length,mime:result.blob.type,
        first:bytes[0],middle:bytes[1048576],last:bytes[bytes.length-1],
        localRows:(await m.listLocalMedia()).length,
      }
    },local.mediaId)
    expect(recovered).toEqual({
      length,mime:'video/webm',first:0x43,middle:0x43,last:0x43,localRows:0,
    })

    // An unrelated identity must not receive even a wrapped DEK/manifest.
    await C.goto('/settings')
    await C.getByRole('button',{name:'Создать ключ'}).click()
    await C.getByLabel('Я сохранил ключ восстановления').check()
    await C.getByRole('button',{name:'Завершить регистрацию'}).click()
    const denied=await C.evaluate(async mediaId=>{
      const [manifest,list]=await Promise.all([
        fetch('/media/v1/'+mediaId+'/manifests',{credentials:'same-origin'}),
        fetch('/media/v1',{credentials:'same-origin'}),
      ])
      return {code:manifest.status,visible:(await list.json()).items.length}
    },local.mediaId)
    expect(denied).toEqual({code:404,visible:0})

    // Audio uses the same real upload/decryption route without requiring
    // camera permissions or auto-writing the OS gallery.
    await A.goto('/browser')
    const again=A.locator('.media-import-p1')
    await again.getByTestId('media-import-file').setInputFiles({
      name:'SENSITIVE-VOICE.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(4096,0x5a),
    })
    await again.getByRole('button',{name:'Синхронизировать файлы'}).click()
    await expect.poll(()=>A.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).filter(x=>x.state==='synced').length
    }),{timeout:30000}).toBe(2)
    await B.goto('/browser')
    const audio=await B.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const list=await m.listCloudMedia()
      const row=list.items.find(x=>x.mediaType==='audio')
      if(!row)throw Error('audio.remote_missing')
      const result=await m.readCloudMedia(row.mediaId)
      return {name:result.metadata.fileName,mime:result.blob.type,
        bytes:result.blob.size}
    })
    expect(audio).toEqual({
      name:'SENSITIVE-VOICE.wav',mime:'audio/wav',bytes:4096,
    })
  }finally{
    await primary.close();await restored.close();await outsider.close()
  }
})
