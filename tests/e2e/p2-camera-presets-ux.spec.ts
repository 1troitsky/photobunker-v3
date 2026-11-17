import {test,expect} from '@playwright/test'

test('Camera Fieldwork 1.2: encrypted device preset with real photo, video and audio options survives reload',async({page})=>{
  test.setTimeout(100000)
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.locator('[data-testid="shell-status-link"][data-session-state="online"]')).toBeVisible()
  await page.goto('/camera')
  await expect(page.getByTestId('camera-fieldwork')).toBeVisible()
  await page.getByTestId('camera-open-settings').click()
  const sheet=page.getByTestId('camera-settings-panel')
  await expect(sheet).toHaveCSS('position','fixed')
  await expect(page.getByTestId('camera-preset-select')).toHaveAttribute('data-selected-preset','default')
  await expect(page.getByTestId('camera-viewfinder')).toHaveCSS('aspect-ratio','4 / 3')
  await page.getByTestId('camera-photo-aspect').selectOption('1:1')
  await expect(page.getByTestId('camera-viewfinder')).toHaveCSS('aspect-ratio','1 / 1')
  await page.getByTestId('camera-photo-quality').selectOption('maximum')
  await page.getByTestId('camera-video-quality').selectOption('1080p')
  await page.getByTestId('camera-audio-bitrate').selectOption('192000')
  await page.getByTestId('camera-video-audio').uncheck()
  await page.getByTestId('camera-grid-setting').check()
  await page.getByTestId('camera-gps-visibility').uncheck()
  // Native input is range; emit the same input event a real slider generates.
  for(const [id,value] of [['camera-video-duration','90'],
    ['camera-audio-duration','600']] as const){
    await page.getByTestId(id).evaluate((node,desired)=>{
      const input=node as HTMLInputElement
      const set=Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,'value')!.set!
      set.call(input,desired)
      input.dispatchEvent(new Event('input',{bubbles:true}))
      input.dispatchEvent(new Event('change',{bubbles:true}))
    },value)
  }
  await page.getByTestId('camera-preset-name').fill('Private Fieldwork')
  await page.getByTestId('camera-preset-add').click()
  await expect(page.getByTestId('camera-preset-status'))
    .toContainText('Пресет зашифрован')
  const savedId=await page.getByTestId('camera-preset-select').getAttribute('data-selected-preset')
  expect(savedId).toMatch(/^custom-/)
  await page.getByTestId('camera-sheet-close').click()
  await expect(page.getByTestId('camera-grid')).toBeVisible()
  await expect(page.getByTestId('camera-gps-indicator')).toHaveCount(0)

  // Page reload may use the already installed encrypted cache. No fake
  // cloud save or plaintext localStorage is needed for the device preset.
  await page.reload()
  await expect(page.getByTestId('camera-fieldwork')).toBeVisible()
  await page.getByTestId('camera-open-settings').click()
  await expect(page.getByTestId('camera-preset-select')).toHaveAttribute('data-selected-preset',savedId!)
  await expect(page.getByTestId('camera-preset-name')).toHaveValue('Private Fieldwork')
  await expect(page.getByTestId('camera-photo-aspect')).toHaveValue('1:1')
  await expect(page.getByTestId('camera-viewfinder')).toHaveCSS('aspect-ratio','1 / 1')
  await expect(page.getByTestId('camera-photo-quality')).toHaveValue('maximum')
  await expect(page.getByTestId('camera-video-quality')).toHaveValue('1080p')
  await expect(page.getByTestId('camera-audio-bitrate')).toHaveValue('192000')
  await expect(page.getByTestId('camera-video-audio')).not.toBeChecked()
  await expect(page.getByTestId('camera-video-duration')).toHaveValue('90')
  await expect(page.getByTestId('camera-audio-duration')).toHaveValue('600')
  await expect(page.getByTestId('camera-grid-setting')).toBeChecked()
  await expect(page.getByTestId('camera-gps-visibility')).not.toBeChecked()

  await page.getByTestId('camera-preset-add').click()
  await expect(page.getByTestId('camera-preset-status')).toHaveText(
    'camera.preset_duplicate')
  // Confirm no named secret or full preset entered browser localStorage.
  expect(await page.evaluate(()=>Object.values(localStorage)
    .some(x=>x.includes('Private Fieldwork')))).toBe(false)
})
