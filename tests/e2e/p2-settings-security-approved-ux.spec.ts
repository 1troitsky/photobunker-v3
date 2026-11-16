import { test, expect } from '@playwright/test'

test('Security & Privacy 1.3 uses approved sections and exact Settings Search anchors', async ({page}) => {
  test.setTimeout(120000)
  await page.goto('/settings')
  await page.getByRole('button', {name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button', {name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()

  await page.goto('/settings/security?field=pin')
  await expect(page.getByTestId('security-privacy-page')).toBeVisible()
  await expect(page.locator('#section-pin')).toBeVisible()
  await expect(page.locator('#section-emergency')).toBeVisible()
  await expect(page.locator('#section-devices')).toBeVisible()
  await expect(page.locator('#section-inactivity')).toBeVisible()
  await expect(page.getByRole('heading', {name:'PIN входа'})).toBeVisible()
  await expect(page.getByRole('heading', {name:'PIN экстренного удаления данных'})).toBeVisible()
  await expect(page.getByRole('heading', {name:'Dead Man’s Switch'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Создать'}).first()).toBeDisabled()
  await expect(page.locator('#inactivity-select')).toBeDisabled()
  await expect(page.getByRole('button',{name:'Сменить ключ'})).toBeDisabled()

  // The real server's GET /identity/v2/devices is used, not invented display rows.
  await page.getByRole('button',{name:'Обновить устройства'}).click()
  await expect(page.getByTestId('account-device').first()).toBeVisible()

  await page.goto('/settings/search?q=recovery')
  await expect(page.getByTestId('settings-search-result-recovery')).toBeVisible()
  await page.getByTestId('settings-search-result-recovery').click()
  await expect(page).toHaveURL(/\/settings\/security\?field=key/)
  await expect(page.locator('#setting-key')).toBeVisible()
})


test('Security devices: offline transition clears a pending server spinner and rejects stale device rows',async({page})=>{
  test.setTimeout(120000)
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()

  let unblock:undefined|(()=>Promise<void>)
  let seenRequest=false
  await page.route('**/identity/v2/devices',async route=>{
    seenRequest=true
    await new Promise<void>(resolve=>{
      let fulfilled=false
      unblock=async()=>{
        if(fulfilled)return
        fulfilled=true
        await route.fulfill({
          status:200,contentType:'application/json',
          body:JSON.stringify({devices:[{
            id:'STALE_DEVICE_DO_NOT_RENDER',
            created_at:'2026-01-01T00:00:00Z',revoked_at:null,
          }]}),
        })
        resolve()
      }
    })
  })
  try{
    await page.goto('/settings/security')
    await expect(page.getByText('Загружаем устройства с сервера…')).toBeVisible()
    expect(seenRequest).toBe(true)

    // A real Vue identity transition while the HTTP response is delayed.
    // No fake authenticated device result may survive the offline boundary.
    await page.evaluate(async()=>{
      const {activeSession}=await import('/src/features/identity/application/session.ts')
      if(!activeSession.value)throw Error('test.session_missing')
      activeSession.value={...activeSession.value,online:false}
    })
    await expect(page.getByText('Загружаем устройства с сервера…')).toHaveCount(0)
    await expect(page.getByText('Список устройств не подтверждён. Не показываем вымышленные данные.'))
      .toBeVisible()
    await unblock?.()
    await expect(page.getByTestId('account-device')).toHaveCount(0)
    await expect(page.getByText('STALE_DEVICE_DO_NOT_RENDER')).toHaveCount(0)
  }finally{
    await unblock?.()
    await page.unroute('**/identity/v2/devices')
  }
})
