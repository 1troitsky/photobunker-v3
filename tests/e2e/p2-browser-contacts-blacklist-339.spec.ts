import { test, expect } from '@playwright/test'

test('P2 #339: two real trusted peers, encrypted local block, refilter after alias and Team picker',async({browser})=>{
  test.setTimeout(220000)
  const ctxA=await browser.newContext(),ctxB=await browser.newContext()
  const ctxC=await browser.newContext()
  const A=await ctxA.newPage(),B=await ctxB.newPage(),C=await ctxC.newPage()
  async function enroll(page:typeof A):Promise<string>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    return page.evaluate(async()=>{
      const s=await import('/src/features/identity/application/session.ts')
      return s.requireSession().accountId
    })
  }
  async function confirmAndAdd(id:string,alias:string):Promise<void>{
    await A.getByTestId('contacts-lookup-id').fill(id)
    await A.getByRole('button',{name:'Проверить ключ'}).click()
    await expect(A.getByTestId('contacts-fingerprint')).toBeVisible({timeout:20000})
    await A.getByTestId('contacts-fingerprint-ack').check()
    await A.getByRole('button',{name:'Подтвердить отпечаток'}).click()
    await expect(A.getByText('Ключ подтверждён на этом устройстве.')).toBeVisible()
    await A.getByTestId('contacts-alias').fill(alias)
    await A.getByRole('button',{name:'Добавить в контакты'}).click()
    await expect(A.getByTestId('contacts-row-'+id)).toContainText(alias,{timeout:20000})
  }
  try{
    await enroll(A)
    const idB=await enroll(B),idC=await enroll(C)
    await B.goto('/browser')
    await C.goto('/browser')
    await expect(B.getByText('Ключ обмена подготовлен')).toBeVisible({timeout:20000})
    await expect(C.getByText('Ключ обмена подготовлен')).toBeVisible({timeout:20000})
    await A.goto('/contacts')
    await expect(A.getByTestId('contacts-blacklist-toggle')).toBeEnabled()
    await confirmAndAdd(idB,'Blocked recipient')
    await confirmAndAdd(idC,'Allowed recipient')

    // Local-only block; it MUST NOT pretend an existing signed server grant is revoked.
    await A.getByTestId('contacts-row-'+idB).getByRole('button',{name:'Карточка'}).click()
    A.once('dialog',dialog=>void dialog.accept())
    await A.getByTestId('contacts-local-block').click()
    await expect(A.getByTestId('contacts-row-'+idB)).toHaveCount(0)
    await expect(A.getByTestId('contacts-row-'+idC)).toBeVisible()
    await A.getByTestId('contacts-blacklist-toggle').click()
    await expect(A.getByTestId('contacts-local-blacklist'))
      .toContainText('Ранее выданные серверные разрешения')
    await expect(A.getByTestId('blocked-row-'+idB)).toBeVisible()

    const encrypted=await A.evaluate(async()=>{
      return new Promise<{count:number;raw:string}>((resolve,reject)=>{
        const request=indexedDB.open('pb3-encrypted-contact-blocklist-v1')
        request.onerror=()=>reject(request.error)
        request.onsuccess=()=>{
          const db=request.result
          const tx=db.transaction('blocks','readonly')
          const rows=tx.objectStore('blocks').getAll()
          rows.onerror=()=>reject(rows.error)
          rows.onsuccess=()=>resolve({
            count:rows.result.length,raw:JSON.stringify(rows.result),
          })
          tx.oncomplete=()=>db.close()
        }
      })
    })
    expect(encrypted.count).toBe(1)
    expect(encrypted.raw).not.toContain(idB)
    expect(encrypted.raw).not.toContain('Blocked recipient')

    // Regression in original #304: this save used to reload the full unfiltered
    // contacts list, resurrecting the blocked recipient and invite option.
    await A.getByTestId('contacts-row-'+idC).getByRole('button',{name:'Карточка'}).click()
    await A.getByLabel('Локальное имя').last().fill('Allowed after refresh')
    await A.getByRole('button',{name:'Сохранить имя'}).click()
    await expect(A.getByTestId('contacts-row-'+idC)).toContainText('Allowed after refresh')
    await expect(A.getByTestId('contacts-row-'+idB)).toHaveCount(0)
    await A.getByRole('button',{name:/^Команды \(/}).click()
    await A.getByRole('button',{name:'Создать команду'}).click()
    await A.getByTestId('team-name').fill('P2 339 safe invite choice')
    await A.getByLabel('Описание').first().fill('Private team; block must not invite')
    await A.getByTestId('team-create-submit').click()
    await expect(A.getByText('В облаке',{exact:false}))
      .toBeVisible({timeout:30000})
    await A.getByTestId('team-member-selector')
      .selectOption({label:'P2 339 safe invite choice'})
    await A.getByRole('button',{name:'Добавить участника'}).click()
    const choices=await A.getByTestId('team-invite-contact')
      .locator('option').allTextContents()
    expect(choices.join('|')).toContain('Allowed after refresh')
    expect(choices.join('|')).not.toContain('Blocked recipient')

    // Reload and offline refresh preserve only the unblocked local view.
    await A.goto('/contacts')
    await expect(A.getByTestId('contacts-row-'+idB)).toHaveCount(0)
    await expect(A.getByTestId('contacts-row-'+idC)).toContainText('Allowed after refresh')
    await ctxA.setOffline(true)
    await A.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(A.getByTestId('contacts-row-'+idB)).toHaveCount(0)
    await expect(A.getByTestId('contacts-row-'+idC)).toBeVisible()
  }finally{
    await ctxA.close();await ctxB.close();await ctxC.close()
  }
})
