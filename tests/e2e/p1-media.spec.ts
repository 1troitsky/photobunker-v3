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
    await panel.getByRole('button',{name:'Отправить медиа'}).click()
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
    await expect(C.getByText('Подтверждённая сессия')).toBeVisible()
    // Browser's package display can precede asynchronous cookie/session
    // confirmation. Verify the real enrolled account before asserting 404.
    await C.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
    })
    const denied=await C.evaluate(async mediaId=>{
      const [manifest,list]=await Promise.all([
        fetch('/media/v1/'+mediaId+'/manifests',{
          credentials:'same-origin',headers:{Accept:'application/json'},
        }),
        fetch('/media/v1',{
          credentials:'same-origin',headers:{Accept:'application/json'},
        }),
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
    await again.getByRole('button',{name:'Отправить медиа'}).click()
    await expect.poll(()=>A.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).filter(x=>x.state==='synced').length
    }),{timeout:30000}).toBe(2)
    await B.goto('/browser')
    await expect.poll(()=>B.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      return identity.activeSession.value?.online===true
    }),{timeout:20000}).toBe(true)
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

test('P1-11: two independently verified accounts exchange 1-key E2EE audio grant, recipient decrypts and owner revokes without deleting original',async({browser})=>{
  test.setTimeout(150000)
  const ownerContext=await browser.newContext()
  const recipientContext=await browser.newContext()
  const owner=await ownerContext.newPage()
  const recipient=await recipientContext.newPage()
  try{
    await owner.goto('/settings')
    await owner.getByRole('button',{name:'Создать ключ'}).click()
    await owner.getByLabel('Я сохранил ключ восстановления').check()
    await owner.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(owner.getByText('Подтверждённая сессия')).toBeVisible()
    const ownerId=await owner.evaluate(async()=>{
      const s=await import('/src/features/identity/application/session.ts')
      return s.requireSession().accountId
    })
    await owner.goto('/browser')
    const ownerPanel=owner.locator('.media-import-p1')
    await ownerPanel.getByTestId('media-import-file').setInputFiles({
      name:'SENSITIVE-RECIPIENT-AUDIO.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(16427,0x5e),
    })
    await ownerPanel.getByRole('button',{name:'Отправить медиа'}).click()
    await expect.poll(()=>owner.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia())[0]?.state
    }),{timeout:30000}).toBe('synced')
    const mediaId=await owner.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia())[0]!.mediaId
    })

    await recipient.goto('/settings')
    await recipient.getByRole('button',{name:'Создать ключ'}).click()
    await recipient.getByLabel('Я сохранил ключ восстановления').check()
    await recipient.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(recipient.getByText('Подтверждённая сессия')).toBeVisible()
    const recipientId=await recipient.evaluate(async()=>{
      const s=await import('/src/features/identity/application/session.ts')
      return s.requireSession().accountId
    })
    await recipient.goto('/browser')
    await expect(recipient.getByTestId('media-share-panel')).toBeVisible()
    // Registration UI and online session proof complete independently.
    // Verify the server account before publishing an account-signed ECDH key.
    await recipient.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
    })
    // Recipient publishes account-signed ECDH directory. No implicit TOFU.
    await recipient.evaluate(async()=>{
      const keys=await import('/src/features/sharing/key-directory.ts')
      await keys.ensureOwnExchangeKey()
    })

    const share=owner.getByTestId('media-share-panel')
    await share.locator('#media-share-peer-id').fill(recipientId)
    await share.getByRole('button',{name:'Проверить получателя медиа'}).click()
    await expect(share.getByTestId('media-recipient-fingerprint')).not.toBeEmpty()
    await expect(share.getByText('Ключ получателя подтверждён')).toHaveCount(0)
    await share.getByLabel('Я сверил отпечаток получателя медиа').check()
    await share.getByRole('button',{name:'Подтвердить получателя медиа'}).click()
    await expect(share.getByText('Ключ получателя подтверждён')).toBeVisible()
    await share.getByRole('button',{name:'Передать медиа'}).click()
    await expect(share.getByText(/Разрешение сохранено/)).toBeVisible()
    const grantId=await owner.evaluate(async()=>{
      const grants=await import('/src/features/media/application/media-grants.ts')
      const [row]=await grants.listOutgoingMediaGrants()
      if(!row||row.state!=='sent')throw Error('grant.not_confirmed')
      return row.id
    })
    const rawGrant=await owner.evaluate(async id=>{
      const x=await fetch('/media-shares/v1/grants/'+id,{
        credentials:'same-origin',
      })
      return x.status
    },grantId)
    expect(rawGrant).toBe(404) // even owner is not recipient

    const received=recipient.getByTestId('media-share-panel')
    await received.getByRole('button',{name:'Обновить медиа-разрешения'}).click()
    await expect(received.getByText(mediaId.slice(0,8))).toBeVisible()
    await received.getByRole('button',{name:'Проверить отправителя медиа'}).click()
    await expect(received.getByTestId('media-owner-fingerprint')).not.toBeEmpty()
    await received.getByLabel('Я сверил отпечаток отправителя медиа').check()
    await received.getByRole('button',{name:'Подтвердить отправителя медиа'}).click()
    await received.getByRole('button',{name:'Открыть полученное медиа'}).click()
    await expect(recipient.getByTestId('media-decrypted-preview'))
      .toContainText('SENSITIVE-RECIPIENT-AUDIO.wav')
    const result=await recipient.evaluate(async id=>{
      const g=await import('/src/features/media/application/media-grants.ts')
      const data=await g.readReceivedMediaGrant(id)
      const bytes=new Uint8Array(await data.blob.arrayBuffer())
      return {
        name:data.metadata.fileName,size:bytes.length,
        head:bytes[0],last:bytes[bytes.length-1],mime:data.blob.type,
      }
    },grantId)
    expect(result).toEqual({
      name:'SENSITIVE-RECIPIENT-AUDIO.wav',
      size:16427,head:0x5e,last:0x5e,mime:'audio/wav',
    })
    const leaked=await recipient.evaluate(async id=>{
      const r=await fetch('/media-shares/v1/grants/'+id,{
        credentials:'same-origin',
      })
      const payload=JSON.stringify(await r.json())
      return {
        containsFilename:payload.includes('SENSITIVE-RECIPIENT-AUDIO'),
        containsMime:payload.includes('audio/wav'),
        hasRawSecret:payload.includes('akek'),
      }
    },grantId)
    expect(leaked).toEqual({
      containsFilename:false,containsMime:false,hasRawSecret:false,
    })

    await share.getByRole('button',{name:'Отозвать медиа'}).click()
    // Wait for the authenticated server ACK, not merely the UI click.
    await expect(share.getByText('Серверный доступ отозван'))
      .toBeVisible({timeout:15000})
    const blocked=await recipient.evaluate(async id=>{
      const [manifest,receivedList]=await Promise.all([
        fetch('/media-shares/v1/grants/'+id,{credentials:'same-origin'}),
        fetch('/media-shares/v1/received',{credentials:'same-origin'}),
      ])
      return {
        status:manifest.status,
        grants:(await receivedList.json()).items.length,
      }
    },grantId)
    expect(blocked).toEqual({status:410,grants:0})
    // Only server read ACL is revoked; local cleartext already viewed by
    // recipient cannot be remotely unsent. The owner's file is intact.
    const intact=await owner.evaluate(async id=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const data=await m.readCloudMedia(id)
      return {size:data.blob.size,type:data.blob.type}
    },mediaId)
    expect(intact).toEqual({size:16427,type:'audio/wav'})
    expect(ownerId).not.toBe(recipientId)
  }finally{
    await ownerContext.close()
    await recipientContext.close()
  }
})
