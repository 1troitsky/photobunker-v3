import {test,expect} from '@playwright/test'

test('Settings can finish interrupted key-only registration using the original saved Recovery Key',async({page})=>{
  test.setTimeout(120000)
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  const savedKey=await page.locator('#generated-key').inputValue()
  expect(savedKey.length).toBeGreaterThan(20)
  // The user consciously leaves the unfinished view; router guard must
  // warn, and a fresh Settings mount must recover the pending reservation.
  page.once('dialog',async dialog=>{
    expect(dialog.type()).toBe('confirm')
    await dialog.accept()
  })
  await page.getByRole('link',{name:/Welcome/}).click()
  await expect(page).toHaveURL(/\/welcome$/)
  await page.goto('/settings')
  await expect(page.getByTestId('account-pending-registration')).toBeVisible()
  await expect(page.getByRole('button',{name:'Создать ключ'})).toBeDisabled()
  await page.locator('#pending-registration-key').fill(savedKey)
  await page.getByTestId('account-resume-registration').click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  await expect(page.getByTestId('account-pending-registration')).toHaveCount(0)
  await expect(page.getByText('Незавершённая регистрация успешно завершена.'))
    .toBeVisible()
})
