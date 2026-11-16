import { test, expect } from '@playwright/test'

test('UX: settings hub provides real Contacts route without breaking Key-Only Identity', async ({browser}) => {
  test.setTimeout(120000)
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto('/settings')
    // No session: recovery/create remain exactly as before, with no fake profile.
    await expect(page.getByRole('button', {name:'Создать ключ'})).toBeVisible()
    await expect(page.getByTestId('fieldwork-settings')).toHaveCount(0)
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await expect(page.locator('#generated-key')).toHaveValue(/^PB2\./)
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.locator('[data-testid="shell-status-link"][data-session-state="online"]')).toBeVisible()

    await expect(page.getByTestId('fieldwork-settings')).toBeVisible()
    await expect(page.getByRole('heading',{name:'Настройки',exact:true})).toBeVisible()
    const contacts = page.getByTestId('settings-nav-contacts-teams')
    await expect(contacts).toHaveAttribute('href','/contacts')
    await expect(page.getByTestId('settings-nav-profile-card')).toHaveAttribute('href','/settings/profile')
    await expect(page.getByTestId('settings-nav-appearance'))
      .toHaveAttribute('href','/settings/appearance')
    await expect(page.getByTestId('settings-nav-security-privacy')).toHaveAttribute('href','/settings/security')
    await expect(page.getByTestId('settings-nav-data-storage'))
      .toHaveAttribute('href','/settings/storage')

    await contacts.click()
    await expect(page).toHaveURL(/\/contacts$/)
    await expect(page.getByTestId('contacts-teams')).toBeVisible()
    await page.getByRole('navigation',{name:'Главная навигация'})
      .getByRole('link',{name:'Профиль / Настройки',exact:true}).click()
    await expect(page.getByTestId('fieldwork-settings')).toBeVisible()
    await expect(page.getByRole('button',{name:'Проверить сессию'})).toBeVisible()
    await expect(page.getByRole('button',{name:'Выйти'})).toBeEnabled()

    await page.getByRole('button',{name:'Выйти'}).click()
    await expect(page.getByRole('button',{name:'Создать ключ'})).toBeVisible()
    await expect(page.getByTestId('fieldwork-settings')).toHaveCount(0)
  } finally { await context.close() }
})
