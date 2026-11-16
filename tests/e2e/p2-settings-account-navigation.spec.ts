import {test,expect} from '@playwright/test'

test('P2: Security / Billing / Profile routes live inside one Fieldwork Shell without fake success',async({page})=>{
  await page.goto('/settings')
  // Account-scoped rows need key-only identity; the direct routes must still load safely signed out.
  for(const route of ['/settings/profile','/settings/profile/edit','/settings/security','/settings/payments']){
    await page.goto(route)
    await expect(page.locator('.shell-header')).toHaveCount(1)
    await expect(page.locator('.shell-dock')).toHaveCount(1)
  }
  await expect(page.getByTestId('payments-page')).toBeVisible()
  await expect(page.getByText('Вымышленные операции не показываются.',{exact:false})).toHaveCount(0)
  await page.goto('/settings/security')
  await expect(page.getByTestId('security-privacy-page')).toBeVisible()
  await expect(page).not.toHaveURL(/\/assignments$/)
  await page.goto('/settings/profile')
  await expect(page.getByTestId('profile-page')).toBeVisible()
})
