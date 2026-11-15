import {test,expect} from '@playwright/test'

test('Public Card 1.1: installation instructions stand alone, never claim an installed PWA',async({page})=>{
  await page.goto('/install')
  await expect(page.getByTestId('install-guide-page')).toBeVisible()
  await expect(page.locator('.shell-header')).toHaveCount(0)
  await expect(page.locator('.shell-dock')).toHaveCount(0)
  await expect(page.getByRole('heading',{name:/всегда под рукой$/})).toBeVisible()
  await expect(page.getByTestId('install-platform-guide')).toContainText('Safari')
  await expect(page.getByTestId('install-platform-guide')).toContainText('Открыть как веб-приложение')
  await page.getByTestId('install-android').click()
  await expect(page.getByTestId('install-platform-guide')).toContainText('Google Chrome')
  await expect(page.getByTestId('install-platform-guide')).toContainText('Добавить на главный экран')
  await page.getByTestId('install-desktop').click()
  await expect(page.getByTestId('install-platform-guide')).toContainText('адресной строке')
  await expect(page.getByText(/Подписанная офлайн-версия .* ещё не прошла/)).toBeVisible()
  await expect(page.getByText(/© 2026 /,{exact:false})).toBeVisible()
  await page.getByRole('link',{name:/Вернуться в /}).click()
  await expect(page).toHaveURL(/\/welcome$/)
})

test('Accepted Help links to the installation guide without duplicating the Shell',async({page})=>{
  await page.goto('/settings/help')
  await page.getByTestId('help-install-link').click()
  await expect(page).toHaveURL(/\/install$/)
  await expect(page.locator('.shell-header')).toHaveCount(0)
})
