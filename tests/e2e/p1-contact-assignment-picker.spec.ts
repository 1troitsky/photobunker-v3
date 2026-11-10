import { test, expect } from '@playwright/test'

test('P1-26: confirmed contact → explicit owner-signed assignment invitation, no implicit access',async({browser})=>{
  test.setTimeout(150000)
  const ctxA=await browser.newContext(),ctxB=await browser.newContext()
  const A=await ctxA.newPage(),B=await ctxB.newPage()
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
  try{
    await enroll(A)
    const recipientId=await enroll(B)
    await B.goto('/browser')
    await expect(B.getByText('Ключ обмена подготовлен')).toBeVisible({timeout:20000})

    // Independently fingerprint-confirm a real recipient in the local
    // account-scoped encrypted Contacts book before using the picker.
    await A.goto('/contacts')
    await A.getByTestId('contacts-lookup-id').fill(recipientId)
    await A.getByRole('button',{name:'Проверить ключ'}).click()
    await expect(A.getByTestId('contacts-fingerprint')).toBeVisible()
    await A.getByTestId('contacts-fingerprint-ack').check()
    await A.getByRole('button',{name:'Подтвердить отпечаток'}).click()
    await A.getByTestId('contacts-alias').fill('Trusted photographer')
    await A.getByRole('button',{name:'Добавить в контакты'}).click()
    await expect(A.getByTestId('contacts-row-'+recipientId))
      .toContainText('Trusted photographer')

    await A.goto('/assignments')
    await A.getByRole('button',{name:'Создать задание'}).click()
    await A.locator('#assignment-title').fill('CONTACT PICKER E2EE ASSIGNMENT')
    await A.locator('#assignment-instructions').fill('Photo assignment')
    await A.getByRole('button',{name:'Создать зашифрованное задание'}).click()
    await A.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(A.locator('.assignment-detail code').first()).toBeVisible()
    const assignmentId=(await A.locator('.assignment-detail code').first()
      .textContent())?.trim()??''
    expect(assignmentId).toMatch(/^[0-9a-f-]{36}$/)
    await A.getByTestId('open-fieldwork-editor').click()
    await expect(A.getByTestId('fieldwork-assignment-editor')).toBeVisible()
    await A.getByRole('tab',{name:'Участники'}).click()
    const chosen=A.getByTestId('editor-confirmed-contact-'+recipientId)
    await expect(chosen).toContainText('Trusted photographer',{timeout:20000})

    // Contact selection is a local UI action, not a signed invite/grant.
    const before=await A.evaluate(async id=>{
      const res=await fetch('/assignments/v1/'+id+'/participants')
      const data=await res.json()
      return {http:res.status,count:data.items?.length}
    },assignmentId)
    expect(before).toEqual({http:200,count:0})
    await chosen.getByRole('button',{name:'Выбрать'}).click()
    await expect(A.locator('#editor-recipient-id')).toHaveValue(recipientId)
    await expect(A.getByText('Контакт выбран, ключ подтверждён. Приглашение ещё не отправлено.'))
      .toBeVisible({timeout:15000})
    const stillBefore=await A.evaluate(async id=>{
      const res=await fetch('/assignments/v1/'+id+'/participants')
      const data=await res.json()
      return data.items?.length
    },assignmentId)
    expect(stillBefore).toBe(0)
    await A.getByRole('button',{name:'Отправить подписанное приглашение'}).click()
    await expect(A.getByTestId('editor-participant-'+recipientId))
      .toContainText('Ожидает принятия',{timeout:20000})

    await B.goto('/assignments')
    await B.getByRole('button',{name:'Обновить',exact:true}).click()
    await expect(B.getByText('Приглашения',{exact:true})).toBeVisible({timeout:20000})
    await B.getByRole('button',{name:'Ключ владельца'}).click()
    await B.getByLabel('Я сверил отпечаток владельца').check()
    await B.getByRole('button',{name:'Подтвердить владельца'}).click()
    await B.getByRole('button',{name:'Принять задание'}).click()
    await expect(B.locator('.assignment-card-name'))
      .toContainText('CONTACT PICKER E2EE ASSIGNMENT',{timeout:20000})
    // The mere contact selection did not provide a media DEK.
    const mediaGrants=await B.evaluate(async()=>{
      const m=await import('/src/features/sharing/grant-flow.ts')
      return (await m.listReceivedGrants()).length
    })
    expect(mediaGrants).toBe(0)
  }finally{await ctxA.close();await ctxB.close()}
})
