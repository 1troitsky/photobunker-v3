import {expect,test} from '@playwright/test'

test('P2 Browser: two recovered devices exchange signed E2EE folders, replay Lost ACK and refuse divergent offline edits',async({browser})=>{
  test.setTimeout(210000)
  const ctxA=await browser.newContext()
  const ctxB=await browser.newContext()
  const a=await ctxA.newPage()
  const b=await ctxB.newPage()
  try{
    await a.goto('/settings')
    await a.getByRole('button',{name:'Создать ключ'}).click()
    const recoveryKey=await a.locator('#generated-key').inputValue()
    expect(recoveryKey).toMatch(/^PB2\./)
    await a.getByLabel('Я сохранил ключ восстановления').check()
    await a.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(a.getByText('Подтверждённая сессия')).toBeVisible()
    await a.goto('/browser')
    await expect(a.getByTestId('browser-folder-sync')).toBeEnabled()
    await a.getByRole('button',{name:'Новая папка'}).click()
    await a.getByTestId('browser-folder-name').fill('PRIVATE-E2EE-A')
    await a.getByRole('button',{name:'Создать',exact:true}).click()
    await expect(a.locator('.browser-folder-open').filter({hasText:'PRIVATE-E2EE-A'}))
      .toBeVisible()

    // Real same-origin POST is committed on the server; the client never
    // receives its ACK. A durable retry must use the identical signed
    // operationId and must not increment the server's revision twice.
    let intercepted=false
    let originalBody=''
    await a.route('**/folders/v1/snapshot',async route=>{
      if(route.request().method()!=='POST'||intercepted){
        await route.continue()
        return
      }
      intercepted=true
      originalBody=route.request().postData()??''
      expect(originalBody).not.toContain('PRIVATE-E2EE-A')
      const response=await route.fetch()
      expect(response.status()).toBe(201)
      await route.abort('failed')
    })
    await a.getByTestId('browser-folder-sync').click()
    await expect(a.getByTestId('browser-folder-sync-status'))
      .toContainText('не подтверждена',{timeout:15000})
    await a.getByTestId('browser-folder-sync').click()
    await expect(a.getByTestId('browser-folder-sync-status'))
      .toContainText('подтверждённой облачной версии',{timeout:15000})
    expect(intercepted).toBe(true)
    const first=await a.evaluate(async()=>{
      const r=await fetch('/folders/v1/snapshot',{credentials:'same-origin'})
      return r.json() as Promise<{revision:number;contract:string}>
    })
    expect(first.revision).toBe(1)
    expect(first.contract).not.toContain('PRIVATE-E2EE-A')
    expect(first.contract).not.toContain(recoveryKey)
    await a.unroute('**/folders/v1/snapshot')

    // New browser with independent IndexedDB/device key, same Recovery Key.
    await b.goto('/settings')
    await b.locator('#recovery-key').fill(recoveryKey)
    await b.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(b.getByText('Подтверждённая сессия')).toBeVisible()
    await b.goto('/browser')
    await expect(b.getByTestId('browser-folder-sync')).toBeEnabled()
    await b.getByTestId('browser-folder-sync').click()
    await expect(b.getByTestId('browser-folder-sync-status'))
      .toContainText('получены и проверены',{timeout:20000})
    await expect(b.locator('.browser-folder-open').filter({hasText:'PRIVATE-E2EE-A'}))
      .toBeVisible()

    // Device B makes durable offline changes, then device A wins rev2.
    await ctxB.setOffline(true)
    await b.getByRole('button',{name:'Новая папка'}).click()
    await b.getByTestId('browser-folder-name').fill('PRIVATE-B-OFFLINE')
    await b.getByRole('button',{name:'Создать',exact:true}).click()
    await expect(b.locator('.browser-folder-open').filter({hasText:'PRIVATE-B-OFFLINE'}))
      .toBeVisible()
    await a.getByRole('button',{name:'Новая папка'}).click()
    await a.getByTestId('browser-folder-name').fill('PRIVATE-A-ONLINE')
    await a.getByRole('button',{name:'Создать',exact:true}).click()
    await a.getByTestId('browser-folder-sync').click()
    await expect(a.getByTestId('browser-folder-sync-status'))
      .toContainText('подтверждён сервером',{timeout:20000})
    const second=await a.evaluate(async()=>{
      const r=await fetch('/folders/v1/snapshot',{credentials:'same-origin'})
      return r.json() as Promise<{revision:number;contract:string}>
    })
    expect(second.revision).toBe(2)
    expect(second.contract).not.toContain('PRIVATE-A-ONLINE')
    expect(second.contract).not.toContain('PRIVATE-B-OFFLINE')

    await ctxB.setOffline(false)
    await b.getByTestId('browser-folder-sync').click()
    await expect(b.getByTestId('browser-folder-sync-status'))
      .toContainText('Конфликт версий',{timeout:20000})
    await expect(b.locator('.browser-folder-open').filter({hasText:'PRIVATE-B-OFFLINE'}))
      .toBeVisible()
    await expect(b.locator('.browser-folder-open').filter({hasText:'PRIVATE-A-ONLINE'}))
      .toHaveCount(0)
    const still=await b.evaluate(async()=>{
      const {getFolderLocalSync}=await import('/src/features/browser/application/folder-workspace.ts')
      const result=await getFolderLocalSync()
      return {names:Object.values(result.workspace.folders).map(f=>f.name),
        revision:result.marker.baseRevision}
    })
    expect(still.names).toContain('PRIVATE-B-OFFLINE')
    expect(still.revision).toBe(1)

    // Verified historical rev1 + latest rev2 are decrypted locally and
    // independent additions can be merged without choosing either device.
    await b.getByTestId('browser-merge-open').click()
    await expect(b.getByTestId('browser-merge-review')).toBeVisible()
    await expect(b.getByTestId('browser-merge-review'))
      .toContainText('Противоречивых изменений нет')
    await b.getByTestId('browser-merge-apply').click()
    await expect(b.getByTestId('browser-folder-sync-status'))
      .toContainText('объединены и подтверждены',{timeout:20000})
    await expect(b.locator('.browser-folder-open').filter({hasText:'PRIVATE-A-ONLINE'}))
      .toBeVisible()
    await expect(b.locator('.browser-folder-open').filter({hasText:'PRIVATE-B-OFFLINE'}))
      .toBeVisible()
    await expect(b.getByTestId('browser-merge-backups')).toContainText('Зашифрованные')
    const merged=await b.evaluate(async()=>{
      const response=await fetch('/folders/v1/snapshot',{credentials:'same-origin'})
      return response.json() as Promise<{revision:number;contract:string}>
    })
    expect(merged.revision).toBe(3)
    expect(merged.contract).not.toContain('PRIVATE-B-OFFLINE')

    // A catches up with the merged cloud snapshot; both sides then change
    // the SAME folder. An explicit choice is required before rev5.
    await a.getByTestId('browser-folder-sync').click()
    await expect(a.getByTestId('browser-folder-sync-status'))
      .toContainText('получены и проверены',{timeout:20000})
    await a.getByRole('button',{name:'Переименовать PRIVATE-E2EE-A'}).click()
    await a.getByTestId('browser-rename-folder').fill('PRIVATE-A-RENAME')
    await a.getByRole('button',{name:'Сохранить',exact:true}).click()
    await a.getByTestId('browser-folder-sync').click()
    await expect(a.getByTestId('browser-folder-sync-status'))
      .toContainText('подтверждён сервером',{timeout:20000})

    await b.getByRole('button',{name:'Переименовать PRIVATE-E2EE-A'}).click()
    await b.getByTestId('browser-rename-folder').fill('PRIVATE-B-RENAME')
    await b.getByRole('button',{name:'Сохранить',exact:true}).click()
    await b.getByTestId('browser-folder-sync').click()
    await expect(b.getByTestId('browser-folder-sync-status'))
      .toContainText('Конфликт версий',{timeout:20000})
    await b.getByTestId('browser-merge-open').click()
    await expect(b.getByTestId('browser-merge-review')).toBeVisible()
    await expect(b.getByTestId('browser-merge-apply')).toBeDisabled()
    const option=b.getByTestId('browser-merge-review').getByLabel(
      /В облаке: PRIVATE-A-RENAME/)
    await option.check()
    await expect(b.getByTestId('browser-merge-apply')).toBeEnabled()
    b.once('dialog',dialog=>dialog.accept())
    await b.getByTestId('browser-merge-apply').click()
    await expect(b.locator('.browser-folder-open').filter({hasText:'PRIVATE-A-RENAME'}))
      .toBeVisible()
    await expect(b.locator('.browser-folder-open').filter({hasText:'PRIVATE-B-RENAME'}))
      .toHaveCount(0)
    await expect(b.getByTestId('browser-merge-backups')).toContainText('Зашифрованные')

    // The pre-merge local encrypted row must be recoverable without
    // any change to remote owner ciphertext or server rev5.
    const backups=await b.evaluate(async()=>{
      const req=indexedDB.open('pb3-browser-device-folders-v1')
      const db=await new Promise<IDBDatabase>((resolve,reject)=>{
        req.onsuccess=()=>resolve(req.result)
        req.onerror=()=>reject(req.error)
      })
      try{
        const tx=db.transaction('backups','readonly')
        const get=tx.objectStore('backups').getAll()
        return await new Promise<string>((resolve,reject)=>{
          get.onsuccess=()=>resolve(JSON.stringify(get.result))
          get.onerror=()=>reject(get.error)
        })
      }finally{db.close()}
    })
    expect(backups).not.toContain('PRIVATE-B-RENAME')
    expect(backups).not.toContain(recoveryKey)
    b.once('dialog',dialog=>dialog.accept())
    await b.getByTestId('browser-merge-backups')
      .getByRole('button',{name:'Восстановить локально'}).first().click()
    await expect(b.locator('.browser-folder-open').filter({hasText:'PRIVATE-B-RENAME'}))
      .toBeVisible()
    await expect(b.getByTestId('browser-folder-sync-status'))
      .toContainText('Локальная копия восстановлена')
  }finally{
    await ctxA.close()
    await ctxB.close()
  }
})
