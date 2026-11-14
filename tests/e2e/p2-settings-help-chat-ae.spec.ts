import { test, expect } from '@playwright/test'

test('P2 Help: signed-out RU/EN FAQ and legal drafts are honest and navigable', async ({ browser }) => {
  test.setTimeout(120000)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  try {
    await page.goto('/settings/help')
    await expect(page.getByTestId('help-shell-page')).toBeVisible()
    await expect(page.locator('.help-center h1')).toHaveText('Помощь и информация')
    await page.getByRole('button', { name: /Частые вопросы/ }).click()
    await expect(page.locator('.help-faq')).toHaveCount(15)
    await page.locator('#help-faq-query').fill('ключ')
    await expect(page.locator('.help-faq').first()).toBeVisible()
    await page.getByRole('button', { name: 'Назад' }).click()
    await page.getByRole('button', { name: /Условия использования/ }).click()
    await expect(page.locator('[data-legal-status="draft"]'))
      .toContainText('ЧЕРНОВИК · НЕ ЮРИДИЧЕСКИЙ ДОКУМЕНТ')
    await page.getByTestId('help-language-en').click()
    await expect(page.locator('.help-center h1')).toHaveText('Help and information')
    await page.getByRole('button', { name: /Privacy policy/ }).click()
    await expect(page.locator('[data-legal-status="draft"]'))
      .toContainText('DRAFT · NOT A LEGAL DOCUMENT')
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole('button', { name: 'Создать ключ' })).toBeVisible()
  } finally {
    await context.close()
  }
})

test('P2 Help: real account opens offline FAQ and support draft never submits secrets', async ({ browser }) => {
  test.setTimeout(150000)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  try {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Создать ключ' }).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button', { name: 'Завершить регистрацию' }).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await expect(page.getByTestId('settings-nav-help')).toHaveAttribute('href', '/settings/help')
    await page.getByTestId('settings-nav-help').click()
    await expect(page).toHaveURL(/\/settings\/help$/)

    // Warm offline SPA, not a claim that a signed cold-offline SW exists.
    await context.setOffline(true)
    await page.getByRole('button', { name: /Частые вопросы/ }).click()
    await page.locator('#help-faq-query').fill('ключ')
    await expect(page.locator('.help-faq').first()).toBeVisible()
    await page.getByRole('button', { name: 'Помощь' }).click()
    await expect(page.getByText('Отправка в поддержку не подключена.', { exact: false })).toBeVisible()
    await page.locator('#help-message').fill('Recovery Key: super-secret-material-here')
    await page.getByRole('button', { name: 'Подготовить текст' }).click()
    await expect(page.getByRole('alert')).toContainText('секрет')
    await expect(page.locator('.help-draft')).toHaveCount(0)
    await page.locator('#help-message')
      .fill('В приложении не открывается экран камеры после переключения режима.')
    await page.getByRole('button', { name: 'Подготовить текст' }).click()
    await expect(page.locator('.help-draft')).toContainText('Текст готов, но никуда не отправлен.')

    await page.getByRole('button', { name: 'Назад' }).click()
    await page.getByRole('button', { name: 'Назад' }).click()
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId('fieldwork-settings')).toBeVisible()
    await context.setOffline(false)
  } finally {
    await context.close()
  }
})
