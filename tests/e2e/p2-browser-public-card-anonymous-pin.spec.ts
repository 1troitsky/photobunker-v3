import {test,expect} from '@playwright/test'

test('Public Card 1.1 stays anonymous while private device is PIN locked',async({page})=>{
  await page.goto('/p/not-a-published-card')
  await expect(page.getByTestId('public-card-unavailable')).toBeVisible()
  await expect(page.getByRole('heading',{name:'Карточка недоступна'}))
    .toBeVisible()
  await expect(page.locator('.shell-header')).toHaveCount(0)
  await expect(page.locator('.shell-dock')).toHaveCount(0)
  await expect(page.locator('.pin-screen')).toHaveCount(0)

  // Simulate an authenticated, separately PIN-sealed browser's local
  // identity state. The public route must not expose or request these keys.
  await page.evaluate(async()=>{
    const identity=await import('/src/features/identity/application/session.ts')
    identity.activeSession.value=null
    identity.pendingPinUnlock.value={
      accountId:'00000000-0000-4000-8000-000000000001',
      deviceId:'00000000-0000-4000-8000-000000000002',
      packageRevision:1,pinLength:4,
      sessionNonce:'00000000-0000-4000-8000-000000000003',
    }
    identity.identityBootstrapReady.value=true
  })
  await expect(page.getByTestId('public-card-unavailable')).toBeVisible()
  await expect(page.locator('.pin-screen')).toHaveCount(0)
  await expect(page.locator('.shell-main')).toHaveCount(0)

  // The install instructions are also public. Neither route may fall back
  // to a privileged app shell or require a normal/eEmergency PIN.
  await page.getByTestId('public-card-install').click()
  await expect(page).toHaveURL(/\/install$/)
  await expect(page.locator('.pin-screen')).toHaveCount(0)
  await expect(page.locator('.shell-header')).toHaveCount(0)

  await page.goBack()
  await expect(page.getByTestId('public-card-unavailable')).toBeVisible()
  await page.getByRole('link',{name:/главная/}).click()
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.getByRole('heading',{name:'Введите PIN'})).toBeVisible()
  await expect(page.locator('.shell-main')).toHaveCount(0)
})
