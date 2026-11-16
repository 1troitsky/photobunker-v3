import {test,expect} from '@playwright/test'

test('Public Card 1.1 stays anonymous while private device is PIN locked',async({page})=>{
  await page.goto('/p/not-a-published-card')
  await expect(page.getByTestId('public-card-unavailable')).toBeVisible()
  await expect(page.getByRole('heading',{name:'Карточка недоступна'}))
    .toBeVisible()
  await expect(page.locator('.shell-header')).toHaveCount(0)
  await expect(page.locator('.shell-dock')).toHaveCount(0)
  await expect(page.locator('.pin-screen')).toHaveCount(0)
  // An anonymous external card MUST NOT decrypt a saved Identity device.
  expect(await page.evaluate(async()=>{
    const identity=await import('/src/features/identity/application/session.ts')
    return {started:identity.identityBootstrapReady.value,
      session:identity.activeSession.value}
  })).toEqual({started:false,session:null})

  // Simulate a separately PIN-sealed browser's local
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
  // This disposable browser has no genuinely persisted sealed device.
  // Switching to a private route now starts a real Identity bootstrap
  // rather than trusting the synthetic PIN placeholder above.
  await expect(page.getByTestId('welcome-screen')).toBeVisible()
  await expect(page.getByRole('link',{name:'Создать аккаунт'}))
    .toBeVisible({timeout:30000})
  await expect(page.locator('.shell-main')).toHaveCount(0)
})
