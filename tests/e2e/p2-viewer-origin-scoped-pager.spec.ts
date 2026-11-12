import {test,expect} from '@playwright/test'

test('P2 File Viewer: navigate exactly the Browser folder/filter order and return to last viewed encrypted file',async({browser})=>{
  test.setTimeout(150000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    const picker=page.getByTestId('media-import-file')
    for(const [name,mime,fill] of [
      ['SCOPED-A.wav','audio/wav',0x51],
      ['SCOPED-B.wav','audio/wav',0x52],
      ['SCOPED-VIDEO.webm','video/webm',0x53],
      ['OUTSIDE.wav','audio/wav',0x54],
    ] as const){
      await picker.setInputFiles({name,mimeType:mime,buffer:Buffer.alloc(8192,fill)})
      await expect(page.locator('[data-testid^="browser-row-media:"]'))
        .toHaveCount(fill-0x50,{timeout:30000})
    }
    const rows=await page.evaluate(async()=>{
      const module=await import('/src/features/media/application/media-outbox.ts')
      const result:{id:string;name:string}[]=[]
      for(const row of await module.listLocalMedia()){
        const meta=await module.readLocalMediaMetadata(row.mediaId)
        result.push({id:row.mediaId,name:meta.fileName})
      }
      return result
    })
    expect(rows).toHaveLength(4)
    await page.getByRole('button',{name:'Новая папка'}).click()
    await page.getByTestId('browser-folder-name').fill('Только выбранные')
    await page.getByRole('button',{name:'Создать',exact:true}).click()
    await expect(page.locator('.browser-folder-item')).toHaveCount(1)
    for(const row of rows.filter(x=>x.name!=='OUTSIDE.wav')){
      await page.getByRole('combobox',{name:'Папка файла '+row.id})
        .selectOption({label:'Только выбранные'})
    }
    await page.locator('.browser-folder-open')
      .filter({hasText:'Только выбранные'}).click()
    await page.getByTestId('browser-filter-audio').click()
    await page.getByTestId('browser-sort').selectOption('expiry')
    const visibleRows=page.locator('[data-testid^="browser-row-media:"]')
    await expect(visibleRows).toHaveCount(2)
    const orderedKeys=await visibleRows.evaluateAll(nodes=>
      nodes.map(node=>node.getAttribute('data-testid')?.slice('browser-row-'.length)??''))
    expect(orderedKeys).toHaveLength(2)
    expect(orderedKeys.every(key=>key.startsWith('media:'))).toBe(true)
    const firstId=orderedKeys[0]!.slice('media:'.length)
    const secondId=orderedKeys[1]!.slice('media:'.length)
    await page.getByRole('link',{name:'Полный просмотр файла '+firstId}).click()
    await expect(page).toHaveURL(new RegExp('/browser/file/media/'+firstId+'$'))
    await expect(page.getByTestId('file-viewer-audio')).toBeVisible()
    await expect(page.getByTestId('file-viewer-position')).toHaveText('1 / 2')
    await expect(page.getByRole('button',{name:'Предыдущий файл'})).toBeDisabled()
    await expect(page.getByRole('button',{name:'Следующий файл'})).toBeEnabled()
    await page.getByRole('button',{name:'Следующий файл'}).click()
    await expect(page).toHaveURL(new RegExp('/browser/file/media/'+secondId+'$'))
    await expect(page.getByTestId('file-viewer-audio')).toBeVisible()
    await expect(page.getByTestId('file-viewer-position')).toHaveText('2 / 2')
    await expect(page.getByRole('button',{name:'Следующий файл'})).toBeDisabled()
    await expect(page.getByRole('button',{name:'Предыдущий файл'})).toBeEnabled()

    // Direct Viewer->Browser return uses the last visited eligible file;
    // neither the excluded video nor the outside-folder audio entered pager.
    await page.getByRole('link',{name:/Browser/}).first().click()
    await expect(page).toHaveURL(/\/browser$/)
    await expect(page.getByLabel('Путь папки'))
      .toContainText('Только выбранные',{timeout:20000})
    await expect(page.getByTestId('browser-filter-audio'))
      .toHaveAttribute('aria-pressed','true')
    await expect(visibleRows).toHaveCount(2,{timeout:20000})
    await expect(page.locator('[data-testid="browser-row-media:'+secondId+'"]'))
      .toBeVisible()
  }finally{await context.close()}
})
