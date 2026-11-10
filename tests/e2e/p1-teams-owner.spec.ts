import { test, expect } from '@playwright/test'

test('P1-27: owner-signed encrypted Team → durable local queue → server ACL → offline local read',async({browser})=>{
  test.setTimeout(150000)
  const ctxA=await browser.newContext(),ctxB=await browser.newContext()
  const A=await ctxA.newPage(),B=await ctxB.newPage()
  async function enroll(page:typeof A):Promise<void>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  }
  try{
    await enroll(A)
    await enroll(B)
    await A.goto('/contacts')
    await A.getByRole('button',{name:/^Команды \(/}).click()
    await A.getByRole('button',{name:'Создать команду'}).click()
    await A.getByTestId('team-name').fill('ENCRYPTED TEAM NAME')
    await A.getByLabel('Описание').first().fill('Private E2EE team description')
    await A.getByTestId('team-create-submit').click()

    // A newly queued team must not be reported as remotely persisted
    // before its matching signed server ACK. The final status is authoritative.
    await expect(A.getByTestId(/^team-row-/).getByText('ENCRYPTED TEAM NAME'))
      .toBeVisible({timeout:20000})
    await expect(A.getByText('В облаке',{exact:false}))
      .toBeVisible({timeout:20000})

    const rows=await A.evaluate(async()=>{
      return new Promise<{count:number;raw:string}>((resolve,reject)=>{
        const request=indexedDB.open('pb3-encrypted-teams-v1')
        request.onerror=()=>reject(request.error)
        request.onsuccess=()=>{
          const db=request.result
          const tx=db.transaction('teams','readonly')
          const read=tx.objectStore('teams').getAll()
          read.onerror=()=>reject(read.error)
          read.onsuccess=()=>resolve({
            count:read.result.length,raw:JSON.stringify(read.result),
          })
          tx.oncomplete=()=>db.close()
        }
      })
    })
    expect(rows.count).toBe(1)
    expect(rows.raw).not.toContain('ENCRYPTED TEAM NAME')
    expect(rows.raw).not.toContain('Private E2EE team description')
    expect(rows.raw).not.toContain('ownerAccountId')

    await B.goto('/contacts')
    await B.getByRole('button',{name:/^Команды \(/}).click()
    await expect(B.getByText('Команд пока нет.')).toBeVisible()

    await ctxA.setOffline(true)
    await A.getByRole('button',{name:'Обновить',exact:true}).first().click()
    await expect(A.getByTestId(/^team-row-/).getByText('ENCRYPTED TEAM NAME')).toBeVisible()
    await expect(A.getByText('В облаке',{exact:false})).toBeVisible()
  }finally{
    await ctxA.close();await ctxB.close()
  }
})
