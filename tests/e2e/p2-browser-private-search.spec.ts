import {expect,test} from '@playwright/test'

test('P2 Browser: offline private metadata search and second-device cloud search without plaintext disclosure',async({browser})=>{
  test.setTimeout(170000)
  const aContext=await browser.newContext(),bContext=await browser.newContext()
  const a=await aContext.newPage(),b=await bContext.newPage()
  const secret='PRIVATE-SEARCH-SAMPLE'
  try{
    await a.goto('/settings')
    await a.getByRole('button',{name:'Создать ключ'}).click()
    const recoveryKey=await a.locator('#generated-key').inputValue()
    await a.getByLabel('Я сохранил ключ восстановления').check()
    await a.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(a.getByText('Подтверждённая сессия')).toBeVisible()
    await a.goto('/browser')
    await expect(a.getByTestId('browser-v3')).toBeVisible()
    await a.locator('#media-import-category').fill('Полевые отчёты')
    await a.locator('#media-import-description').fill('Секретная заметка для клиента')
    await a.locator('#media-import-tags').fill('evidence, night')
    await aContext.setOffline(true)
    // Changing online state must not erase a user's unsent private evidence.
    await expect(a.locator('#media-import-category')).toHaveValue('Полевые отчёты')
    await expect(a.locator('#media-import-description'))
      .toHaveValue('Секретная заметка для клиента')
    await expect(a.locator('#media-import-tags')).toHaveValue('evidence, night')
    await a.getByTestId('media-import-file').setInputFiles({
      name:secret+'.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(8192,0x42),
    })
    const rows=a.locator('[data-testid^="browser-row-media:"]')
    await expect(rows).toHaveCount(1,{timeout:25000})
    // Assert actual AEAD-decrypted persistence, not only UI search behavior.
    const metadata=await a.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const encrypted=await m.listLocalMedia()
      return m.readLocalMediaMetadata(encrypted[0]!.mediaId)
    })
    expect(metadata).toMatchObject({
      fileName:secret+'.wav',category:'Полевые отчёты',
      description:'Секретная заметка для клиента',
      tags:['evidence','night'],
    })
    await a.getByTestId('browser-search').fill(secret)
    await expect(rows).toHaveCount(1,{timeout:15000})
    await expect(a.getByTestId('browser-private-search-status'))
      .toContainText('Проверено 1 из 1',{timeout:20000})
    for(const text of ['секретная заметка','полевые','evidence night']){
      await a.getByTestId('browser-search').fill(text)
      await expect(a.getByTestId('browser-private-search-status'))
        .toContainText('Проверено 1 из 1',{timeout:20000})
      await expect(rows).toHaveCount(1)
    }
    await a.getByTestId('browser-search').fill('НЕСУЩЕСТВУЮЩЕЕ-ПОЛЕ')
    await expect(a.getByTestId('browser-private-search-status'))
      .toContainText('Все загруженные файлы проверены',{timeout:20000})
    await expect(rows).toHaveCount(0)
    await a.getByTestId('browser-search').fill('')
    await expect(rows).toHaveCount(1)

    // Search across virtual folders must not change encrypted placement or
    // send private keywords to the backend. Only loaded rows are in scope.
    const movedId=await a.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia())[0]!.mediaId
    })
    await a.getByRole('button',{name:'Новая папка'}).click()
    await a.getByTestId('browser-folder-name').fill('Секретный раздел')
    await a.getByRole('button',{name:'Создать',exact:true}).click()
    await rows.getByRole('combobox',{name:'Папка файла '+movedId})
      .selectOption({label:'Секретный раздел'})
    await expect(rows).toHaveCount(0)
    await a.getByTestId('browser-search').fill('секретная заметка')
    await expect(rows).toHaveCount(0)
    await a.getByTestId('browser-search-folder-scope').selectOption('all')
    await expect(a.getByTestId('browser-private-search-status'))
      .toContainText('Проверено 1 из 1',{timeout:20000})
    await expect(rows).toHaveCount(1)
    await expect(a.getByTestId('browser-search-result-folder'))
      .toHaveText('Папка: Секретный раздел')
    await a.getByTestId('browser-search-folder-scope').selectOption('current')
    await expect(rows).toHaveCount(0)
    await a.getByTestId('browser-search').fill('')

    await aContext.setOffline(false)
    await a.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      await m.synchronizeMedia()
    })
    await expect.poll(()=>a.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).filter(row=>row.state==='synced').length
    }),{timeout:30000}).toBe(1)

    await b.goto('/settings')
    await b.locator('#recovery-key').fill(recoveryKey)
    await b.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(b.getByText('Подтверждённая сессия')).toBeVisible()
    const requests:string[]=[]
    b.on('request',request=>{
      const url=request.url()
      if(url.includes('/media/v1')||url.includes('/photos/v1'))
        requests.push(url+(request.postData()??''))
    })
    await b.goto('/browser')
    const remote=b.locator('[data-testid^="browser-row-media:"]')
    await expect(remote).toHaveCount(1,{timeout:25000})
    await expect(remote.first()).toContainText('Только в облаке')
    await b.getByTestId('browser-search').fill('секретная заметка')
    await expect(b.getByTestId('browser-private-search-status'))
      .toContainText('Проверено 1 из 1',{timeout:30000})
    await expect(remote).toHaveCount(1)
    // Authenticated ciphertext endpoints receive opaque UUIDs only.
    expect(requests.some(x=>x.includes('/manifests'))).toBe(true)
    expect(requests.filter(x=>x.includes('/chunks/'))).toHaveLength(1)
    expect(requests.join('\n')).not.toContain('секретная')
    expect(requests.join('\n')).not.toContain(secret)
    expect(requests.join('\n')).not.toContain('evidence')

    await b.getByTestId('browser-search').fill('night')
    await expect(b.getByTestId('browser-private-search-status'))
      .toContainText('Проверено 1 из 1',{timeout:30000})
    await expect(remote).toHaveCount(1)
    // V-33: opt-in extended search fetches authenticated opaque index
    // pages, not the user's query; actual AES-GCM metadata check stays local.
    await b.getByTestId('browser-private-search-expand').click()
    await expect(b.getByTestId('browser-expanded-search-status'))
      .toContainText('Индексы этих двух типов загружены полностью.',{timeout:30000})
    await expect(b.getByTestId('browser-private-search-status'))
      .toContainText('Проверено 1 из 1',{timeout:30000})
    await expect(remote).toHaveCount(1)
    expect(requests.join('\n')).not.toContain('секретная')
    expect(requests.join('\n')).not.toContain(secret)
    expect(requests.join('\n')).not.toContain('night')
    await b.getByTestId('browser-search').fill('NOT-A-PRIVATE-KEYWORD')
    await expect(b.getByTestId('browser-private-search-status'))
      .toContainText('Все загруженные файлы проверены',{timeout:30000})
    await expect(remote).toHaveCount(0)

    // V-35: the embedded MediaImportPanel is a SEPARATE catalog reader.
    // Return one REAL signed/ciphertext-authorized row twice to mimic a
    // stale/malicious index. The local-first UI must retain the previous
    // authentic cloud list and cursor, rather than accepting duplicated IDs.
    const panel=b.locator('.media-import-p1')
    const verifiedCloud=panel.getByRole('button',{name:'Проверить из облака'})
    await expect(verifiedCloud).toHaveCount(1,{timeout:20000})
    let duplicateDelivered=0
    await b.route('**/media/v1',async route=>{
      const response=await route.fetch()
      const data=await response.json() as {
        items:Array<Record<string,unknown>>;nextCursor:string|null
      }
      if(data.items.length!==1)throw Error('expected 1 authenticated media')
      duplicateDelivered++
      await route.fulfill({response,contentType:'application/json',
        body:JSON.stringify({...data,items:[data.items[0],data.items[0]]})})
    })
    await panel.getByRole('button',{name:'Обновить'}).click()
    await expect(panel.getByRole('alert'))
      .toContainText('browser.invalid_cloud_catalog_page',{timeout:20000})
    expect(duplicateDelivered).toBeGreaterThan(0)
    await expect(verifiedCloud).toHaveCount(1)
    await b.unroute('**/media/v1')
    await panel.getByRole('button',{name:'Обновить'}).click()
    await expect(panel.getByRole('alert')).toHaveCount(0,{timeout:20000})
    await expect(verifiedCloud).toHaveCount(1)

    // A slow older authenticated response must NOT overwrite the newer
    // successful refresh in the same mounted component.
    let unlockOld!:()=>void
    let sawOld!:()=>void
    let servedNew!:()=>void
    const oldPending=new Promise<void>(resolve=>{sawOld=resolve})
    const oldGate=new Promise<void>(resolve=>{unlockOld=resolve})
    const newFinished=new Promise<void>(resolve=>{servedNew=resolve})
    let refreshCalls=0
    await b.route('**/media/v1',async route=>{
      refreshCalls++
      if(refreshCalls===1){
        sawOld()
        await oldGate
        await route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({items:[],nextCursor:null})})
        return
      }
      const response=await route.fetch()
      await route.fulfill({response})
      servedNew()
    })
    await panel.getByRole('button',{name:'Обновить'}).click()
    await oldPending
    await panel.getByRole('button',{name:'Обновить'}).click()
    await newFinished
    unlockOld()
    await expect(verifiedCloud).toHaveCount(1,{timeout:20000})
    await b.waitForTimeout(200)
    await expect(verifiedCloud).toHaveCount(1)
    expect(refreshCalls).toBe(2)
    await b.unroute('**/media/v1')

    expect(requests.join('\n')).not.toContain('секретная')
    expect(requests.join('\n')).not.toContain(secret)
  }finally{
    await aContext.close();await bContext.close()
  }
})
