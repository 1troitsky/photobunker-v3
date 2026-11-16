import { test, expect } from '@playwright/test'

test('P2+P3: one Key-Only account keeps verified Free status across Contacts and Notifications', async ({ browser }) => {
  test.setTimeout(160000)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  const dock = page.getByRole('navigation', { name: 'Главная навигация' })
  try {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Создать ключ' }).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button', { name: 'Завершить регистрацию' }).click()
    await expect(page.locator('[data-testid="shell-status-link"][data-session-state="online"]')).toBeVisible()

    // Real server entitlement: a newly created account starts Free.
    // No quote or local cache is allowed to simulate a paid plan.
    await expect(page.getByTestId('billing-grace-panel')).toBeVisible()
    await expect(page.getByTestId('billing-grace-verified')).toContainText('План: free', { timeout: 30000 })
    await expect(page.getByTestId('billing-grace-verified'))
      .toContainText('Бесплатный тариф без срока окончания оплаты.')
    await expect(page.getByTestId('billing-grace-as-of')).toBeVisible()

    // Navigate through the actual P2 Settings → Notifications route.
    await page.getByTestId('settings-nav-notifications').click()
    await expect(page).toHaveURL(/\/notifications$/)
    await expect(page.getByTestId('notifications-page')).toBeVisible()
    await expect(page.getByTestId('notifications-signed-out')).toHaveCount(0)

    await dock.getByRole('link', { name: 'Настройки' }).click()
    await expect(page.getByTestId('fieldwork-settings')).toBeVisible()
    await expect(page.getByTestId('billing-grace-verified')).toContainText('План: free', { timeout: 30000 })

    // Locally encrypted Contacts blacklist is reachable from the same account.
    await page.getByTestId('settings-nav-contacts-teams').click()
    await expect(page).toHaveURL(/\/contacts$/)
    await expect(page.getByTestId('contacts-blacklist-toggle')).toBeEnabled()

    // Return via Shell, request fresh server validation, never invent payment.
    await dock.getByRole('link', { name: 'Настройки' }).click()
    await expect(page.getByTestId('billing-grace-refresh')).toBeEnabled()
    await page.getByTestId('billing-grace-refresh').click()
    await expect(page.getByTestId('billing-grace-verified')).toContainText('План: free', { timeout: 30000 })
    await expect(page.getByTestId('billing-grace-as-of')).toBeVisible()
  } finally {
    await context.close()
  }
})
