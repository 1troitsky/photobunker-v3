import {test,expect} from '@playwright/test'

test('Browser v3: five owner-approved Header actions control the real encrypted catalog',async({page,context})=>{
  test.setTimeout(150000)
  await page.setViewportSize({width:390,height:844})
  await page.goto('/browser')
  const actions=page.getByTestId('browser-shell-actions')
  await expect(actions).toBeVisible()
  await expect(actions.locator('button')).toHaveCount(5)
  await expect(page.getByTestId('browser-header-folder')).toBeDisabled()

  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  await page.goto('/browser')
  await expect(page.getByTestId('browser-v3')).toBeVisible()
  const header=page.locator('.shell-header')
  await expect(header).toHaveCount(1)
  await expect(page.locator('.shell-dock')).toHaveCount(1)
  await expect(header.getByTestId('browser-shell-actions').locator('button')).toHaveCount(5)
  // The Browser body no longer duplicates its New Folder Header action.
  await expect(page.getByRole('button',{name:'Новая папка'})).toHaveCount(1)
  await expect(page.getByTestId('browser-header-folder')).toBeEnabled()
  await page.getByTestId('browser-header-folder').click()
  await expect(page.getByTestId('browser-folder-name')).toBeVisible()
  await expect(page.getByTestId('browser-folder-name')).toBeFocused()
  await page.getByTestId('browser-folder-name').fill('UX Header Folder')
  await page.getByRole('button',{name:'Создать',exact:true}).click()
  await expect(page.getByRole('button',{name:'UX Header Folder',exact:true})).toBeVisible()
  await expect(page.getByTestId('browser-folder-up')).toBeDisabled()
  await page.getByRole('button',{name:'UX Header Folder',exact:true}).click()
  await expect(page.getByTestId('browser-folder-up')).toBeEnabled()
  await expect(page.locator('.browser-title .subtitle')).toContainText('Файлов: 0')
  await page.getByTestId('browser-folder-up').click()
  await expect(page.getByTestId('browser-folder-up')).toBeDisabled()
  await expect(page.locator('.browser-title .subtitle')).toContainText('Папок: 1')

  await page.getByTestId('browser-header-search').click()
  await expect(page.getByTestId('browser-search')).toBeFocused()
  await page.getByTestId('browser-header-settings').click()
  await expect(page.getByTestId('browser-archive-preferences')).toBeInViewport()
  await page.getByTestId('browser-header-upload').click()
  await expect(page.getByTestId('browser-import-panel')).toBeInViewport()

  // Import remains in the real encrypted Local-First outbox. Header selection
  // never creates/approves permissions or bypasses folder membership.
  await context.setOffline(true)
  await page.getByTestId('media-import-file').setInputFiles({
    name:'HEADER-UX-OFFLINE.wav',mimeType:'audio/wav',
    buffer:Buffer.alloc(8192,0x61),
  })
  const rows=page.locator('[data-testid^="browser-row-media:"]')
  await expect(rows).toHaveCount(1,{timeout:25000})
  await expect(page.getByTestId('browser-header-select')).toBeEnabled()
  await page.getByTestId('browser-header-select').click()
  await expect(page.getByTestId('browser-header-select')).toHaveAttribute('aria-pressed','true')
  await expect(rows.first().locator('input[type=checkbox]')).toBeChecked()
  await page.getByTestId('browser-header-select').click()
  await expect(page.getByTestId('browser-header-select')).toHaveAttribute('aria-pressed','false')
  await expect(rows.first().locator('input[type=checkbox]')).not.toBeChecked()

  // All controls fit both the smallest approved mobile width and desktop;
  // only the existing single App header/dock are used.
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:844})
    await expect(header).toHaveCSS('height','64px')
    expect(await header.evaluate(el=>el.scrollWidth>el.clientWidth),
      'Header overflow at '+width).toBe(false)
    await expect(page.getByTestId('browser-shell-actions').locator('button')).toHaveCount(5)
  }
})
