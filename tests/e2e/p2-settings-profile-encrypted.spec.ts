import {test,expect} from '@playwright/test'

test('P2 profile: real Key-Only identity, AES-GCM local profile, reload and no plaintext IndexedDB', async({page})=>{
  test.setTimeout(140000)
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  await page.getByTestId('settings-nav-profile-edit').click()
  await expect(page).toHaveURL(/\/settings\/profile\/edit$/)
  await expect(page.locator('.form-card')).toHaveCount(2)
  await expect(page.locator('.form-card').first()).toBeVisible()
  await page.getByTestId('profile-name').fill('PRIVATE PROFILE ALIAS')
  await page.getByTestId('profile-username').fill('alias-123')
  await page.getByTestId('profile-about').fill('SECRET_PROFILE_ABOUT_TEST')
  await page.getByTestId('profile-card-visibility').selectOption('contacts')
  await page.getByTestId('profile-save').click()
  await expect(page).toHaveURL(/\/settings\/profile$/)
  await expect(page.locator('.profile-top-clean')).toBeVisible()
  await expect(page.locator('.profile-content-block.about-block')).toBeVisible()
  await expect(page.getByText('PRIVATE PROFILE ALIAS')).toBeVisible()
  await expect(page.getByText('SECRET_PROFILE_ABOUT_TEST')).toBeVisible()
  const record=await page.evaluate(async()=>{
    return new Promise<string>((resolve,reject)=>{
      const open=indexedDB.open('pb3-encrypted-profile-v1')
      open.onerror=()=>reject(open.error)
      open.onsuccess=()=>{
        const db=open.result,tx=db.transaction('profiles','readonly')
        const result=tx.objectStore('profiles').getAll()
        result.onerror=()=>reject(result.error)
        tx.oncomplete=()=>{resolve(JSON.stringify(result.result));db.close()}
      }
    })
  })
  for(const plaintext of ['PRIVATE PROFILE ALIAS','SECRET_PROFILE_ABOUT_TEST','alias-123','cardVisibility'])
    expect(record).not.toContain(plaintext)
  await page.reload()
  await expect(page.getByText('PRIVATE PROFILE ALIAS')).toBeVisible({timeout:30000})
  await page.goto('/settings')
  await page.getByTestId('settings-own-profile').click()
  await expect(page.getByText('SECRET_PROFILE_ABOUT_TEST')).toBeVisible()
})
