import { test, expect } from '@playwright/test'

test('two browser identities: key-only account, encrypted camera photo, Garage recovery', async ({browser}) => {
  const first = await browser.newContext({permissions:['camera']})
  const deviceA = await first.newPage()
  const second = await browser.newContext()
  const deviceB = await second.newPage()
  try {
    await deviceA.goto('/settings')
    await deviceA.getByRole('button',{name:'Создать ключ'}).click()
    const keyField = deviceA.locator('#generated-key')
    await expect(keyField).toHaveValue(/^PB2\./)
    const recoveryKey=await keyField.inputValue()
    expect(recoveryKey.length).toBeGreaterThan(40)
    await deviceA.getByLabel('Я сохранил ключ восстановления').check()
    await deviceA.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(deviceA.getByText('Подтверждённая сессия')).toBeVisible()

    await deviceA.goto('/camera')
    await expect(deviceA.locator('video')).toBeVisible()
    await expect.poll(()=>deviceA.locator('video').evaluate(el=>(el as HTMLVideoElement).videoWidth))
      .toBeGreaterThan(0)
    await deviceA.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(deviceA.getByText(/Зашифровано и сохранено локально/)).toBeVisible()
    await deviceA.goto('/browser')
    await expect(deviceA.locator('.photo-row').first()).toBeVisible()
    await deviceA.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(deviceA.getByText('synced', {exact:false}).first()).toBeVisible({timeout:30000})

    // Retrieve the opaque ID through the genuine authenticated endpoint.
    const photoId=await deviceA.evaluate(async()=>{
      const response=await fetch('/photos/v1',{credentials:'same-origin',cache:'no-store'})
      if(!response.ok)throw new Error('cloud.list_unavailable')
      const body=await response.json() as {items:Array<{photoId:string}>}
      return body.items[0]?.photoId
    })
    expect(photoId).toMatch(/^[a-f0-9-]{36}$/)

    // New browser profile has independent IndexedDB and browser session.
    await deviceB.goto('/settings')
    await deviceB.locator('#recovery-key').fill(recoveryKey)
    await deviceB.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(deviceB.getByText('Подтверждённая сессия')).toBeVisible()
    await deviceB.goto('/browser')
    await expect(deviceB.getByRole('button',{name:'Проверить из облака'}).first()).toBeVisible()
    await deviceB.getByRole('button',{name:'Проверить из облака'}).first().click()
    const image=deviceB.locator('img.decrypted-preview')
    await expect(image).toBeVisible()
    await expect.poll(()=>image.evaluate(el=>(el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)

    // Confirm repeated reload never needs the Recovery Key again on a trusted device.
    await deviceB.reload()
    await expect(deviceB.getByRole('button',{name:'Проверить из облака'}).first()).toBeVisible()

    // A new unrelated anonymous account has no access to the first account's media.
    const third=await browser.newContext()
    const outsider=await third.newPage()
    try {
      await outsider.goto('/settings')
      await outsider.getByRole('button',{name:'Создать ключ'}).click()
      const otherKey=await outsider.locator('#generated-key').inputValue()
      await outsider.getByLabel('Я сохранил ключ восстановления').check()
      await outsider.getByRole('button',{name:'Завершить регистрацию'}).click()
      await expect(outsider.getByText('Подтверждённая сессия')).toBeVisible()
      const status=await outsider.evaluate(async id=>
        (await fetch('/photos/v1/'+encodeURIComponent(id)+'/receipt',{credentials:'same-origin'})).status,
      photoId)
      expect(status).toBe(404)
      // No recovery key or other sensitive material is printed in diagnostics.
      void otherKey
    }finally { await third.close() }
  } finally {
    await first.close()
    await second.close()
  }
})
