import {test,expect} from '@playwright/test'

test('Fieldwork Camera 1.2: one Shell, three context actions, real modes and non-destructive blind overlay',async({page})=>{
  test.setTimeout(120000)
  await page.setViewportSize({width:390,height:844})
  await page.goto('/camera')
  await expect(page.getByTestId('camera-shell-actions')).toBeVisible()
  await expect(page.getByTestId('camera-header-flip')).toBeDisabled()
  await expect(page.getByTestId('camera-header-torch')).toBeDisabled()
  await expect(page.getByTestId('camera-header-blind')).toBeDisabled()

  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  await page.goto('/camera')
  await expect(page.getByTestId('camera-fieldwork')).toBeVisible()
  await expect(page.locator('.shell-header')).toHaveCount(1)
  await expect(page.locator('.shell-dock')).toHaveCount(1)
  const buttons=page.getByTestId('camera-shell-actions').locator('button')
  await expect(buttons).toHaveCount(3)
  await expect(page.getByTestId('verified-plan-link')).toHaveCount(0)
  await expect(page.getByTestId('camera-mode-tabs').locator('button')).toHaveCount(3)
  await expect(page.getByTestId('camera-mode-tab-photo')).toHaveAttribute('aria-pressed','true')
  await expect(page.getByTestId('camera-viewfinder')).toBeVisible()

  // The existing mode select remains wired to the native capture pipeline.
  await page.getByTestId('camera-mode-tab-audio').click()
  await expect(page.getByTestId('camera-mode')).toHaveValue('audio')
  await expect(page.getByTestId('camera-audio-view')).toBeVisible()
  await expect(page.getByTestId('camera-header-flip')).toBeDisabled()
  await expect(page.getByTestId('camera-header-torch')).toBeDisabled()
  await page.getByTestId('camera-header-blind').click()
  await expect(page.getByTestId('camera-blind-overlay')).toBeVisible()
  await expect(page.getByTestId('camera-blind-shutter')).toBeVisible()
  await expect(page.locator('.camera-viewfinder video')).toHaveCount(1)
  await expect(page.locator('.camera-stage-controls')).not.toBeVisible()
  await page.getByRole('button',{name:'Вернуться назад'}).click()
  await expect(page.getByTestId('camera-blind-overlay')).toHaveCount(0)

  await page.getByTestId('camera-mode-tab-photo').click()
  await expect(page.getByTestId('camera-mode')).toHaveValue('photo')
  await expect(page.getByTestId('camera-header-flip')).toBeEnabled()
  await page.getByTestId('camera-open-settings').click()
  await expect(page.getByTestId('camera-settings-panel')).toBeInViewport()
  await page.getByTestId('camera-open-assignment').click()
  await expect(page.getByTestId('camera-assignment-panel')).toBeInViewport()

  // Device capture permission may fail in CI; the UI must not invent hardware.
  // Viewfinder and E2EE forms are the same mounted instance on every screen.
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:844})
    const header=page.locator('.shell-header')
    await expect(header).toHaveCSS('height','64px')
    expect(await header.evaluate(el=>el.scrollWidth>el.clientWidth),
      'Camera header overflow at '+width).toBe(false)
    await expect(page.getByTestId('camera-shell-actions').locator('button')).toHaveCount(3)
    await expect(page.locator('.camera-viewfinder video')).toHaveCount(1)
  }
})
