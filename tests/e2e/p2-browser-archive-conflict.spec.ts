import {expect,test} from '@playwright/test'

test('P2 Archive: unresolved signed delete/archival command cannot be discarded; obsolete CAS can',async({browser})=>{
  test.setTimeout(160000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    await page.getByTestId('media-import-file').setInputFiles({
      name:'PRIVATE-STALENESS.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(8192,0x37),
    })
    await expect(page.locator('[data-testid^="browser-row-media:"]'))
      .toHaveCount(1,{timeout:30000})
    await page.locator('.media-import-p1')
      .getByRole('button',{name:'Отправить медиа'}).click()
    await page.evaluate(async()=>{
      const module=await import('/src/features/media/application/media-outbox.ts')
      await module.synchronizeMedia()
    })
    await expect.poll(()=>page.evaluate(async()=>{
      const module=await import('/src/features/media/application/media-outbox.ts')
      return (await module.listLocalMedia()).filter(x=>x.state==='synced').length
    }),{timeout:30000}).toBe(1)
    await page.getByRole('button',{name:'Обновить',exact:true}).first().click()
    const row=page.locator('[data-testid^="browser-row-media:"]')
    await expect(row.getByRole('button',{name:/Архивировать файл/})).toBeVisible()
    const id=(await row.getAttribute('data-testid'))!
      .slice('browser-row-media:'.length)

    // The first signed request is never delivered. The mere absence of a
    // server operation is NOT sufficient reason to drop its encrypted outbox.
    await page.route('**/browser/v1/archive/actions',route=>route.abort('failed'))
    page.once('dialog',dialog=>dialog.accept())
    await row.getByRole('button',{name:/Архивировать файл/}).click()
    await expect(page.getByTestId('browser-archive-pending')).toBeVisible()
    await page.unroute('**/browser/v1/archive/actions')
    await page.getByTestId('browser-archive-inspect').click()
    await expect(page.getByTestId('browser-archive-pending'))
      .toContainText('Сервер пока не доказал')
    await expect(page.getByTestId('browser-archive-discard')).toHaveCount(0)

    // Another signed mutation wins the same immutable asset's CAS=0. A
    // delayed first request can now never succeed (strict server CAS).
    const competing=await page.evaluate(async mediaId=>{
      const {requireSession}=await import('/src/features/identity/application/session.ts')
      const {importSigner,sign}=await import('/src/features/identity/infrastructure/crypto.ts')
      const {jsonApi}=await import('/src/features/identity/infrastructure/api.ts')
      const s=requireSession()
      const command=JSON.stringify({
        version:1,accountId:s.accountId,writerDeviceId:s.deviceId,
        operationId:crypto.randomUUID(),kind:'media',assetId:mediaId,
        action:'archive',expectedRevision:0,
      })
      const signature=await sign(await importSigner(s.pkg.accountPkcs8),
        'pb3.browser-archive.v1\n'+command)
      return jsonApi<{revision:number}>('/browser/v1/archive/actions','POST',{
        command,signature,
      })
    },id)
    expect(competing.revision).toBe(1)
    await page.getByTestId('browser-archive-inspect').click()
    await expect(page.getByTestId('browser-archive-obsolete')).toBeVisible()
    page.once('dialog',dialog=>dialog.accept())
    await page.getByTestId('browser-archive-discard').click()
    await expect(page.getByTestId('browser-archive-pending')).toHaveCount(0)
    await expect(page.getByTestId('browser-archive-status'))
      .toContainText('Устаревший запрос безопасно снят')
    await page.getByTestId('browser-tab-archive').click()
    await expect(row).toHaveCount(1)
    const events=await page.evaluate(async mediaId=>{
      const resp=await fetch('/browser/v1/archive',{credentials:'same-origin'})
      const data=await resp.json() as {
        items:Array<{assetId:string;revision:number;state:string}>
      }
      return data.items.filter(x=>x.assetId===mediaId)
    },id)
    expect(events).toMatchObject([{assetId:id,revision:1,state:'archived'}])
  }finally{await context.close()}
})
