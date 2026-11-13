import {expect,test,type Page} from '@playwright/test'

async function register(page:Page):Promise<void>{
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
}

async function countLocalMedia(page:Page):Promise<number>{
  return page.evaluate(async()=>{
    const media=await import('/src/features/media/application/media-outbox.ts')
    return (await media.listLocalMedia()).length
  })
}

test('P2 #206 genuine Chromium microphone denial requires explicit retry, without private UA error leakage',async({page})=>{
  test.setTimeout(110_000)
  await register(page)
  await page.addInitScript(()=>{
    const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    let denyOnce=true
    navigator.mediaDevices.getUserMedia=(constraints:MediaStreamConstraints)=>{
      if(constraints.audio===true&&constraints.video===false&&denyOnce){
        denyOnce=false
        return Promise.reject(new DOMException('PRIVATE-PLATFORM-MIC-DENIAL','NotAllowedError'))
      }
      return native(constraints)
    }
  })
  await page.goto('/camera')
  await expect(page.getByRole('button',{name:'Сделать снимок'}))
    .toBeEnabled({timeout:20_000})
  await page.getByTestId('camera-mode').selectOption('audio')
  await expect(page.getByRole('alert'))
    .toContainText('camera.microphone_permission_denied',{timeout:20_000})
  await expect(page.getByRole('alert')).not.toContainText('PRIVATE-PLATFORM-MIC-DENIAL')
  await expect(page.getByTestId('camera-start-recording')).toBeDisabled()
  expect(await countLocalMedia(page)).toBe(0)
  // A rejected getUserMedia must not cause any automatic retries.
  await page.getByRole('button',{name:'Включить микрофон'}).click()
  await expect(page.getByTestId('camera-start-recording')).toBeEnabled({timeout:20_000})
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await countLocalMedia(page)).toBe(0)
})

test('P2 #206 native MediaStreamTrack ended aborts an otherwise long enough real audio capture',async({page})=>{
  test.setTimeout(120_000)
  await register(page)
  await page.addInitScript(()=>{
    const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    ;(window as any).__p2MicStream=null as MediaStream|null
    navigator.mediaDevices.getUserMedia=async constraints=>{
      const result=await native(constraints)
      if(constraints.audio===true&&constraints.video===false)
        (window as any).__p2MicStream=result
      return result
    }
  })
  await page.goto('/camera')
  await expect(page.getByRole('button',{name:'Сделать снимок'}))
    .toBeEnabled({timeout:20_000})
  await page.getByTestId('camera-mode').selectOption('audio')
  await expect(page.getByTestId('camera-start-recording')).toBeEnabled({timeout:20_000})
  await page.getByTestId('camera-start-recording').click()
  await expect(page.getByTestId('camera-recording-status')).toBeVisible({timeout:15_000})
  // Real microphone and native MediaRecorder, no fake capture or virtual clock.
  // >5s ensures this interruption isn't merely the minimum-duration rejection.
  await page.waitForTimeout(5_200)
  // Real MediaRecorder has emitted timeslice segments: these must already
  // be durable encrypted scratch, never a signed MediaFile before Stop.
  const pending=await page.evaluate(async()=>{
    const journal=await import('/src/features/media/application/recording-encrypted-journal.ts')
    return (await journal.listEncryptedRecordingDrafts())[0]
  })
  expect(pending?.state).toBe('writing')
  expect(pending?.chunkCount).toBeGreaterThan(0)
  expect(pending?.plainBytes).toBeGreaterThan(128)
  expect(await countLocalMedia(page)).toBe(0)
  await page.evaluate(()=>{
    const stream=(window as any).__p2MicStream as MediaStream|null
    if(!stream||!stream.getAudioTracks().length)throw Error('fixture.real_audio_missing')
    const track=stream.getAudioTracks()[0]!
    if(track.readyState!=='live')throw Error('fixture.audio_not_live')
    // Synthetic dispatch exercises the actual browser track event listener;
    // this does NOT claim real OS permission revocation was tested.
    track.dispatchEvent(new Event('ended'))
  })
  await expect(page.getByText('camera.recording_interrupted')).toBeVisible({timeout:15_000})
  await expect(page.getByTestId('camera-recording-status')).toHaveCount(0)
  const state=await page.evaluate(async()=>{
    const stream=(window as any).__p2MicStream as MediaStream
    const media=await import('/src/features/media/application/media-outbox.ts')
    return {ended:stream.getTracks().every(track=>track.readyState==='ended'),
      rows:(await media.listLocalMedia()).length}
  })
  expect(state).toEqual({ended:true,rows:0})
  await page.waitForTimeout(300)
  expect(await countLocalMedia(page)).toBe(0)
  await expect.poll(()=>page.evaluate(async id=>{
    const journal=await import('/src/features/media/application/recording-encrypted-journal.ts')
    return (await journal.listEncryptedRecordingDrafts())
      .find(row=>row.recordingId===id)?.state
  },pending!.recordingId),{timeout:15_000}).toBe('interrupted')

  // The encrypted fragments survive an actual browser navigation/reload,
  // but interrupted content is NEVER automatically finalized or published.
  await page.reload()
  await expect.poll(()=>page.evaluate(async id=>{
    const identity=await import('/src/features/identity/application/session.ts')
    if(!identity.activeSession.value)return 'identity_bootstrapping'
    const journal=await import('/src/features/media/application/recording-encrypted-journal.ts')
    const row=(await journal.listEncryptedRecordingDrafts())
      .find(record=>record.recordingId===id)
    return row?.state??'missing'
  },pending!.recordingId),{timeout:30_000}).toBe('interrupted')
  const recovered=await page.evaluate(async id=>{
    const journal=await import('/src/features/media/application/recording-encrypted-journal.ts')
    const row=(await journal.listEncryptedRecordingDrafts()).find(r=>r.recordingId===id)
    let rejected=''
    try{await journal.readCompletedEncryptedRecording(id)}
    catch(e){rejected=e instanceof Error?e.message:'unknown'}
    return {parts:row?.chunkCount,bytes:row?.plainBytes,rejected}
  },pending!.recordingId)
  expect(recovered.parts).toBeGreaterThan(0)
  expect(recovered.bytes).toBeGreaterThan(128)
  expect(recovered.rejected).toBe('camera.recording_not_finalized')
  expect(await countLocalMedia(page)).toBe(0)

  // Preview is strictly opt-in after reload, remains a volatile same-tab
  // object URL and never converts interrupted scratch into a MediaFile.
  await expect(page.getByTestId('camera-encrypted-draft-recovery'))
    .toBeVisible({timeout:30_000})
  const card=page.getByTestId('camera-encrypted-draft-'+pending!.recordingId)
  await expect(card).toContainText('Прервана')
  await card.getByRole('button',{name:'Просмотреть локально'}).click()
  const review=page.getByTestId('camera-private-draft-preview')
  await expect(review).toBeVisible({timeout:20_000})
  const privateSrc=await review.locator('audio').getAttribute('src')
  expect(privateSrc).toMatch(/^blob:/)
  expect(await countLocalMedia(page)).toBe(0)
  await review.getByRole('button',{name:'Закрыть предпросмотр'}).click()
  await expect(review).toHaveCount(0)
  // The object URL has been revoked and should not be a durable/share URL.
  const alive=await page.evaluate(async src=>{
    try{return (await fetch(src!)).ok}catch{return false}
  },privateSrc)
  expect(alive).toBe(false)

  // Deleting scratch always needs an explicit browser confirmation.
  page.once('dialog',dialog=>dialog.accept())
  await card.getByRole('button',{name:'Удалить фрагменты'}).click()
  await expect.poll(()=>page.evaluate(async id=>{
    const journal=await import('/src/features/media/application/recording-encrypted-journal.ts')
    return (await journal.listEncryptedRecordingDrafts()).some(x=>x.recordingId===id)
  },pending!.recordingId),{timeout:15_000}).toBe(false)
  expect(await countLocalMedia(page)).toBe(0)
})

test('P2 #206 true native audio timeslices are ciphertext before Stop and GC after signed E2EE save',async({page})=>{
  test.setTimeout(130_000)
  await register(page)
  await page.goto('/camera')
  await expect(page.getByRole('button',{name:'Сделать снимок'}))
    .toBeEnabled({timeout:20_000})
  await page.getByTestId('camera-mode').selectOption('audio')
  await expect(page.getByTestId('camera-start-recording'))
    .toBeEnabled({timeout:20_000})
  await page.getByTestId('camera-start-recording').click()
  await expect(page.getByTestId('camera-recording-status')).toBeVisible()
  const encrypted=await expect.poll(()=>page.evaluate(async()=>{
    const journal=await import('/src/features/media/application/recording-encrypted-journal.ts')
    return (await journal.listEncryptedRecordingDrafts())[0]?.chunkCount??0
  }),{timeout:20_000}).toBeGreaterThan(1)
  void encrypted
  // Inspect raw IndexedDB directly: only AES-GCM ciphertext Blob parts,
  // and never a plaintext audio/* Blob in persistent storage.
  const persisted=await page.evaluate(async()=>{
    const database=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('pb3-encrypted-recording-journal-v1')
      request.onsuccess=()=>resolve(request.result)
      request.onerror=()=>reject(request.error)
    })
    try{
      return await new Promise<Array<{mime:string;size:number;plain:number}>>((resolve,reject)=>{
        const tx=database.transaction('segments','readonly')
        const request=tx.objectStore('segments').getAll()
        request.onsuccess=()=>resolve((request.result as Array<{
          ciphertext:Blob;plainBytes:number
        }>).map(r=>({
          mime:r.ciphertext.type,size:r.ciphertext.size,plain:r.plainBytes,
        })))
        request.onerror=()=>reject(request.error)
      })
    }finally{database.close()}
  })
  expect(persisted.length).toBeGreaterThan(1)
  for(const chunk of persisted){
    expect(chunk.mime).toBe('application/octet-stream')
    expect(chunk.size).toBe(chunk.plain+16)
  }
  // A true 5+ second microphone capture must still satisfy the native gate.
  await page.waitForTimeout(5_200)
  await page.getByTestId('camera-stop-recording').click()
  await expect(page.getByText(/Запись зашифрована и сохранена локально/))
    .toBeVisible({timeout:40_000})
  expect(await countLocalMedia(page)).toBe(1)
  await expect.poll(()=>page.evaluate(async()=>{
    const journal=await import('/src/features/media/application/recording-encrypted-journal.ts')
    return (await journal.listEncryptedRecordingDrafts()).length
  }),{timeout:15_000}).toBe(0)
  await page.reload()
  await expect.poll(()=>page.evaluate(async()=>{
    const identity=await import('/src/features/identity/application/session.ts')
    if(!identity.activeSession.value)return -1
    const media=await import('/src/features/media/application/media-outbox.ts')
    return (await media.listLocalMedia()).length
  }),{timeout:30_000}).toBe(1)
  const stored=await page.evaluate(async()=>{
    const media=await import('/src/features/media/application/media-outbox.ts')
    const rows=await media.listLocalMedia()
    return rows.map(row=>({
      mediaType:row.mediaType,
      ciphertextOnly:row.chunks.every(chunk=>chunk.blob.type==='application/octet-stream'),
    }))
  })
  expect(stored).toEqual([{mediaType:'audio',ciphertextOnly:true}])
})

test('P2 #206 separate live tab cannot steal recording, closed writer permits explicit encrypted-only adoption',async({page})=>{
  test.setTimeout(150_000)
  await register(page)
  await page.goto('/camera')
  await expect(page.getByRole('button',{name:'Сделать снимок'}))
    .toBeEnabled({timeout:20_000})
  await page.getByTestId('camera-mode').selectOption('audio')
  await expect(page.getByTestId('camera-start-recording'))
    .toBeEnabled({timeout:20_000})
  await page.getByTestId('camera-start-recording').click()
  await expect(page.getByTestId('camera-recording-status')).toBeVisible()
  const draftId=await expect.poll(()=>page.evaluate(async()=>{
    const m=await import('/src/features/media/application/recording-encrypted-journal.ts')
    const d=(await m.listEncryptedRecordingDrafts())[0]
    return d?.state==='writing'&&d.recoveryAvailable&&d.chunkCount>0
      ?d.recordingId:''
  }),{timeout:20_000}).not.toBe('')
  void draftId
  const id=await page.evaluate(async()=>{
    const m=await import('/src/features/media/application/recording-encrypted-journal.ts')
    return (await m.listEncryptedRecordingDrafts())[0]!.recordingId
  })
  const peer=await page.context().newPage()
  try{
    await peer.goto('/camera')
    await expect(peer.getByRole('button',{name:'Сделать снимок'}))
      .toBeEnabled({timeout:30_000})
    const card=peer.getByTestId('camera-encrypted-draft-'+id)
    await expect(card).toBeVisible({timeout:20_000})
    await expect(card).toContainText('Возможна незавершённая запись')
    await expect(card.getByRole('button',{name:'Просмотреть локально'})).toHaveCount(0)
    await expect(card.getByRole('button',{name:'Удалить фрагменты'})).toHaveCount(0)
    await card.getByRole('button',{name:'Проверить прерванную запись'}).click()
    await expect(peer.getByTestId('camera-draft-error'))
      .toContainText('camera.recording_writer_busy')
    expect(await countLocalMedia(peer)).toBe(0)
    await expect.poll(()=>page.evaluate(async id=>{
      const m=await import('/src/features/media/application/recording-encrypted-journal.ts')
      return (await m.listEncryptedRecordingDrafts()).find(r=>r.recordingId===id)?.state
    },id)).toBe('writing')
    // Closing the actual page releases its browser-held Web Lock; no mocked
    // lock, localStorage heartbeat, or fabricated MediaRecorder.stop.
    await page.close()
    await expect.poll(()=>peer.evaluate(async id=>{
      const m=await import('/src/features/media/application/recording-encrypted-journal.ts')
      return (await m.listEncryptedRecordingDrafts()).find(r=>r.recordingId===id)?.state
    },id),{timeout:15_000}).toBe('writing')
    await card.getByRole('button',{name:'Проверить прерванную запись'}).click()
    await expect(card).toContainText('Прервана',{timeout:20_000})
    expect(await countLocalMedia(peer)).toBe(0)
    await card.getByRole('button',{name:'Просмотреть локально'}).click()
    await expect(peer.getByTestId('camera-private-draft-preview'))
      .toBeVisible({timeout:15_000})
    expect(await countLocalMedia(peer)).toBe(0)
  }finally{await peer.close()}
})
