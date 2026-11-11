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

    // A genuine offline reload preserves the encrypted IndexedDB row.
    await page.reload()
    await expect(page.getByTestId('browser-v3')).toBeVisible()
    await expect(page.locator('[data-testid^="browser-row-media:"]')).toHaveCount(1)
  }finally{await context.close()}
})
