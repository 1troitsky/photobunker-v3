import {test,expect} from '@playwright/test'

// A full navigation remounts the app before async device unseal and server
// reproof finish. Only the genuine server-authenticated SAME device may
// perform this test's private Browser writes. Never fake session flags.
async function awaitVerifiedBrowserSession(
  page:import('@playwright/test').Page,
  expected:{accountId:string;deviceId:string},
):Promise<void>{
  await expect.poll(()=>page.evaluate(async expected=>{
    const identity=await import('/src/features/identity/application/session.ts')
    const session=identity.activeSession.value
    if(!session)return 'device-unsealing'
    if(session.accountId!==expected.accountId
      ||session.deviceId!==expected.deviceId)
      throw Error('qa385.wrong_local_account_or_device')
    if(!session.online)return 'signed-login-pending'
    const response=await fetch('/identity/v2/me',{
      credentials:'same-origin',cache:'no-store',
    })
    if(!response.ok)return 'server-session-'+response.status
    const proof=await response.json() as {accountId:string;deviceId:string}
    if(proof.accountId!==expected.accountId||proof.deviceId!==expected.deviceId)
      throw Error('qa385.wrong_server_account_or_device')
    return 'verified'
  },expected),{timeout:30_000}).toBe('verified')
}

test('P2 Browser->File Viewer->Browser: restore encrypted folder, filter, private search and list anchor',async({browser})=>{
  test.setTimeout(145000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    const registered=await page.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      const s=identity.requireSession()
      return {accountId:s.accountId,deviceId:s.deviceId}
    })

    await page.goto('/browser')
    await awaitVerifiedBrowserSession(page,registered)
    await page.getByTestId('media-import-file').setInputFiles({
      name:'RETURN-SECRET-AUDIO.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(8192,0x42),
    })
    const row=page.locator('[data-testid^="browser-row-media:"]')
    await expect(row).toHaveCount(1,{timeout:30000})
    const id=await page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const items=await media.listLocalMedia()
      if(items.length!==1)throw Error('missing local encrypted media')
      return items[0]!.mediaId
    })
    await page.getByRole('button',{name:'Новая папка'}).click()
    await page.getByTestId('browser-folder-name').fill('Приватная папка')
    await page.getByRole('button',{name:'Создать',exact:true}).click()
    // Verify a real AES-GCM/IndexedDB write, independently of Vue rendering.
    // A rendered row alone is not durable; a persisted row alone is not UX.
    await expect.poll(()=>page.evaluate(async()=>{
      const {loadFolderWorkspace}=await import(
        '/src/features/browser/application/folder-workspace.ts')
      const workspace=await loadFolderWorkspace()
      return Object.values(workspace.folders)
        .filter(folder=>folder.name==='Приватная папка').length
    }),{timeout:20_000}).toBe(1)
    await expect(page.locator('.browser-folder-item')).toHaveCount(1)
    await row.getByRole('combobox',{name:'Папка файла '+id})
      .selectOption({label:'Приватная папка'})
    await expect(row).toHaveCount(0)
    await page.locator('.browser-folder-open')
      .filter({hasText:'Приватная папка'}).click()
    await expect(row).toHaveCount(1)

    await page.getByTestId('browser-filter-audio').click()
    await page.getByTestId('browser-sort').selectOption('expiry')
    await page.getByRole('button',{name:'Сетка'}).click()
    await page.getByTestId('browser-search').fill('RETURN-SECRET')
    await expect(row).toHaveCount(1,{timeout:20000})
    await row.getByRole('link',{name:'Полный просмотр файла '+id}).click()
    await expect(page).toHaveURL(new RegExp('/browser/file/media/'+id+'$'))
    expect(page.url()).not.toContain('RETURN-SECRET')
    await expect(page.getByTestId('file-viewer-audio')).toBeVisible()
    await expect(page.getByTestId('file-viewer-info'))
      .toContainText('RETURN-SECRET-AUDIO.wav')

    // Native history Back must restore the origin, not dump us into root.
    await page.goBack()
    await expect(page).toHaveURL(/\/browser$/)
    await expect(page.getByLabel('Путь папки'))
      .toContainText('Приватная папка',{timeout:20000})
    await expect(page.getByTestId('browser-filter-audio'))
      .toHaveAttribute('aria-pressed','true')
    await expect(page.getByTestId('browser-sort')).toHaveValue('expiry')
    await expect(page.getByRole('button',{name:'Сетка'}))
      .toHaveAttribute('aria-pressed','true')
    await expect(page.getByTestId('browser-search')).toHaveValue('RETURN-SECRET')
    await expect(row).toHaveCount(1,{timeout:20000})
    expect(page.url()).not.toContain('RETURN-SECRET')

    // An unrelated fresh Browser navigation is not a second restore.
    await page.goto('/settings')
    await page.getByRole('link',{name:'Browser'}).click()
    await expect(page.getByLabel('Путь папки')).not.toContainText('Приватная папка')
    await expect(page.getByTestId('browser-search')).toHaveValue('')
  }finally{await context.close()}
})
