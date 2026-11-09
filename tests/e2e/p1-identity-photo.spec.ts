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

    // The app shell is already loaded. Capture and navigate while the network
    // is genuinely unavailable. There is no Service Worker yet, so this tests
    // local-first interactions, not an unsupported cold offline page reload.
    await first.setOffline(true)
    await deviceA.getByRole('link',{name:'Камера',exact:true}).click()
    await expect(deviceA.locator('video')).toBeVisible()
    await expect.poll(()=>deviceA.locator('video').evaluate(el=>(el as HTMLVideoElement).videoWidth))
      .toBeGreaterThan(0)
    await deviceA.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(deviceA.getByText(/Зашифровано и сохранено локально/)).toBeVisible()
    await deviceA.getByRole('link',{name:'Browser',exact:true}).click()
    await expect(deviceA.locator('.photo-row').first()).toContainText('queued')
    await first.setOffline(false)
    await deviceA.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(deviceA.locator('.photo-row').first()).toContainText('synced',{timeout:30000})

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


test('P1-03: signed recipient key, manual fingerprint, E2EE grant and revoke',async({browser})=>{
  const recipientContext=await browser.newContext()
  const ownerContext=await browser.newContext({permissions:['camera']})
  const outsiderContext=await browser.newContext()
  const recipient=await recipientContext.newPage()
  const owner=await ownerContext.newPage()
  const outsider=await outsiderContext.newPage()

  async function enroll(page:typeof recipient):Promise<string>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await expect(page.locator('#generated-key')).toHaveValue(/^PB2\./)
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    const uuid=(await page.locator('.foundation-card code').first().textContent())?.trim()
    expect(uuid).toMatch(/^[a-f0-9-]{36}$/)
    await page.goto('/browser')
    await expect(page.getByText('Ключ обмена подготовлен')).toBeVisible({timeout:20000})
    return uuid!
  }

  try{
    const recipientId=await enroll(recipient)
    const ownerId=await enroll(owner)

    await owner.getByRole('navigation',{name:'Главная навигация'}).getByRole('link',{name:'Камера',exact:true}).click()
    await expect.poll(()=>owner.locator('video').evaluate(el=>(el as HTMLVideoElement).videoWidth))
      .toBeGreaterThan(0)
    await owner.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(owner.getByText(/Зашифровано и сохранено локально/)).toBeVisible()
    await owner.getByRole('link',{name:'Browser',exact:true}).click()
    await owner.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(owner.locator('.photo-row').first()).toContainText('synced',{timeout:30000})

    // First-contact safety verification is explicit; there is no silent TOFU.
    await owner.locator('#recipient-account-id').fill(recipientId)
    await owner.getByRole('button',{name:'Проверить ключ'}).click()
    await expect(owner.getByText('Отпечаток получателя')).toBeVisible()
    await owner.getByLabel('Я сверил отпечаток получателя').check()
    await owner.getByRole('button',{name:'Подтвердить отпечаток',exact:true}).click()
    await expect(owner.getByText('Ключ получателя подтверждён')).toBeVisible()
    await owner.getByRole('button',{name:'Передать',exact:true}).first().click()
    await expect(owner.getByText(/ · sent/).first()).toBeVisible({timeout:30000})

    await recipient.getByRole('button',{name:'Обновить полученные'}).click()
    await expect(recipient.getByRole('button',{name:'Ключ отправителя'})).toBeVisible()
    await recipient.getByRole('button',{name:'Ключ отправителя'}).click()
    await expect(recipient.getByText('Отпечаток отправителя')).toBeVisible()
    await recipient.getByLabel('Я сверил отпечаток отправителя').check()
    await recipient.getByRole('button',{name:'Подтвердить отправителя'}).click()
    await recipient.getByRole('button',{name:'Открыть полученное'}).click()
    const decrypted=recipient.locator('img.decrypted-preview')
    await expect(decrypted).toBeVisible()
    await expect.poll(()=>decrypted.evaluate(el=>(el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)

    const grantId=await recipient.evaluate(async()=>{
      const response=await fetch('/shares/v1/received',{credentials:'same-origin'})
      if(!response.ok)throw Error('grant list unavailable')
      const data=await response.json() as {items:Array<{grantId:string}>}
      return data.items[0]?.grantId
    })
    expect(grantId).toMatch(/^[a-f0-9-]{36}$/)

    await enroll(outsider)
    const outsiderStatus=await outsider.evaluate(async(id)=>
      (await fetch('/shares/v1/grants/'+id,{credentials:'same-origin'})).status,grantId)
    expect(outsiderStatus).toBe(404)

    await owner.getByRole('button',{name:'Отозвать'}).click()
    await expect(owner.getByText('Дальнейшее серверное чтение отозвано')).toBeVisible()
    const denied=await recipient.evaluate(async(id)=>
      (await fetch('/shares/v1/grants/'+id,{credentials:'same-origin'})).status,grantId)
    expect(denied).toBe(410)
    // The existing decrypted copy is not retroactively erased.
    await expect(decrypted).toBeVisible()
    // Do not log or expose Recovery Keys, raw DEKs, or S3 access secrets.
    void ownerId
  }finally{
    await recipientContext.close()
    await ownerContext.close()
    await outsiderContext.close()
  }
})
