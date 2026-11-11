import {expect,test} from '@playwright/test'

test('P2 Browser: two recovered devices exchange signed E2EE folders, replay Lost ACK and refuse divergent offline edits',async({browser})=>{
  test.setTimeout(170000)
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
  }finally{
    await ctxA.close()
    await ctxB.close()
  }
})
