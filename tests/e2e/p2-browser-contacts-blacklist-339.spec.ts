import {exchangeReady} from './support/browser-ui'
import {browserControl} from './support/browser-ui'
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
    await expect(page.locator('[data-testid="shell-status-link"][data-session-state="online"]')).toBeVisible()
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
    await exchangeReady(B)
    await exchangeReady(C)
    await A.goto('/contacts')
    await expect(A.getByTestId('contacts-blacklist-toggle')).toBeEnabled()
    await expect(A.locator('.shell-header').getByTestId('contacts-blacklist-toggle')).toBeVisible()
    await expect(A.getByTestId('contacts-blacklist-toggle')).toHaveCount(1)
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

    // The contact action opens only a confirmed LOCAL encrypted draft,
    // never a fabricated Matrix network conversation.
    await A.getByTestId('contacts-message-draft-link').click()
    await expect(A).toHaveURL(url=>url.pathname==='/messages'&&url.searchParams.get('peer')===idC)
    await expect(A.getByTestId('messages-thread')).toBeVisible()
    await expect(A.getByRole('button',{name:'Отправить сообщение'})).toBeDisabled()
    await A.getByTestId('messages-editor').fill('Allowed local draft only')
    await A.getByTestId('messages-close').click()
    await expect(A.getByTestId('messages-draft-'+idC))
      .toContainText('Allowed local draft only')

    // Direct URL to a locally blocked former contact must never show an
    // existing encrypted draft, contact picker option or conversation.
    await A.goto('/messages?peer='+idB)
    await expect(A.getByTestId('messages-page')).toBeVisible()
    await expect(A.getByTestId('messages-thread')).toHaveCount(0)
    await expect(A.getByTestId('messages-draft-'+idB)).toHaveCount(0)
    await A.getByTestId('messages-compose').click()
    await expect(A.getByTestId('messages-picker-'+idC)).toBeVisible()
    await expect(A.getByTestId('messages-picker-'+idB)).toHaveCount(0)

    await A.goto('/contacts')
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
    await browserControl(A,'Обновить')
    await expect(A.getByTestId('contacts-row-'+idB)).toHaveCount(0)
    await expect(A.getByTestId('contacts-row-'+idC)).toBeVisible()
  }finally{
    await ctxA.close();await ctxB.close();await ctxC.close()
  }
})
