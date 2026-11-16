import {test,expect} from '@playwright/test'

test('PIN Shell 1.1: authentic Recovery Key seals legacy device; no private UI before normal PIN',async({page})=>{
  test.setTimeout(210_000)
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  const recoveryKey=await page.locator('#generated-key').inputValue()
  expect(recoveryKey).toMatch(/^PB2\./)
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()

  await page.goto('/settings/security?field=pin')
  await expect(page.getByTestId('security-pin-create')).toBeEnabled()
  await expect(page.locator('#section-emergency').getByRole('button',{name:'Создать'}))
    .toBeDisabled()
  await page.getByTestId('security-pin-create').click()
  await expect(page.getByTestId('security-pin-dialog')).toBeVisible()
  await page.getByTestId('security-pin-new').fill('4826')
  await page.getByTestId('security-pin-repeat').fill('4826')
  await expect(page.getByTestId('security-pin-save')).toBeDisabled()
  await page.getByTestId('security-pin-recovery').fill(recoveryKey)
  await page.getByTestId('security-pin-ack').check()
  await page.getByTestId('security-pin-save').click()

  // A device seal commits atomically, then *requires* the new PIN. Neither
  // the route nor local storage may silently fall back to legacy device AES.
  await expect(page.getByRole('heading',{name:'Введите PIN'}))
    .toBeVisible({timeout:90_000})
  await expect(page.locator('.shell-header')).toHaveCount(0)
  await expect(page.locator('.shell-dock')).toHaveCount(0)
  const sealed=await page.evaluate(async()=>{
    const sess=await import('/src/features/identity/application/session.ts')
    const storage=await import('/src/features/identity/infrastructure/storage.ts')
    const pending=sess.pendingPinUnlock.value
    if(!pending)return {sealed:false,active:!!sess.activeSession.value}
    const row=await storage.getDevice(pending.accountId,pending.deviceId)
    return {
      sealed:(row?.envelope as {purpose?:string}|undefined)?.purpose==='preunlock-package',
      active:!!sess.activeSession.value,
    }
  })
  expect(sealed).toEqual({sealed:true,active:false})

  for(const digit of '0000')
    await page.getByRole('button',{name:'Цифра '+digit}).click()
  await expect(page.getByText('Неверный PIN')).toBeVisible()
  await expect(page.locator('.shell-main')).toHaveCount(0)
  for(const digit of '4826')
    await page.getByRole('button',{name:'Цифра '+digit}).click()
  await expect(page.getByTestId('security-privacy-page')).toBeVisible({timeout:40_000})
  await expect(page.locator('#section-pin').getByText('Установлен')).toBeVisible()
  await expect(page.getByTestId('security-pin-create')).toHaveCount(0)
  await expect(page.locator('#section-emergency').getByRole('button',{name:'Создать'}))
    .toBeDisabled()

  await page.reload()
  await expect(page.getByRole('heading',{name:'Введите PIN'}))
    .toBeVisible({timeout:40_000})
  await expect(page.locator('.shell-main')).toHaveCount(0)
})
