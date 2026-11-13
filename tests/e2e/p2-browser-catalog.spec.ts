import {test,expect} from '@playwright/test'

test('P2 Browser v3: real anonymous login → offline encrypted media → catalog filters and decrypted viewer',async({browser})=>{
  test.setTimeout(120000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    await expect(page.getByTestId('browser-v3')).toBeVisible()
    await expect(page.getByTestId('browser-summary')).toContainText('0 файлов')

    await context.setOffline(true)
    await page.getByTestId('media-import-file').setInputFiles({
      name:'PRIVATE-VIDEO-TEST.webm',mimeType:'video/webm',
      buffer:Buffer.alloc(8192,0x42),
    })
    await expect(page.locator('.media-import-p1')
      .getByText('Файл зашифрован и сохранён', {exact:false}))
      .toBeVisible()
    const rows=page.locator('[data-testid^="browser-row-media:"]')
    await expect(rows).toHaveCount(1,{timeout:25000})
    await expect(rows.first()).toContainText('На устройстве')
    await expect(rows.first()).toContainText('queued')

    await page.getByTestId('browser-filter-photo').click()
    await expect(rows).toHaveCount(0)
    await page.getByTestId('browser-filter-video').click()
    await expect(rows).toHaveCount(1)
    await page.getByTestId('browser-search').fill('NOT-THIS-ID')
    await expect(rows).toHaveCount(0)
    await page.getByTestId('browser-search').fill('')
    await page.getByRole('button',{name:'Сетка',exact:true}).click()
    await expect(page.getByTestId('browser-catalog')).toHaveClass(/browser-grid/)
    await rows.first().getByRole('button',{name:/Открыть файл/}).click()
    const preview=page.getByTestId('browser-preview')
    await expect(preview).toContainText('PRIVATE-VIDEO-TEST.webm')
    await expect(preview.locator('video')).toBeVisible()
    await preview.getByRole('button',{name:'Закрыть просмотр'}).click()
    await expect(preview).toHaveCount(0)

    // Reload a live document then disconnect again: encrypted IndexedDB
    // survives reload. Cold offline app boot is a separate signed-PWA gate.
    await context.setOffline(false)
    await page.reload()
    await context.setOffline(true)
    await expect(page.getByTestId('browser-v3')).toBeVisible()
    await expect(page.locator('[data-testid^="browser-row-media:"]')).toHaveCount(1)
  }finally{await context.close()}
})

test('P2 Browser: sort two genuinely encrypted offline files by confirmed byte size',async({browser})=>{
  test.setTimeout(90000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    await context.setOffline(true)
    const picker=page.getByTestId('media-import-file')
    await picker.setInputFiles({
      name:'LOCAL-SMALL.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(8192,0x45),
    })
    const rows=page.locator('[data-testid^="browser-row-media:"]')
    await expect(rows).toHaveCount(1,{timeout:25000})
    await picker.setInputFiles({
      name:'LOCAL-LARGE.webm',mimeType:'video/webm',
      buffer:Buffer.alloc(32768,0x41),
    })
    await expect(rows).toHaveCount(2,{timeout:25000})
    const bySize=await page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const items=await media.listLocalMedia()
      if(items.length!==2)throw Error('expected two locally encrypted assets')
      return items.sort((a,b)=>b.plainBytes-a.plainBytes).map(x=>x.mediaId)
    })
    await page.getByTestId('browser-sort').selectOption('size-largest')
    await expect(rows.first()).toHaveAttribute('data-testid','browser-row-media:'+bySize[0])
    await expect(rows.last()).toHaveAttribute('data-testid','browser-row-media:'+bySize[1])
    await expect(rows.first()).toContainText('32 КиБ')
    await page.getByTestId('browser-sort').selectOption('size-smallest')
    await expect(rows.first()).toHaveAttribute('data-testid','browser-row-media:'+bySize[1])
    await expect(rows.first()).toContainText('8 КиБ')
    // Sort never modifies encrypted files, their account or durable outbox.
    expect(await page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia()).map(x=>x.plainBytes).sort((a,b)=>a-b)
    })).toEqual([8192,32768])
  }finally{await context.close()}
})
