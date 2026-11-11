import {expect,test} from '@playwright/test'

test('P2 Browser: owner-confirmed sequential batch archive and restore use real signed per-file ledger',async({browser})=>{
  test.setTimeout(175000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    await expect(page.getByTestId('browser-pref-unconfirmed')).toHaveCount(0)
    const picker=page.getByTestId('media-import-file')
    for(const [i,label] of ['AUDIO-A','AUDIO-B'].entries()){
      await picker.setInputFiles({
        name:'PRIVATE-BATCH-'+label+'.wav',mimeType:'audio/wav',
        buffer:Buffer.alloc(8192,0x31+i),
      })
      await expect(page.locator('[data-testid^="browser-row-media:"]'))
        .toHaveCount(i+1,{timeout:20000})
    }
    await page.locator('.media-import-p1')
      .getByRole('button',{name:'Отправить медиа'}).click()
    await page.evaluate(async()=>{
      const module=await import('/src/features/media/application/media-outbox.ts')
      await module.synchronizeMedia()
    })
    await expect.poll(()=>page.evaluate(async()=>{
      const module=await import('/src/features/media/application/media-outbox.ts')
      return (await module.listLocalMedia()).filter(x=>x.state==='synced').length
    }),{timeout:30000}).toBe(2)
    await page.getByRole('button',{name:'Обновить',exact:true}).first().click()
    const row=page.locator('[data-testid^="browser-row-media:"]')
    await expect(row).toHaveCount(2,{timeout:15000})
    await expect(row.first().getByRole('button',{name:/Архивировать файл/}))
      .toBeEnabled()
    await page.getByRole('button',{name:'Выбрать всё на странице'}).click()
    await expect(page.getByTestId('browser-bulk-archive')).toContainText('(2)')
    page.once('dialog',d=>d.accept())
    await page.getByTestId('browser-bulk-archive').click()
    await expect(page.getByTestId('browser-bulk-status'))
      .toContainText('Все 2 операций подтверждены сервером',{timeout:30000})
    await expect(row).toHaveCount(0)
    await page.getByTestId('browser-tab-archive').click()
    await expect(row).toHaveCount(2)
    await page.getByRole('button',{name:'Выбрать всё на странице'}).click()
    page.once('dialog',d=>d.accept())
    await page.getByTestId('browser-bulk-restore').click()
    await expect(page.getByTestId('browser-bulk-status'))
      .toContainText('Все 2 операций подтверждены сервером',{timeout:30000})
    await expect(row).toHaveCount(0)
    await page.getByTestId('browser-tab-active').click()
    await expect(row).toHaveCount(2)
    const restored=await page.evaluate(async()=>{
      const response=await fetch('/browser/v1/archive')
      const body=await response.json() as {
        items:Array<{kind:string;revision:number;state:string;assetId:string}>
      }
      return body.items
    })
    expect(restored).toHaveLength(2)
    expect(restored.map(x=>({state:x.state,revision:x.revision})))
      .toEqual([{state:'restored',revision:2},{state:'restored',revision:2}])
  }finally{await context.close()}
})
