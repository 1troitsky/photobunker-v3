import {expect,test} from '@playwright/test'

test('Browser v3: opening section and folder-first display are real and device-persistent',async({page,context})=>{
  test.setTimeout(130000)
  await page.setViewportSize({width:390,height:844})
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  await page.goto('/browser')
  await expect(page.getByTestId('browser-tab-active'))
    .toHaveAttribute('aria-pressed','true')
  await page.getByTestId('browser-header-folder').click()
  await page.getByTestId('browser-folder-name').fill('Local display layout')
  await page.getByRole('button',{name:'Создать',exact:true}).click()
  await expect(page.locator('.browser-folder-item')).toHaveCount(1)

  await context.setOffline(true)
  await page.getByTestId('browser-header-upload').click()
  await page.getByTestId('media-import-file').setInputFiles({
    name:'PRESENTATION-ONLY.wav',mimeType:'audio/wav',
    buffer:Buffer.alloc(8192,0x44),
  })
  const file=page.locator('[data-testid^="browser-row-media:"]')
  await expect(file).toHaveCount(1,{timeout:25000})
  await page.getByTestId('browser-import-sheet-close').click()

  const top=page.getByTestId('browser-folder-cards-top')
  await expect(top.locator('.browser-folder-item')).toHaveCount(1)
  await page.getByTestId('browser-header-settings').click()
  await expect(page.getByTestId('browser-pref-open-first')).toHaveValue('all')
  await expect(page.getByTestId('browser-pref-folders-first')).toBeChecked()
  await page.getByTestId('browser-pref-folders-first').uncheck()
  await page.getByTestId('browser-pref-open-first').selectOption('personal')
  await page.getByTestId('browser-settings-close').click()

  await expect(top.locator('.browser-folder-item')).toHaveCount(0)
  await expect(page.locator('.browser-folder-item')).toHaveCount(1)
  await expect(file).toHaveCount(1)
  const below=await page.evaluate(()=>{
    const catalog=document.querySelector('[data-testid="browser-catalog"]')!
    const folder=document.querySelector('.browser-folder-list')!
    return Boolean(catalog.compareDocumentPosition(folder)
      &Node.DOCUMENT_POSITION_FOLLOWING)
  })
  expect(below).toBe(true)

  await page.reload()
  await expect(page.getByTestId('browser-tab-personal'))
    .toHaveAttribute('aria-pressed','true')
  await expect(file).toHaveCount(0)
  await expect(top.locator('.browser-folder-item')).toHaveCount(0)
  await page.getByTestId('browser-header-settings').click()
  await expect(page.getByTestId('browser-pref-open-first')).toHaveValue('personal')
  await expect(page.getByTestId('browser-pref-folders-first')).not.toBeChecked()
  await page.getByTestId('browser-pref-folders-first').check()
  await page.getByTestId('browser-pref-open-first').selectOption('all')
  await page.getByTestId('browser-settings-close').click()
  await expect(top.locator('.browser-folder-item')).toHaveCount(1)
  await page.getByTestId('browser-tab-active').click()
  await expect(file).toHaveCount(1)
  // The device preference does not mutate encrypted folder placement or
  // original AES-GCM file bytes, even after reload and another ordering.
  const bytes=await page.evaluate(async()=>{
    const m=await import('/src/features/media/application/media-outbox.ts')
    const saved=await m.listLocalMedia()
    return saved.find(item=>item.mediaType==='audio')?.plainBytes
  })
  expect(bytes).toBe(8192)
})
