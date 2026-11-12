import {expect,test,type Page} from '@playwright/test'

/**
 * #199: genuine P1 identity recovery, device proof and E2EE readback.
 * This QA suite NEVER fabricates authorizations, ciphertext ACKs or a revoke route.
 * Browser contexts have independent cookie jars, IndexedDB and storage.
 */
test.use({trace:'off',screenshot:'off',video:'off'})

async function register(page:Page):Promise<{key:string;accountId:string;deviceId:string}>{
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  const key=await page.locator('#generated-key').inputValue()
  expect(key).toMatch(/^PB2\./)
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  const ids=await page.evaluate(async()=>{
    const m=await import('/src/features/identity/application/session.ts')
    const a=m.requireSession()
    const response=await fetch('/identity/v2/me',{credentials:'same-origin',cache:'no-store'})
    if(!response.ok)throw Error('real signed session missing')
    const verified=await response.json() as {accountId:string;deviceId:string;revision:number}
    if(verified.accountId!==a.accountId||verified.deviceId!==a.deviceId||verified.revision!==1)
      throw Error('remote/local Identity disagreement')
    return {accountId:a.accountId,deviceId:a.deviceId}
  })
  return {key,...ids}
}

test('P1 #199: Recovery Key A→B trusted device, real ciphertext, reload and offline access boundary',
  async({browser})=>{
    test.setTimeout(170000)
    const ac=await browser.newContext(),bc=await browser.newContext()
    const A=await ac.newPage(),B=await bc.newPage()
    const filename='PB3-199-PRIVATE-RECOVERY.wav'
    const expectedByte=0x59
    const expectedLen=8192
    let key:string|null=null
    try{
      const a=await register(A)
      key=a.key
      await A.goto('/browser')
      const picker=A.getByTestId('media-import-file')
      await expect(picker).toBeEnabled({timeout:30000})
      await picker.setInputFiles({
        name:filename,mimeType:'audio/wav',buffer:Buffer.alloc(expectedLen,expectedByte),
      })
      await expect.poll(()=>A.evaluate(async()=>{
        const m=await import('/src/features/media/application/media-outbox.ts')
        return (await m.listLocalMedia()).length
      }),{timeout:30000}).toBe(1)
      await A.evaluate(async()=>{
        const m=await import('/src/features/media/application/media-outbox.ts')
        await m.synchronizeMedia()
      })
      const mediaId=await A.evaluate(async()=>{
        const m=await import('/src/features/media/application/media-outbox.ts')
        const list=await m.listLocalMedia()
        if(list.length!==1||list[0]!.state!=='synced')
          throw Error('real Garage ciphertext ACK not received')
        return list[0]!.mediaId
      })
      expect(mediaId).toMatch(/^[0-9a-f-]{36}$/)
      // Device A has an encrypted durable local outbox, actually decryptable
      // when disconnected. This is NOT an OS-gallery or cloud-only copy.
      await ac.setOffline(true)
      const local=await A.evaluate(async id=>{
        const m=await import('/src/features/media/application/media-outbox.ts')
        const file=await m.readLocalMedia(id)
        const bytes=new Uint8Array(await file.blob.arrayBuffer())
        return {size:bytes.length,first:bytes[0],last:bytes.at(-1),
          name:file.metadata.fileName}
      },mediaId)
      expect(local).toEqual({
        size:expectedLen,first:expectedByte,last:expectedByte,name:filename,
      })
      await ac.setOffline(false)

      // B is a genuinely separate browser profile with no transferred
      // IndexedDB, session cookies, local device keys or media file.
      const before=await B.evaluate(async()=>{
        const m=await import('/src/features/identity/infrastructure/storage.ts')
        return (await m.listDevices()).length
      })
      expect(before).toBe(0)
      const requests:string[]=[]
      B.on('request',request=>{
        if(request.url().includes('/identity/v2')||request.url().includes('/media/v1'))
          requests.push(request.url()+' '+(request.postData()??''))
      })
      await B.goto('/settings')
      await B.locator('#recovery-key').fill(key)
      await B.getByRole('button',{name:'Восстановить',exact:true}).click()
      await expect(B.getByText('Подтверждённая сессия')).toBeVisible({timeout:30000})
      const recovery=await B.evaluate(async()=>{
        const session=await import('/src/features/identity/application/session.ts')
        const api=await import('/src/features/identity/infrastructure/api.ts')
        const s=session.requireSession()
        const me=await api.jsonApi<{accountId:string;deviceId:string;revision:number}>('/identity/v2/me')
        const list=await api.jsonApi<{devices:Array<{id:string;revoked_at:string|null}>}>(
          '/identity/v2/devices')
        return {accountId:s.accountId,deviceId:s.deviceId,server:me,
          devices:list.devices.map(x=>({id:x.id,revoked:x.revoked_at}))}
      })
      expect(recovery.accountId).toBe(a.accountId)
      expect(recovery.deviceId).not.toBe(a.deviceId)
      expect(recovery.server).toEqual({
        accountId:a.accountId,deviceId:recovery.deviceId,revision:1,
      })
      expect(recovery.devices.filter(x=>x.revoked===null).map(x=>x.id).sort())
        .toEqual([a.deviceId,recovery.deviceId].sort())
      const fromB=await B.evaluate(async id=>{
        const m=await import('/src/features/media/application/media-outbox.ts')
        const cloud=await m.listCloudMedia()
        if(!cloud.items.some(row=>row.mediaId===id))
          throw Error('account authorized index did not include recovered media')
        const file=await m.readCloudMedia(id) // signed manifest, receipt, AES-GCM chunks
        const bytes=new Uint8Array(await file.blob.arrayBuffer())
        return {name:file.metadata.fileName,first:bytes[0],last:bytes.at(-1),
          size:bytes.length,localCopies:(await m.listLocalMedia()).length}
      },mediaId)
      expect(fromB).toEqual({
        name:filename,size:expectedLen,first:expectedByte,last:expectedByte,localCopies:0,
      })
      // An entirely unrelated account cannot read B/A's private manifests.
      const outsiderContext=await browser.newContext()
      try{
        const outsider=await outsiderContext.newPage()
        const foreign=await register(outsider)
        expect(foreign.accountId).not.toBe(a.accountId)
        const rejected=await outsider.evaluate(async id=>{
          const m=await import('/src/features/media/application/media-outbox.ts')
          try{await m.readCloudMediaMetadata(id);return false}
          catch(e){return e instanceof Error&&e.message==='api.http_404'}
        },mediaId)
        expect(rejected).toBe(true)
      }finally{await outsiderContext.close()}
      const localStorageContents=await B.evaluate(()=>JSON.stringify(localStorage))
      expect(localStorageContents).not.toContain(key)
      expect(localStorageContents).not.toContain(filename)
      expect(requests.join('\n')).not.toContain(key)
      expect(requests.join('\n')).not.toContain(filename)

      // A trusted device resumes via its OWN locally durable, non-extractable
      // keys. The Recovery Key is NOT sent again after a document reload.
      const initialRequests=requests.length
      await B.reload()
      await expect(B.getByText('Подтверждённая сессия')).toBeVisible({timeout:30000})
      await expect.poll(()=>B.evaluate(async()=>{
        const m=await import('/src/features/identity/application/session.ts')
        return m.activeSession.value?.online===true
      }),{timeout:20000}).toBe(true)
      expect(requests.slice(initialRequests).some(s=>s.includes('/identity/v2/recovery/')))
        .toBe(false)
      const repeated=await B.evaluate(async id=>{
        const m=await import('/src/features/media/application/media-outbox.ts')
        const file=await m.readCloudMedia(id)
        return {size:file.blob.size,name:file.metadata.fileName}
      },mediaId)
      expect(repeated).toEqual({size:expectedLen,name:filename})
      // B has NO persistent offline media copy from a cloud read. Do not
      // incorrectly claim encrypted B offline media restore was implemented.
      await bc.setOffline(true)
      await B.evaluate(async()=>{
        const api=await import('/src/features/identity/application/session.ts')
        if(api.requireSession().deviceId.length!==36)throw Error('device session lost')
        await api.logout() // local signed-out fence; remote logout may be offline
        if(api.activeSession.value!==null)throw Error('offline logout failed')
      })
      await bc.setOffline(false)
      await B.reload()
      await expect(B.getByRole('button',{name:'Создать ключ'})).toBeVisible()
      // Trust status and ciphertext bytes are derived from real API and E2EE.
      console.log('PB3_QA_199_RECOVERY '+JSON.stringify({
        sameAccount:true,independentDevice:true,serverDevices:recovery.devices.length,
        mediaBytes:fromB.size,serverAck:true,offlineOwnerReadback:true,
        reloadTrusted:true,offlineLogoutFenced:true,recoveredDeviceCloudOnly:true,
        foreignAccountMediaDenied:true,
      }))
      await test.info().attach('p1-recovery-verified-summary.json',{
        body:JSON.stringify({sameAccount:true,twoDevices:true,assetBytes:fromB.size,
          offlineOwnerReadback:true,reloadTrusted:true,offlineLogoutFenced:true,
          recoveredDeviceCloudOnly:true,foreignAccountMediaDenied:true},null,2),contentType:'application/json',
      })
    }finally{
      key=null
      await ac.close();await bc.close()
    }
})

test('P1 #199: wrong Recovery Key, invalid signed login proof and other account denied',
  async({browser})=>{
    test.setTimeout(150000)
    const aCtx=await browser.newContext(),intruderCtx=await browser.newContext()
    const A=await aCtx.newPage(),C=await intruderCtx.newPage()
    let key:string|null=null
    try{
      const a=await register(A);key=a.key
      await C.goto('/settings')
      // Invalidate one checksum character, not the key payload or locator.
      const parts=key.split('.')
      expect(parts).toHaveLength(4)
      parts[3]=parts[3]![0]==='A'?'B'+parts[3]!.slice(1):'A'+parts[3]!.slice(1)
      await C.locator('#recovery-key').fill(parts.join('.'))
      await C.getByRole('button',{name:'Восстановить',exact:true}).click()
      await expect(C.getByRole('alert')).toContainText('identity.invalid_checksum')
      await expect(C.getByText('Подтверждённая сессия')).toHaveCount(0)
      // A second, unrelated account can authenticate itself but may not
      // impersonate the original root account's device.
      const outsider=await register(C)
      expect(outsider.accountId).not.toBe(a.accountId)
      const proof=await A.evaluate(async()=>{
        const s=await import('/src/features/identity/application/session.ts')
        const a=await import('/src/features/identity/infrastructure/api.ts')
        const c=await import('/src/features/identity/infrastructure/crypto.ts')
        const state=s.requireSession()
        const challenge=await a.jsonApi<{id:string;message:string}>(
          '/identity/v2/challenges','POST',{payload:{
            accountId:state.accountId,deviceId:state.deviceId,purpose:'login',
          }})
        // This is a well-formed P1363 signature (64 zero bytes), NOT
        // signed by either the account or the trusted device.
        const forged=c.b64(new Uint8Array(64))
        let denied=false
        try{
          await a.jsonApi('/identity/v2/proof','POST',{
            challengeId:challenge.id,signature:forged,deviceSignature:'',envelope:null,
          })
        }catch(e){denied=e instanceof Error&&e.message==='api.http_401'}
        const stillMe=await a.jsonApi<{accountId:string;deviceId:string}>('/identity/v2/me')
        return {denied,originalSessionStillValid:stillMe.accountId===state.accountId
          &&stillMe.deviceId===state.deviceId}
      })
      expect(proof).toEqual({denied:true,originalSessionStillValid:true})
      const otherDevices=await C.evaluate(async()=>{
        const api=await import('/src/features/identity/infrastructure/api.ts')
        const response=await api.jsonApi<{devices:Array<{id:string;revoked_at:string|null}>}>(
          '/identity/v2/devices')
        return response.devices.map(item=>item.id)
      })
      // Real account-scoped API, not an absent route or a mock permission.
      expect(otherDevices).toEqual([outsider.deviceId])
      expect(otherDevices).not.toContain(a.deviceId)
      console.log('PB3_QA_199_NEGATIVE '+JSON.stringify({
        badKeyDenied:true,forgedLoginDenied:true,outsiderDifferentAccount:true,
        originalSessionPreserved:true,scopedDeviceList:true,
      }))
    }finally{
      key=null
      await aCtx.close();await intruderCtx.close()
    }
})
