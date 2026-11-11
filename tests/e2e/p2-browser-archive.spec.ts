import {expect,test} from '@playwright/test'

test('P2 Browser: signed owner media archive, restore, then permanent tombstone without fabricated GC ACK',async({browser})=>{
  test.setTimeout(150000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    await expect(page.getByTestId('browser-tab-active')).toBeVisible()

    const picker=page.getByTestId('media-import-file')
    await picker.setInputFiles({
      name:'PRIVATE-ARCHIVE-AUDIO.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(8192,0x45),
    })
    const row=page.locator('[data-testid^="browser-row-media:"]')
    await expect(row).toHaveCount(1,{timeout:20000})
    await page.locator('.media-import-p1')
      .getByRole('button',{name:'Отправить медиа'}).click()
    // Import is Local-First and may already be flushing in the background.
    // Require a genuine signed server ACK before exposing archive actions.
    await page.evaluate(async()=>{
      const module=await import('/src/features/media/application/media-outbox.ts')
      await module.synchronizeMedia()
    })
    await expect.poll(()=>page.evaluate(async()=>{
      const module=await import('/src/features/media/application/media-outbox.ts')
      return (await module.listLocalMedia()).filter(x=>x.state==='synced').length
    }),{timeout:30000}).toBe(1)
    await page.getByRole('button',{name:'Обновить',exact:true}).first().click()
    await expect(row.getByRole('button',{name:/Архивировать файл/}))
      .toBeVisible({timeout:30000})
    const id=await row.evaluate(element=>
      element.getAttribute('data-testid')!.slice('browser-row-media:'.length))
    expect(id).toMatch(/^[a-f0-9-]{36}$/)

    page.once('dialog',dialog=>dialog.accept())
    await row.getByRole('button',{name:/Архивировать файл/}).click()
    await expect(page.getByTestId('browser-archive-status'))
      .toContainText('помещён в архив',{timeout:20000})
    await expect(row).toHaveCount(0)
    const active=await page.evaluate(async()=>{
      const response=await fetch('/media/v1',{credentials:'same-origin'})
      return response.json() as Promise<{items:unknown[]}>
    })
    expect(active.items).toHaveLength(0)
    await page.getByTestId('browser-tab-archive').click()
    await expect(row).toHaveCount(1)
    await expect(row.getByRole('button',{name:/Восстановить файл/}))
      .toBeVisible()
    await row.getByRole('button',{name:/Восстановить файл/}).click()
    await expect(page.getByTestId('browser-archive-status'))
      .toContainText('восстановлен из архива')
    await expect(row).toHaveCount(0)
    await page.getByTestId('browser-tab-active').click()
    await expect(row).toHaveCount(1)
    const recovered=await page.evaluate(async()=>{
      const response=await fetch('/media/v1',{credentials:'same-origin'})
      return response.json() as Promise<{items:unknown[]}>
    })
    expect(recovered.items).toHaveLength(1)

    page.once('dialog',dialog=>dialog.accept())
    await row.getByRole('button',{name:/Архивировать файл/}).click()
    await page.getByTestId('browser-tab-archive').click()
    await expect(row).toHaveCount(1)
    page.once('dialog',dialog=>dialog.accept())
    await row.getByRole('button',{name:/Запросить удаление файла/}).click()
    await expect(page.getByTestId('browser-archive-status'))
      .toContainText('физическая очистка S3 ещё НЕ подтверждена')
    await expect(row).toContainText('pending_gc')
    await expect(row.getByRole('button',{name:/Восстановить файл/}))
      .toHaveCount(0)
    const results=await page.evaluate(async mediaId=>{
      const response=await fetch('/browser/v1/archive',{credentials:'same-origin'})
      const body=await response.json() as {
        items:Array<{assetId:string;state:string;physicalStatus:string}>
      }
      const read=await fetch('/media/v1/'+mediaId+'/manifests',
        {credentials:'same-origin'})
      return {item:body.items.find(x=>x.assetId===mediaId),read:read.status}
    },id)
    expect(results.item).toMatchObject({
      assetId:id,state:'deleting',physicalStatus:'pending_gc',
    })
    expect(results.read).toBe(410)
  }finally{await context.close()}
})
