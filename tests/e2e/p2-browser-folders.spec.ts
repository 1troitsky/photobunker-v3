import {test,expect} from '@playwright/test'

test('P2 Browser: encrypted device-local nested folders survive reload and never move media ciphertext',async({browser})=>{
  test.setTimeout(140000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    await expect(page.getByTestId('browser-folders')).toBeVisible()
    await context.setOffline(true)
    await page.getByTestId('media-import-file').setInputFiles({
      name:'PRIVATE-LOCAL-FOLDER-TEST.webm',mimeType:'video/webm',
      buffer:Buffer.alloc(8192,0x45),
    })
    const item=page.locator('[data-testid^="browser-row-media:"]')
    await expect(item).toHaveCount(1,{timeout:30000})
    const id=await page.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const rows=await m.listLocalMedia()
      return rows[0]!.mediaId
    })
    await page.getByRole('button',{name:'Новая папка'}).click()
    await page.getByTestId('browser-folder-name').fill('Съёмки')
    await page.getByRole('button',{name:'Создать',exact:true}).click()
    await expect(page.locator('.browser-folder-item')).toHaveCount(1)
    const sealed=await page.evaluate(async()=>{
      const request=indexedDB.open('pb3-browser-device-folders-v1')
      const db=await new Promise<IDBDatabase>((resolve,reject)=>{
        request.onsuccess=()=>resolve(request.result)
        request.onerror=()=>reject(request.error)
      })
      try{
        const transaction=db.transaction('rows','readonly')
        const all=transaction.objectStore('rows').getAll()
        return await new Promise<string>((resolve,reject)=>{
          all.onsuccess=()=>resolve(JSON.stringify(all.result))
          all.onerror=()=>reject(all.error)
        })
      }finally{db.close()}
    })
    expect(sealed).not.toContain('Съёмки')
    expect(sealed).not.toContain(id)
    expect(sealed).not.toContain('PRIVATE-LOCAL-FOLDER')

    await item.getByRole('combobox',{name:'Папка файла '+id})
      .selectOption({label:'Съёмки'})
    await expect(item).toHaveCount(0)
    await page.locator('.browser-folder-open').filter({hasText:'Съёмки'}).click()
    await expect(item).toHaveCount(1)
    await page.getByRole('button',{name:'Новая папка'}).click()
    await page.getByTestId('browser-folder-name').fill('День 1')
    await page.getByRole('button',{name:'Создать',exact:true}).click()
    await item.getByRole('combobox',{name:'Папка файла '+id})
      .selectOption({label:'День 1'})
    await expect(item).toHaveCount(0)
    await page.locator('.browser-folder-open').filter({hasText:'День 1'}).click()
    await expect(item).toHaveCount(1)
    await expect(page.getByLabel('Путь папки')).toContainText('Съёмки')
    await expect(page.getByLabel('Путь папки')).toContainText('День 1')

    // The virtual membership must not change actual immutable media bytes.
    const bytes=await page.evaluate(async mediaId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const file=await m.readLocalMedia(mediaId)
      return {length:file.blob.size,name:file.metadata.fileName}
    },id)
    expect(bytes).toEqual({length:8192,name:'PRIVATE-LOCAL-FOLDER-TEST.webm'})
    // App shell can reload online, then the same encrypted local work remains
    // accessible without any subsequent cloud API.
    await context.setOffline(false)
    await page.reload()
    await expect(page.getByTestId('browser-folders')).toBeVisible()
    await context.setOffline(true)
    await page.locator('.browser-folder-open').filter({hasText:'Съёмки'}).click()
    await page.locator('.browser-folder-open').filter({hasText:'День 1'}).click()
    await expect(item).toHaveCount(1)
    await page.getByRole('button',{name:'Мои файлы'}).click()
    const remove=page.getByRole('button',{name:'Удалить пустую папку Съёмки'})
    page.once('dialog',d=>d.accept())
    await remove.click()
    await expect(page.getByText('browser.folder_not_empty')).toBeVisible()
    await expect(page.locator('.browser-folder-open').filter({hasText:'Съёмки'}))
      .toBeVisible()

    // Batch operations commit a single encrypted revision for selected files.
    const filePicker=page.getByTestId('media-import-file')
    await filePicker.setInputFiles({
      name:'PRIVATE-BATCH-A.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(8192,0x48),
    })
    await expect(page.locator('[data-testid^="browser-row-media:"]')).toHaveCount(1)
    await filePicker.setInputFiles({
      name:'PRIVATE-BATCH-B.webm',mimeType:'video/webm',
      buffer:Buffer.alloc(8192,0x49),
    })
    await expect(page.locator('[data-testid^="browser-row-media:"]')).toHaveCount(2)
    await page.getByRole('button',{name:'Выбрать всё на странице'}).click()
    await page.getByTestId('browser-bulk-destination').selectOption({label:'Съёмки'})
    await page.getByRole('button',{name:/Переместить выбранные/}).click()
    await expect(page.locator('[data-testid^="browser-row-media:"]')).toHaveCount(0)
    await page.locator('.browser-folder-open').filter({hasText:'Съёмки'}).click()
    await expect(page.locator('[data-testid^="browser-row-media:"]')).toHaveCount(2)
  }finally{await context.close()}
})
