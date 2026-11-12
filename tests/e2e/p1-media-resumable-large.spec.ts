import {expect,test} from '@playwright/test'

/**
 * #200: real browser AES-GCM 65MiB, genuine Garage PUT and deliberate lost
 * HTTP ACK (response only), durable reload and second Recovery-Key device.
 * No fake Identity, finalization, receipt, file read, quota or S3 upload.
 */
test('P1 #200 >64MiB ciphertext survives offline, lost ACK, reload and independent E2EE readback',async({browser})=>{
  test.setTimeout(300000)
  const ownerContext=await browser.newContext()
  const restoredContext=await browser.newContext()
  const A=await ownerContext.newPage()
  const B=await restoredContext.newPage()
  const name='PRIVATE-P1-200-LARGE-VOICE.wav'
  const plainSize=65*1024*1024+17
  const marker=0x69
  let forwardedPut=0
  let simulatedLostAck=false
  try{
    await A.goto('/settings')
    await A.getByRole('button',{name:'Создать ключ'}).click()
    const key=await A.locator('#generated-key').inputValue()
    await A.getByLabel('Я сохранил ключ восстановления').check()
    await A.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(A.getByText('Подтверждённая сессия')).toBeVisible()
    await A.goto('/browser')
    await expect(A.getByTestId('media-import-file')).toBeEnabled({timeout:30000})

    // Durable ciphertext must be created before any network is available.
    await ownerContext.setOffline(true)
    const pending=await A.evaluate(async({len,filename,byte})=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const source=new Uint8Array(len).fill(byte)
      source[0]=0x31
      source[1024*1024+27]=0x42
      source[len-1]=0x53
      const file=new File([source],filename,{type:'audio/wav'})
      const mediaId=await m.enqueueEncryptedMedia(file)
      const rows=await m.listLocalMedia()
      if(rows.length!==1)throw Error('P1 #200 missing durable local row')
      const row=rows[0]!
      return {
        mediaId,state:row.state,chunkCount:row.chunks.length,
        plainBytes:row.plainBytes,
        containsName:JSON.stringify(row).includes(filename),
        rawBytes:row.chunks.reduce((sum,x)=>sum+x.blob.size,0),
      }
    },{len:plainSize,filename:name,byte:marker})
    expect(pending.state).toBe('queued')
    expect(pending.chunkCount).toBe(67) // 66 AES-GCM data + private metadata
    expect(pending.plainBytes).toBe(plainSize)
    expect(pending.rawBytes).toBeGreaterThan(plainSize)
    expect(pending.containsName).toBe(false)

    // The *real* backend successfully accepts and verifies the first chunk,
    // but the transport drops its HTTP ACK before delivering it to the PWA.
    // Subsequent exact chunk retries are still signed and idempotent.
    await A.route('**/media/v1/*/chunks/*',async route=>{
      if(!simulatedLostAck){
        simulatedLostAck=true
        const server=await route.fetch()
        forwardedPut=server.status()
        await route.fulfill({
          status:503,contentType:'application/json',
          body:JSON.stringify({error:'simulated_lost_client_ACK'}),
          headers:{'Cache-Control':'no-store'},
        })
      }else await route.continue()
    })

    await ownerContext.setOffline(false)
    // Auto-flush on real online event may already be running; a second call
    // joins the same in-flight singleton, never creates another outbox row.
    await A.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      await m.synchronizeMedia()
    })
    expect(simulatedLostAck).toBe(true)
    expect(forwardedPut).toBe(200) // actual Garage upload, not a mocked ACK
    await expect.poll(()=>A.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia())[0]?.state
    }),{timeout:30000}).toBe('retry')

    // No fabricated signed finalize/receipt is allowed at this point.
    const unfinalized=await A.evaluate(async id=>
      (await fetch('/media/v1/'+id+'/manifests',{
        credentials:'same-origin',cache:'no-store',
      })).status,pending.mediaId)
    expect(unfinalized).toBe(409)

    await A.unroute('**/media/v1/*/chunks/*')
    await A.reload()
    await A.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      await m.synchronizeMedia()
    })
    await expect.poll(()=>A.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia())[0]?.state
    }),{timeout:170000}).toBe('synced')

    const owner=await A.evaluate(async id=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const response=await fetch('/media/v1/'+id+'/manifests',{
        credentials:'same-origin',cache:'no-store',
      })
      if(response.status!==200)throw Error('media.finalize_ack_missing')
      const manifest=await response.json()
      const data=await m.readCloudMedia(id)
      const clear=new Uint8Array(await data.blob.arrayBuffer())
      return {
        receipt:manifest.receipt?.receiptHash,
        publicLeaks:JSON.stringify(manifest).includes('PRIVATE-P1-200'),
        name:data.metadata.fileName,
        size:clear.length,
        first:clear[0],middle:clear[1024*1024+27],last:clear.at(-1),
      }
    },pending.mediaId)
    expect(owner.receipt).toMatch(/^[a-f0-9]{64}$/)
    expect(owner.publicLeaks).toBe(false)
    expect(owner).toMatchObject({
      name,size:plainSize,first:0x31,middle:0x42,last:0x53,
    })

    // Independent browser/device: no copied IndexedDB or cookies, only the
    // real Recovery Key and genuine server S3 ciphertext readback.
    await B.goto('/settings')
    await B.locator('#recovery-key').fill(key)
    await B.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(B.getByText('Подтверждённая сессия'))
      .toBeVisible({timeout:30000})
    await B.goto('/browser')
    await B.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
    })
    const recovered=await B.evaluate(async id=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const ownRows=await m.listLocalMedia()
      const data=await m.readCloudMedia(id)
      const bytes=new Uint8Array(await data.blob.arrayBuffer())
      return {
        localRows:ownRows.length,size:bytes.length,
        name:data.metadata.fileName,mime:data.blob.type,
        first:bytes[0],middle:bytes[1024*1024+27],last:bytes.at(-1),
      }
    },pending.mediaId)
    expect(recovered).toEqual({
      localRows:0,size:plainSize,name,mime:'audio/wav',
      first:0x31,middle:0x42,last:0x53,
    })
  }finally{
    await ownerContext.close()
    await restoredContext.close()
  }
})
