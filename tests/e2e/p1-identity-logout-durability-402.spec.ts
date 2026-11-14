import { test, expect } from '@playwright/test'

async function registerDevice(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Создать ключ' }).click()
  await expect(page.locator('#generated-key')).toHaveValue(/^PB2\./)
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button', { name: 'Завершить регистрацию' }).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
}

test('P1 #402: logout survives aborted IndexedDB transaction and immediate hard reload', async ({ browser }) => {
  test.setTimeout(120000)
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await registerDevice(page)

    // Inject genuine browser storage unavailability AFTER actual registration.
    // This is a negative test: the IDB logout receipt is deliberately absent.
    // A fast reload must not resurrect the previously saved device/key.
    await page.evaluate(() => {
      Object.defineProperty(indexedDB, 'open', {
        configurable: true,
        value: () => { throw new Error('test.injected_identity_idb_unavailable') },
      })
    })
    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect(page.getByRole('button', { name: 'Создать ключ' })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('test.injected_identity_idb_unavailable')
    expect(await page.evaluate(() =>
      localStorage.getItem('pb3.identity.logout-fence.v1') === '1')).toBe(true)

    await page.reload() // Restore real IndexedDB in the new JS realm.
    await expect(page.getByRole('button', { name: 'Создать ключ' })).toBeVisible()
    await expect(page.getByTestId('fieldwork-settings')).toHaveCount(0)
    const accessDenied = await page.evaluate(async () => {
      const { activeSession, resumeExistingDevice, requireSession } =
        await import('/src/features/identity/application/session.ts')
      await resumeExistingDevice()
      try { requireSession(); return false }
      catch { return activeSession.value === null }
    })
    expect(accessDenied).toBe(true)
  } finally { await context.close() }
})

test('P1 #402: committed local logout remains fenced across tabs and reload despite network outage', async ({ browser }) => {
  test.setTimeout(120000)
  const context = await browser.newContext()
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  try {
    await registerDevice(pageA)
    await pageB.goto('/settings')
    // Genuine same-device unseal & signed reproof before the concurrent logout.
    await expect(pageB.getByText('Подтверждённая сессия')).toBeVisible()
    await expect(pageB.getByTestId('fieldwork-settings')).toBeVisible()

    await pageA.route('**/identity/v2/logout', async route => { await route.abort() })
    await pageA.getByRole('button', { name: 'Выйти' }).click()
    // Server logout outage does not undo durable local signout.
    await expect(pageA.getByRole('button', { name: 'Создать ключ' })).toBeEnabled()
    await expect(pageB.getByRole('button', { name: 'Создать ключ' })).toBeVisible()
    await pageB.reload()
    await expect(pageB.getByRole('button', { name: 'Создать ключ' })).toBeVisible()
    await expect(pageB.getByTestId('fieldwork-settings')).toHaveCount(0)
    expect(await pageA.evaluate(() =>
      localStorage.getItem('pb3.identity.logout-fence.v1') === '1')).toBe(true)
  } finally { await context.close() }
})
