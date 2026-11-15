import { test, expect } from '@playwright/test'

test('Welcome 1.4 routes anonymously, uses original six SVG slides and real key-only account',async({page})=>{
  test.setTimeout(150000)
  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.getByTestId('welcome-screen')).toBeVisible()
  const configuredBrand=await page.evaluate(async()=>{
    const {brand}=await import('/src/config/brand.ts')
    return brand.name
  })
  await expect(page.locator('.welcome-brand-name')).toHaveText(configuredBrand)
  await expect(page.locator('.carousel')).toHaveAttribute('aria-label','Почему '+configuredBrand)
  await expect(page.locator('.carousel-copy')).toContainText(configuredBrand)
  await expect(page.locator('.shell-header')).toHaveCount(0)
  await expect(page.locator('.shell-dock')).toHaveCount(0)
  await expect(page.locator('.carousel-dot')).toHaveCount(6)
  await expect(page.getByRole('link',{name:'Восстановить аккаунт'})).toBeVisible()

  await page.getByRole('link',{name:'Создать аккаунт'}).click()
  await expect(page).toHaveURL(/\/welcome\/create$/)
  await page.getByRole('button',{name:'Создать Recovery Key'}).click()
  const key=await page.getByTestId('welcome-generated-key').inputValue()
  expect(key).toMatch(/^PB2\./)
  await expect(page.getByTestId('welcome-finish')).toBeDisabled()
  await page.getByText('Я сохранил Recovery Key отдельно от устройства.').click()
  await page.getByTestId('welcome-finish').click()
  await expect(page).toHaveURL(/\/assignments$/,{timeout:30000})
  await expect(page.locator('.shell-header')).toHaveCount(1)
  await expect(page.locator('.shell-dock')).toHaveCount(1)
})
