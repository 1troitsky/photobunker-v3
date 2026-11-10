import { test, expect } from '@playwright/test'

test('P1-28: independently confirmed A→B Teams invite → recipient consent → E2EE team read',async({browser})=>{
  test.setTimeout(210000)
  const ctxA=await browser.newContext(),ctxB=await browser.newContext()
  const A=await ctxA.newPage(),B=await ctxB.newPage()
  async function enroll(page:typeof A):Promise<string>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    return page.evaluate(async()=>{
      const mod=await import('/src/features/identity/application/session.ts')
      return mod.requireSession().accountId
    })
  }
  async function prepareDirectory(page:typeof A):Promise<void>{
    await page.goto('/browser')
    await expect(page.getByText('Ключ обмена подготовлен'))
      .toBeVisible({timeout:20000})
  }
  async function confirmContact(page:typeof A,id:string,alias:string):Promise<void>{
    await page.goto('/contacts')
    await page.getByTestId('contacts-lookup-id').fill(id)
    await page.getByRole('button',{name:'Проверить ключ'}).click()
    await expect(page.getByTestId('contacts-fingerprint')).toBeVisible()
    await page.getByTestId('contacts-fingerprint-ack').check()
    await page.getByRole('button',{name:'Подтвердить отпечаток'}).click()
    await expect(page.getByText('Ключ подтверждён на этом устройстве.'))
      .toBeVisible()
    await page.getByTestId('contacts-alias').fill(alias)
    await page.getByRole('button',{name:'Добавить в контакты'}).click()
    await expect(page.getByTestId('contacts-row-'+id)).toContainText(alias)
  }
  try{
    const accountA=await enroll(A)
    const accountB=await enroll(B)
    await prepareDirectory(A)
    await prepareDirectory(B)
    await confirmContact(A,accountB,'Peer B')
    await confirmContact(B,accountA,'Peer A')
    await A.getByRole('button',{name:/^Команды \(/}).click()
    await A.getByRole('button',{name:'Создать команду'}).click()
    await A.getByTestId('team-name').fill('TEAM SECRET PROOF')
    await A.getByLabel('Описание').first().fill('E2EE profile visible only to accepted users')
    await A.getByTestId('team-create-submit').click()
    await expect(A.getByText('TEAM SECRET PROOF')).toBeVisible()
    await expect(A.getByText('В облаке',{exact:false}))
      .toBeVisible({timeout:30000})
    const panel=A.getByTestId('team-membership-panel')
    await expect(panel.getByTestId('team-member-selector'))
      .toContainText('TEAM SECRET PROOF')
    await panel.getByTestId('team-member-selector').selectOption({label:'TEAM SECRET PROOF'})
    await panel.getByRole('button',{name:'Добавить участника'}).click()
    await panel.getByTestId('team-invite-contact').selectOption(accountB)
    await panel.getByTestId('team-invite-role').selectOption('viewer')
    await panel.getByTestId('team-invite-submit').click()
    await expect(panel.getByText('Приглашение отправлено',{exact:false}))
      .toBeVisible({timeout:30000})
    await expect(panel.getByTestId('team-member-'+accountB))
      .toContainText('Ожидает согласия')

    await B.getByRole('button',{name:/^Команды \(/}).click()
    const inbox=B.getByTestId('team-membership-panel')
    await expect(inbox.getByTestId('team-incoming-invites')).toBeVisible({timeout:30000})
    await expect(inbox.getByText('Наблюдатель')).toBeVisible()
    await inbox.getByRole('button',{name:'Принять'}).click()
    await expect(inbox.getByTestId('team-joined-list')).toBeVisible({timeout:30000})
    await expect(inbox.getByText('TEAM SECRET PROOF')).toBeVisible()
    await expect(inbox.getByText('E2EE profile visible only to accepted users'))
      .toBeVisible()
    // Durable local member state is encrypted: neither team name nor
    // owner identity, plaintext consent, or Team DEK is indexed on disk.
    const encrypted=await B.evaluate(async()=>{
      return new Promise<string>((resolve,reject)=>{
        const req=indexedDB.open('pb3-encrypted-team-members-v1')
        req.onerror=()=>reject(req.error)
        req.onsuccess=()=>{
          const db=req.result
          const tx=db.transaction(['operations','joined'],'readonly')
          const a=tx.objectStore('operations').getAll()
          const b=tx.objectStore('joined').getAll()
          a.onerror=()=>reject(a.error)
          b.onerror=()=>reject(b.error)
          tx.oncomplete=()=>{
            resolve(JSON.stringify([...a.result,...b.result]))
            db.close()
          }
        }
      })
    })
    expect(encrypted).not.toContain('TEAM SECRET PROOF')
    expect(encrypted).not.toContain('E2EE profile visible only to accepted users')
    expect(encrypted).not.toContain(accountA)
    expect(encrypted).not.toContain('recipientAccountId')

    await panel.getByTestId('team-member-selector').selectOption('')
    await panel.getByTestId('team-member-selector').selectOption({label:'TEAM SECRET PROOF'})
    await expect(panel.getByTestId('team-member-'+accountB))
      .toContainText('Принято',{timeout:20000})
    await ctxB.setOffline(true)
    await inbox.getByRole('button',{name:'Обновить'}).click()
    await expect(inbox.getByText('TEAM SECRET PROOF')).toBeVisible()
    await expect(inbox.getByText('Локальная копия',{exact:false})).toBeVisible()
  }finally{
    await ctxA.close();await ctxB.close()
  }
})
