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
      if(url.includes('/media/v1/'))
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
    await b.getByTestId('browser-search').fill('NOT-A-PRIVATE-KEYWORD')
    await expect(b.getByTestId('browser-private-search-status'))
      .toContainText('Все загруженные файлы проверены',{timeout:30000})
    await expect(remote).toHaveCount(0)
  }finally{
    await aContext.close();await bContext.close()
  }
})
