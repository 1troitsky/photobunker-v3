import { test, expect } from '@playwright/test'

test('P1-25: verified peer → encrypted Contacts & Teams → offline persistence → local removal',async({browser})=>{
  test.setTimeout(150000)
  const contextA=await browser.newContext()
  const contextB=await browser.newContext()
  const A=await contextA.newPage(),B=await contextB.newPage()
  async function enroll(page:typeof A):Promise<string>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    return page.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      return identity.requireSession().accountId
    })
  }
  try{
    await enroll(A)
    const recipientId=await enroll(B)
    await B.goto('/browser')
    await expect(B.getByText('Ключ обмена подготовлен'))
      .toBeVisible({timeout:20000})
    await A.goto('/contacts')
    await expect(A.getByTestId('contacts-teams')).toBeVisible()
    await expect(A.getByRole('heading',{name:'Контакты и Команды'})).toBeVisible()
    await expect(A.getByTestId('contacts-blacklist-toggle')).toBeEnabled()
    await A.getByRole('button',{name:/^Команды \(/}).click()
    await expect(A.getByRole('button',{name:'Создать команду'})).toBeEnabled()
    await A.getByRole('button',{name:/Контакты \(/}).click()

    await A.getByTestId('contacts-lookup-id').fill(recipientId)
    await A.getByRole('button',{name:'Проверить ключ'}).click()
    await expect(A.getByTestId('contacts-fingerprint')).toBeVisible()
    await expect(A.getByRole('button',{name:'Добавить в контакты'})).toHaveCount(0)
    await A.getByTestId('contacts-fingerprint-ack').check()
    await A.getByRole('button',{name:'Подтвердить отпечаток'}).click()
    await expect(A.getByText('Ключ подтверждён на этом устройстве.')).toBeVisible()
    await A.getByTestId('contacts-alias').fill('ENCRYPTED LOCAL NICKNAME')
    await A.getByRole('button',{name:'Добавить в контакты'}).click()
    await expect(A.getByTestId('contacts-row-'+recipientId))
      .toContainText('ENCRYPTED LOCAL NICKNAME')
    // Never send the local alias/contact-graph plaintext to a server or
    // store peer IDs, nicknames, fingerprints as cleartext in IndexedDB.
    const encrypted=await A.evaluate(async()=>{
      return new Promise<{count:number;raw:string}>((resolve,reject)=>{
        const request=indexedDB.open('pb3-encrypted-contacts-v1')
        request.onerror=()=>reject(request.error)
        request.onsuccess=()=>{
          const db=request.result
          const tx=db.transaction('contacts','readonly')
          const get=tx.objectStore('contacts').getAll()
          get.onerror=()=>reject(get.error)
          get.onsuccess=()=>resolve({
            count:get.result.length,raw:JSON.stringify(get.result),
          })
          tx.oncomplete=()=>db.close()
        }
      })
    })
    expect(encrypted.count).toBe(1)
    expect(encrypted.raw).not.toContain('ENCRYPTED LOCAL NICKNAME')
    expect(encrypted.raw).not.toContain(recipientId)

    await B.goto('/contacts')
    await expect(B.getByTestId('contacts-teams')).toBeVisible()
    await expect(B.getByText('Контактов по текущему фильтру нет.'))
      .toBeVisible({timeout:20000})
    // Reload the owner: no local contact appears until its key-only account
    // has been restored. The subsequent listing is decrypted locally.
    await A.goto('/contacts')
    await expect(A.getByTestId('contacts-row-'+recipientId))
      .toContainText('ENCRYPTED LOCAL NICKNAME',{timeout:20000})
    await contextA.setOffline(true)
    await A.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(A.getByTestId('contacts-row-'+recipientId))
      .toContainText('ENCRYPTED LOCAL NICKNAME')
    await A.getByRole('button',{name:'Карточка'}).click()
    await A.getByLabel('Локальное имя').last().fill('Offline contact')
    await A.getByRole('button',{name:'Сохранить имя'}).click()
    await expect(A.getByTestId('contacts-row-'+recipientId))
      .toContainText('Offline contact')
    A.once('dialog',dialog=>void dialog.accept())
    await A.getByRole('button',{name:'Удалить контакт'}).click()
    await expect(A.getByTestId('contacts-row-'+recipientId)).toHaveCount(0)
    await expect(B.getByText('Контактов по текущему фильтру нет.')).toBeVisible()
  }finally{
    await contextA.close();await contextB.close()
  }
})
