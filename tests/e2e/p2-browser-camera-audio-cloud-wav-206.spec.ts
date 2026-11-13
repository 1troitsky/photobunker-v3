import {expect,test,type Browser,type Page} from '@playwright/test'

// Disposable Recovery Keys must never enter Playwright failure traces,
// screenshot/video artifacts or recorded fill-steps on a CI failure.
test.use({trace:'off',screenshot:'off',video:'off'})

/**
 * #206: no fabricated MediaRecorder, E2EE ciphertext, Garage ACK or WAV.
 * Device A and recovered device B have distinct cookie + IndexedDB stores.
 * Real Chromium supplies a fake *hardware input* to native MediaRecorder.
 */
async function enroll(page:Page):Promise<{key:string;accountId:string;deviceId:string}>{
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  const key=await page.locator('#generated-key').inputValue()
  expect(key).toMatch(/^PB2\./)
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  const ids=await page.evaluate(async()=>{
    const auth=await import('/src/features/identity/application/session.ts')
    const local=auth.requireSession()
    const response=await fetch('/identity/v2/me',{
      credentials:'same-origin',cache:'no-store',
    })
    if(!response.ok)throw Error('capture.device_unverified')
    const proof=await response.json() as {
      accountId:string;deviceId:string;revision:number
    }
    if(proof.accountId!==local.accountId||proof.deviceId!==local.deviceId)
      throw Error('capture.device_identity_mismatch')
    return {accountId:local.accountId,deviceId:local.deviceId}
  })
  return {key,...ids}
}
test('P2 #206 real microphone → A encrypted Garage → recovered B cloud WAV trim → new encrypted Garage file',async({browser}:{
  browser:Browser
})=>{
  test.setTimeout(240_000)
  const ac=await browser.newContext({permissions:['camera','microphone']})
  const bc=await browser.newContext()
  const cc=await browser.newContext()
  const A=await ac.newPage(),B=await bc.newPage(),C=await cc.newPage()
  let recoveryKey:string|null=null
  try{
    const a=await enroll(A)
    recoveryKey=a.key

    // REAL browser microphone MediaRecorder, no uploaded/synthetic WAV.
    await A.goto('/camera')
    await expect(A.getByRole('button',{name:'Сделать снимок'}))
      .toBeEnabled({timeout:20_000})
    await A.getByTestId('camera-mode').selectOption('audio')
    await A.locator('#camera-category').fill('PRIVATE206-REPORT-AUDIO')
    await A.locator('#camera-description').fill('PRIVATE206-NO-DERIVATIVE-LEAK')
    await A.locator('#camera-tags').fill('PRIVATE206-AUDIO-TAG')
    await expect(A.getByTestId('camera-start-recording'))
      .toBeEnabled({timeout:20_000})
    await A.getByTestId('camera-start-recording').click()
    await expect(A.getByTestId('camera-recording-status'))
      .toBeVisible({timeout:15_000})
    await expect.poll(()=>A.evaluate(async()=>{
      const journal=await import('/src/features/media/application/recording-encrypted-journal.ts')
      const row=(await journal.listEncryptedRecordingDrafts())[0]
      return row?.state==='writing'&&row?.chunkCount>0&&row?.plainBytes>128
    }),{timeout:20_000}).toBe(true)
    await A.waitForTimeout(5_600)
    await A.getByTestId('camera-stop-recording').click()
    await expect(A.getByText(/Запись зашифрована и сохранена локально/))
      .toBeVisible({timeout:35_000})

    const source=await A.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const [row]=await m.listLocalMedia()
      if(!row||row.mediaType!=='audio'||row.plainBytes<128)
        throw Error('capture.audio_missing')
      const clear=await m.readLocalMedia(row.mediaId)
      return {
        id:row.mediaId,bytes:clear.blob.size,
        mime:clear.blob.type,name:clear.metadata.fileName,
        category:clear.metadata.category??null,
        description:clear.metadata.description??null,
        tags:clear.metadata.tags??[],
        digest:await (async()=>{
          const h=await crypto.subtle.digest('SHA-256',
            await clear.blob.arrayBuffer())
          return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')
        })(),
        capture:row.capture??null,
        scratch:(await (await import('/src/features/media/application/recording-encrypted-journal.ts'))
          .listEncryptedRecordingDrafts()).length,
      }
    })
    expect(source.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(source.mime).toMatch(/^audio\/(webm|mp4|ogg)$/)
    expect(source.name).toMatch(/^recording-.*\.(webm|mp4|ogg)$/)
    expect(source.capture).toBeNull()
    expect(source.category).toBe('PRIVATE206-REPORT-AUDIO')
    expect(source.description).toBe('PRIVATE206-NO-DERIVATIVE-LEAK')
    expect(source.tags).toEqual(['PRIVATE206-AUDIO-TAG'])
    expect(source.scratch).toBe(0)
    expect(source.digest).toMatch(/^[0-9a-f]{64}$/)

    // Actual durable ciphertext upload + signed server receipt, NOT fake ACK.
    await A.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      await m.synchronizeMedia()
    })
    await expect.poll(()=>A.evaluate(async id=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).find(x=>x.mediaId===id)?.state??'missing'
    },source.id),{timeout:35_000}).toBe('synced')

    // B is an independently recovered trusted device: NO copied storage.
    await B.goto('/settings')
    expect(await B.evaluate(async()=>{
      const storage=await import('/src/features/identity/infrastructure/storage.ts')
      return (await storage.listDevices()).length
    })).toBe(0)
    await B.locator('#recovery-key').fill(recoveryKey)
    await B.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(B.getByText('Подтверждённая сессия'))
      .toBeVisible({timeout:30_000})
    const b=await B.evaluate(async()=>{
      const auth=await import('/src/features/identity/application/session.ts')
      const session=auth.requireSession()
      const response=await fetch('/identity/v2/me',{credentials:'same-origin'})
      if(!response.ok)throw Error('recovered.device_no_server_proof')
      const verified=await response.json() as {accountId:string;deviceId:string}
      if(session.accountId!==verified.accountId||
        session.deviceId!==verified.deviceId)
        throw Error('recovered.device_mismatch')
      const m=await import('/src/features/media/application/media-outbox.ts')
      return {accountId:session.accountId,deviceId:session.deviceId,
        localCount:(await m.listLocalMedia()).length}
    })
    expect(b.accountId).toBe(a.accountId)
    expect(b.deviceId).not.toBe(a.deviceId)
    expect(b.localCount).toBe(0)

    // Fresh device B verifies authenticated cloud index+receipt and
    // decrypts the ACTUAL encoded microphone bytes, not merely metadata.
    const cloud=await B.evaluate(async id=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const index=await m.listCloudMedia()
      if(!index.items.some(x=>x.mediaId===id&&x.mediaType==='audio'))
        throw Error('recovered.audio_cloud_index_missing')
      const file=await m.readCloudMedia(id)
      const hash=await crypto.subtle.digest('SHA-256',await file.blob.arrayBuffer())
      return {
        mime:file.blob.type,name:file.metadata.fileName,size:file.blob.size,
        category:file.metadata.category??null,
        description:file.metadata.description??null,
        tags:file.metadata.tags??[],
        digest:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join(''),
        localCount:(await m.listLocalMedia()).length,
      }
    },source.id)
    expect(cloud).toEqual({
      mime:source.mime,name:source.name,size:source.bytes,
      category:source.category,description:source.description,
      tags:source.tags,digest:source.digest,localCount:0,
    })

    // Drive the ACTUAL cloud-backed FileViewer and WebAudio decoder via UI,
    // not a synthetic PCM fixture or direct invocation of the WAV encoder.
    await B.goto('/browser/file/media/'+source.id)
    const audio=B.getByTestId('file-viewer-audio')
    await expect(audio).toBeVisible({timeout:30_000})
    await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.duration),
      {timeout:30_000}).toBeGreaterThan(5)
    await B.getByTestId('viewer-action-edit').click()
    const editor=B.getByTestId('file-viewer-audio-editor')
    await expect(editor).toBeVisible({timeout:25_000})
    const start=B.getByTestId('file-viewer-audio-start')
    const end=B.getByTestId('file-viewer-audio-end')
    await start.focus();await start.press('ArrowRight');await start.press('ArrowRight')
    await end.focus();await end.press('Home')
    for(let i=0;i<7;i++)await end.press('ArrowRight')
    await expect(editor).toContainText('Начало · 0.2 с')
    await expect(editor).toContainText('Конец · 0.7 с')

    let automaticDownloads=0
    B.on('download',()=>{automaticDownloads++})
    await B.getByTestId('file-viewer-make-wav').click()
    await expect(B.getByTestId('file-viewer-wav-preview'))
      .toBeVisible({timeout:30_000})
    await expect(B.getByTestId('file-viewer-wav-status')).toContainText('не сохранён')
    expect(await B.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).length
    })).toBe(0)

    // Only the explicit Save action creates a DIFFERENT AES-GCM MediaFile.
    await B.getByTestId('file-viewer-save-wav').click()
    await expect(B.getByTestId('file-viewer-wav-status'))
      .toContainText('зашифрован в локальной очереди',{timeout:30_000})
    const derivative=await B.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const rows=await m.listLocalMedia()
      if(rows.length!==1)throw Error('wav.derivative_outbox_missing')
      const row=rows[0]!
      const recovered=await m.readLocalMedia(row.mediaId)
      const bytes=new Uint8Array(await recovered.blob.arrayBuffer())
      const dv=new DataView(bytes.buffer)
      const s=(i:number,n:number)=>String.fromCharCode(...bytes.slice(i,i+n))
      const h=await crypto.subtle.digest('SHA-256',bytes)
      return {id:row.mediaId,kind:row.mediaType,plainBytes:row.plainBytes,
        mime:recovered.blob.type,name:recovered.metadata.fileName,
        capture:row.capture??null,category:recovered.metadata.category??null,
        description:recovered.metadata.description??null,
        gps:recovered.metadata.gps??null,tags:recovered.metadata.tags??[],
        serializedRow:JSON.stringify(row),state:row.state,
        ciphertextOnly:row.chunks.every(x=>x.blob.type==='application/octet-stream'),
        riff:s(0,4),wave:s(8,4),fmt:s(12,4),
        channels:dv.getUint16(22,true),rate:dv.getUint32(24,true),
        dataBytes:dv.getUint32(40,true),totalBytes:bytes.length,
        digest:[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join(''),
      }
    })
    expect(derivative.id).not.toBe(source.id)
    expect(derivative).toMatchObject({
      kind:'audio',mime:'audio/wav',capture:null,category:null,
      description:null,gps:null,tags:[],ciphertextOnly:true,
      riff:'RIFF',wave:'WAVE',fmt:'fmt ',
    })
    expect(derivative.name).toMatch(/-clip-200-700ms\.wav$/)
    expect(derivative.serializedRow).not.toContain('PRIVATE206-REPORT-AUDIO')
    expect(derivative.serializedRow).not.toContain('PRIVATE206-NO-DERIVATIVE-LEAK')
    expect(derivative.serializedRow).not.toContain('PRIVATE206-AUDIO-TAG')
    expect(derivative.totalBytes).toBe(derivative.dataBytes+44)
    expect(derivative.dataBytes/derivative.rate/derivative.channels/2)
      .toBeGreaterThan(0.49)
    expect(derivative.dataBytes/derivative.rate/derivative.channels/2)
      .toBeLessThan(0.51)
    expect(automaticDownloads).toBe(0)

    await B.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      await m.synchronizeMedia()
    })
    await expect.poll(()=>B.evaluate(async id=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).find(x=>x.mediaId===id)?.state??'missing'
    },derivative.id),{timeout:35_000}).toBe('synced')
    // A receives the independent E2EE derivative back from REAL cloud.
    const back=await A.evaluate(async id=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const file=await m.readCloudMedia(id)
      const head=new Uint8Array(await file.blob.slice(0,12).arrayBuffer())
      const digest=await crypto.subtle.digest('SHA-256',
        await file.blob.arrayBuffer())
      return {size:file.blob.size,mime:file.blob.type,
        head:String.fromCharCode(...head.slice(0,4)),
        digest:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}
    },derivative.id)
    expect(back).toEqual({
      size:derivative.totalBytes,mime:'audio/wav',
      head:'RIFF',digest:derivative.digest,
    })
    const originalAfter=await A.evaluate(async id=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const file=await m.readCloudMedia(id)
      const h=await crypto.subtle.digest('SHA-256',await file.blob.arrayBuffer())
      return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')
    },source.id)
    expect(originalAfter).toBe(source.digest)

    // Third-party account C sees neither owner-only signed cloud asset.
    const foreign=await enroll(C)
    expect(foreign.accountId).not.toBe(a.accountId)
    const denial=await C.evaluate(async ids=>{
      const responses=await Promise.all(ids.map(id=>fetch(
        '/media/v1/'+id+'/manifests',{
          credentials:'same-origin',headers:{Accept:'application/json'},
          cache:'no-store',
        })))
      const index=await fetch('/media/v1',{credentials:'same-origin'})
      return {statuses:responses.map(r=>r.status),
        visible:(await index.json() as {items:unknown[]}).items.length}
    },[source.id,derivative.id])
    expect(denial).toEqual({statuses:[404,404],visible:0})
    expect(automaticDownloads).toBe(0)
    expect(JSON.stringify(await B.evaluate(()=>localStorage))).not.toContain(recoveryKey)
    await test.info().attach('p2-206-real-mic-cloud-wav-evidence.json',{
      body:JSON.stringify({twoDevices:true,physicalDevices:false,
        sourceId:source.id,sourceMime:source.mime,sourceBytes:source.bytes,
        nativeCapture:true,signedCloud:true,identicalSourceSha256:true,
        derivativeId:derivative.id,derivativeBytes:derivative.totalBytes,
        separateE2eeWav:true,foreignNoManifest:true,
        noAutoOsDownload:true}),
      contentType:'application/json',
    })
  }finally{
    // Recovery Key stays in transient Playwright test memory only.
    recoveryKey=null
    await ac.close();await bc.close();await cc.close()
  }
})
