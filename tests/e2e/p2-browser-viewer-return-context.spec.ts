import {expect,test} from '@playwright/test'

test('P2 Browser -> File Viewer -> Browser restores decrypted folder, private query, filter, sort and position without URL/storage disclosure',async({browser})=>{
  test.setTimeout(165000)
  const context=await browser.newContext()
  const page=await context.newPage()
  const secret='PRIVATE-SEARCH-RETURN-CONTEXT'
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    await expect(page.getByTestId('browser-v3')).toBeVisible()
    await page.getByRole('button',{name:'Новая папка'}).click()
    await page.getByTestId('browser-folder-name').fill('Return Workspace')
    await page.getByRole('button',{name:'Создать',exact:true}).click()
    const folder=page.getByRole('button',{name:'Return Workspace',exact:true})
    await expect(folder).toBeVisible()
    await page.getByTestId('media-import-destination')
      .selectOption({label:'Return Workspace'})
    await page.locator('#media-import-description').fill(secret)
    await page.getByTestId('media-import-file').setInputFiles({
      name:'PRIVATE-RETURN-CONTEXT.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(8192,0x59),
    })
    await expect(page.locator('.media-import-p1')
      .getByText('Файл зашифрован и сохранён на устройстве.'))
      .toBeVisible({timeout:30000})
    const mediaId=await page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const rows=await media.listLocalMedia()
      if(rows.length!==1)throw Error('expected_one_locally_encrypted_original')
      return rows[0]!.mediaId
    })
    await expect.poll(()=>page.evaluate(async id=>{
      const folders=await import('/src/features/browser/application/folder-workspace.ts')
      const workspace=await folders.loadFolderWorkspace()
      return !!workspace.placements['media:'+id]
    },mediaId),{timeout:20000}).toBe(true)
    await folder.click()
    const row=page.getByTestId('browser-row-media:'+mediaId)
    await expect(row).toBeVisible({timeout:30000})
    await page.getByTestId('browser-filter-audio').click()
    await page.getByTestId('browser-sort').selectOption('expiry')
    await page.getByRole('button',{name:'Сетка',exact:true}).click()
    await page.getByTestId('browser-search-folder-scope').selectOption('current')
    await page.getByTestId('browser-search').fill(secret)
    await expect(page.getByTestId('browser-private-search-status'))
      .toContainText('Проверено 1 из 1',{timeout:25000})
    await expect(row).toBeVisible()
    await page.locator('.shell-main').evaluate(el=>{el.scrollTop=200})
    await row.getByRole('link',{name:'Полный просмотр файла '+mediaId}).click()
    await expect(page.getByTestId('file-viewer')).toBeVisible({timeout:25000})
    await expect(page.getByTestId('file-viewer-audio'))
      .toBeVisible({timeout:25000})
    expect(page.url()).not.toContain(secret)
    await page.getByRole('link',{name:'‹ Browser'}).click()
    await expect(page.getByTestId('browser-v3')).toBeVisible({timeout:25000})
    await expect(page.getByTestId('browser-search')).toHaveValue(secret)
    await expect(page.getByTestId('browser-search-folder-scope'))
      .toHaveValue('current')
    await expect(page.getByTestId('browser-filter-audio'))
      .toHaveAttribute('aria-pressed','true')
    await expect(page.getByTestId('browser-sort')).toHaveValue('expiry')
    await expect(page.getByRole('button',{name:'Сетка',exact:true}))
      .toHaveAttribute('aria-pressed','true')
    await expect(page.getByRole('button',{name:'Return Workspace',exact:true}))
      .toHaveAttribute('aria-current','location')
    await expect(page.getByTestId('browser-private-search-status'))
      .toContainText('Проверено 1 из 1',{timeout:25000})
    await expect(row).toBeVisible({timeout:25000})
    expect(new URL(page.url()).search).toBe('')
    const exposure=await page.evaluate(secret=>{
      const local=Object.keys(localStorage)
        .map(k=>k+'='+localStorage.getItem(k)).join('\n')
      const session=Object.keys(sessionStorage)
        .map(k=>k+'='+sessionStorage.getItem(k)).join('\n')
      const html=document.documentElement.outerHTML
      return {stored:local+'\n'+session,
        url:location.href,visible:html.includes(secret)}
    },secret)
    expect(exposure.stored).not.toContain(secret)
    expect(exposure.url).not.toContain(secret)
    expect(exposure.visible).toBe(true) // only decrypted volatile UI state
  }finally{await context.close()}
})
