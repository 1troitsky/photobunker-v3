import { test, expect } from '@playwright/test'

test('Security & Privacy 1.3 uses approved sections and exact Settings Search anchors', async ({page}) => {
  test.setTimeout(120000)
  await page.goto('/settings')
  await page.getByRole('button', {name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button', {name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()

  await page.goto('/settings/security?field=pin')
  await expect(page.getByTestId('security-privacy-page')).toBeVisible()
  await expect(page.locator('#section-pin')).toBeVisible()
  await expect(page.locator('#section-emergency')).toBeVisible()
  await expect(page.locator('#section-devices')).toBeVisible()
  await expect(page.locator('#section-inactivity')).toBeVisible()
  await expect(page.getByRole('heading', {name:'PIN входа'})).toBeVisible()
  await expect(page.getByRole('heading', {name:'PIN экстренного удаления данных'})).toBeVisible()
  await expect(page.getByRole('heading', {name:'Dead Man’s Switch'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Создать'}).first()).toBeDisabled()
  await expect(page.locator('#inactivity-select')).toBeDisabled()
  await expect(page.getByRole('button',{name:'Сменить ключ'})).toBeDisabled()

  // The real server's GET /identity/v2/devices is used, not invented display rows.
  await page.getByRole('button',{name:'Обновить устройства'}).click()
  await expect(page.getByTestId('account-device').first()).toBeVisible()

  await page.goto('/settings/search?q=recovery')
  await expect(page.getByTestId('settings-search-result-recovery')).toBeVisible()
  await page.getByTestId('settings-search-result-recovery').click()
  await expect(page).toHaveURL(/\/settings\/security\?field=key/)
  await expect(page.locator('#setting-key')).toBeVisible()
})
