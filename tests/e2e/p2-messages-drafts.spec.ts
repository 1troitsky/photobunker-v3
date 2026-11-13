import {test,expect} from '@playwright/test'

test('P2-01: verified contact → real encrypted message draft → fullscreen overlay → offline restore',async({browser})=>{
  test.setTimeout(180000)
  const ctxA=await browser.newContext()
  const ctxB=await browser.newContext()
  const A=await ctxA.newPage(),B=await ctxB.newPage()
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
    const ownerId=await enroll(A)
    const peerId=await enroll(B)
    await B.goto('/browser')
    await expect(B.getByText('Ключ обмена подготовлен'))
      .toBeVisible({timeout:25000})

    await A.goto('/contacts')
    await A.getByTestId('contacts-lookup-id').fill(peerId)
    await A.getByRole('button',{name:'Проверить ключ'}).click()
    await expect(A.getByTestId('contacts-fingerprint')).toBeVisible()
    await A.getByTestId('contacts-fingerprint-ack').check()
    await A.getByRole('button',{name:'Подтвердить отпечаток'}).click()
    await A.getByTestId('contacts-alias').fill('PRIVATE CONTACT ALIAS')
    await A.getByRole('button',{name:'Добавить в контакты'}).click()
    await expect(A.getByTestId('contacts-row-'+peerId))
      .toContainText('PRIVATE CONTACT ALIAS')

    await A.goto('/messages')
    await expect(A.getByTestId('messages-page')).toBeVisible()
    await expect(A.getByRole('heading',{name:'Сообщения'})).toBeVisible()
    await expect(A.getByTestId('messages-draft-list'))
      .toContainText('Пока нет диалогов')
    await expect(A.getByText('Matrix пока не подключён',{exact:false}))
      .toBeVisible()
    await A.getByTestId('messages-compose').click()
    await expect(A.getByTestId('messages-contact-picker')).toBeVisible()
    await A.getByTestId('messages-picker-'+peerId).click()
    const overlay=A.getByTestId('messages-thread')
    await expect(overlay).toBeVisible()
    await expect(A.getByRole('button',{name:'Отправить сообщение'})).toBeDisabled()
    await expect(A.getByRole('button',{name:'Добавить вложение'})).toBeDisabled()
    expect(await A.evaluate(()=>Boolean(
      document.querySelector('[data-testid="messages-draft-list"]'),
    ))).toBe(true) // background page remains mounted below overlay

    const content='PRIVATE_DRAFT_NOT_A_MATRIX_EVENT'
    await A.getByTestId('messages-editor').fill(content)
    await A.getByTestId('messages-close').click()
    await expect(overlay).toHaveCount(0)
    await expect(A.getByTestId('messages-draft-'+peerId))
      .toContainText(content)
    const encrypted=await A.evaluate(async()=>{
      return new Promise<{count:number;raw:string}>((resolve,reject)=>{
        const request=indexedDB.open('pb3-encrypted-messages-drafts-v1')
        request.onerror=()=>reject(request.error)
        request.onsuccess=()=>{
          const db=request.result,tx=db.transaction('drafts','readonly')
          const rows=tx.objectStore('drafts').getAll()
          rows.onerror=()=>reject(rows.error)
          tx.oncomplete=()=>{
            resolve({count:rows.result.length,raw:JSON.stringify(rows.result)})
            db.close()
          }
        }
      })
    })
    expect(encrypted.count).toBe(1)
    for(const forbidden of [
      content,peerId,ownerId,'PRIVATE CONTACT ALIAS','peerAccountId','body',
    ])expect(encrypted.raw).not.toContain(forbidden)

    await A.reload()
    await expect(A.getByTestId('messages-draft-'+peerId))
      .toContainText(content,{timeout:25000})
    await A.getByTestId('messages-draft-'+peerId).click()
    await expect(A.getByTestId('messages-editor')).toHaveValue(content)
    await A.keyboard.press('Escape')
    await expect(A.getByTestId('messages-thread')).toHaveCount(0)
    await expect(A.getByTestId('messages-draft-'+peerId)).toBeFocused()

    // Draft edits continue offline, with no simulated Matrix network ACK.
    await ctxA.setOffline(true)
    await A.getByTestId('messages-draft-'+peerId).click()
    await A.getByTestId('messages-editor').fill(content+' OFFLINE')
    await A.getByTestId('messages-close').click()
    await expect(A.getByTestId('messages-draft-'+peerId))
      .toContainText('OFFLINE')
    await ctxA.setOffline(false)
    await B.goto('/messages')
    await expect(B.getByTestId('messages-draft-list'))
      .toContainText('Пока нет диалогов')
    await expect(B.getByTestId('messages-draft-'+peerId)).toHaveCount(0)
    await expect(B.getByText(content)).toHaveCount(0)

    // An empty draft removes the encrypted record rather than showing a
    // fake conversation with no Matrix room.
    await A.getByTestId('messages-draft-'+peerId).click()
    await A.getByTestId('messages-editor').fill('')
    await A.getByTestId('messages-close').click()
    await expect(A.getByTestId('messages-draft-'+peerId)).toHaveCount(0)
  }finally{
    await ctxA.close();await ctxB.close()
  }
})


test('P2-01: optional Messages Dock route uses current Shell and never promises Matrix delivery',async({page})=>{
  await page.goto('/assignments')
  // Existing five-point default is unchanged. The accepted Beta is opt-in
  // through Appearance; preview controls the SAME shared Dock, not a fake UI.
  await page.evaluate(async()=>{
    const {previewDock}=await import('/src/ui/fieldwork/dock-preferences.ts')
    if(!previewDock(['assignments','browser','messages','settings']))
      throw Error('messages.opt_in_dock_rejected')
  })
  const dock=page.getByRole('navigation',{name:'Главная навигация'})
  const link=dock.getByRole('link',{name:'Сообщения'})
  await expect(link).toHaveAttribute('href','/messages')
  await link.click()
  await expect(page).toHaveURL(/\/messages$/)
  await expect(page.getByTestId('messages-page')).toBeVisible()
  await expect(page.getByRole('heading',{name:'Сообщения'})).toBeVisible()
  await expect(page.getByText('Matrix пока не подключён',{exact:false})).toBeVisible()
  await expect(page.getByTestId('messages-compose')).toBeDisabled()
  // There must NOT be a separate thread route, extra Shell or fake sent state.
  await expect(page.getByTestId('messages-thread')).toHaveCount(0)
  await expect(page.locator('.shell-header')).toHaveCount(1)
  await expect(page.locator('.shell-dock')).toHaveCount(1)
})
