import { test, expect } from '@playwright/test'

test('Payments & Tariffs Fieldwork 1.1 uses live plan catalog and never fabricates paid orders', async ({page})=>{
  test.setTimeout(110000)
  await page.goto('/settings/payments')
  await expect(page.getByTestId('payments-page')).toBeVisible()
  await expect(page.getByTestId('billing-current')).toBeVisible()
  // Unauthenticated sessions must not show false active paid plans.
  await expect(page.getByText('Текущий тариф',{exact:true})).toBeVisible()
  // A real server catalog must be verified before selection is actionable.
  // Fail promptly on a missing/malformed catalog rather than spending 110s on a disabled button.
  await expect(page.getByRole('button',{name:'Сравнить тарифы'})).toBeEnabled({timeout:15000})
  await page.getByRole('button',{name:'Сравнить тарифы'}).click()
  await expect(page.getByTestId('billing-tier-free')).toBeVisible()
  await expect(page.getByTestId('billing-tier-go')).toBeVisible()
  await expect(page.getByTestId('billing-tier-pro')).toBeVisible()
  await expect(page.getByTestId('billing-tier-unlimited')).toBeVisible()
  await expect(page.getByTestId('billing-tier-unlimited_plus')).toBeVisible()
  await page.getByRole('button',{name:'12 месяцев · выгоднее'}).click()
  await page.getByTestId('billing-tier-pro').getByRole('button',{name:'Выбрать Pro'}).click()
  await expect(page.getByText('Предварительный расчёт — не счёт')).toBeVisible()
  await expect(page.getByRole('button',{name:'Перейти к оплате'})).toBeDisabled()
  await page.getByRole('button',{name:'‹ К тарифам'}).click()
  await page.getByRole('button',{name:'История платежей'}).click()
  await expect(page.getByText('Нет проверенных записей для отображения.')).toBeVisible()
})
