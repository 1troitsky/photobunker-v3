import {test,expect} from '@playwright/test'

test('Authorization Error 1.0 only appears after a proven invalid Recovery Key, never URL claims',async({page})=>{
  test.setTimeout(90000)
  await page.goto('/authorization-error?reason=deleted')
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.getByTestId('authorization-error-page')).toHaveCount(0)
  await page.getByRole('link',{name:'Восстановить аккаунт'}).click()
  await page.getByTestId('welcome-recovery-key').fill('invalid-recovery-key')
  await page.getByTestId('welcome-restore').click()
  await expect(page).toHaveURL(/\/authorization-error$/)
  await expect(page.getByTestId('authorization-error-page')).toBeVisible()
  const configuredBrand=await page.evaluate(async()=>{
    const {brand}=await import('/src/config/brand.ts')
    return brand.name
  })
  await expect(page.locator('.brand-name')).toHaveText(configuredBrand)
  await expect(page.locator('.shell-header')).toHaveCount(0)
  await expect(page.locator('.shell-dock')).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'Вход с этим ключом невозможен'})).toBeVisible()
  await expect(page.getByRole('link',{name:'На страницу приветствия'})).toHaveCount(1)
  expect(page.url()).not.toContain('invalid-recovery-key')
  await page.getByRole('link',{name:'На страницу приветствия'}).click()
  await expect(page).toHaveURL(/\/welcome$/)
  await page.goto('/authorization-error?reason=emergency')
  await expect(page).toHaveURL(/\/welcome$/)
})
