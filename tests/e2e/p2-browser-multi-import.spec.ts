import {test,expect} from '@playwright/test'

test('P2 Browser: offline multi-select AES-GCM import into selected folder persists across reload and cloud sync',async({browser})=>{
  test.setTimeout(180000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    await expect(page.getByTestId('browser-v3')).toBeVisible()
    await page.getByRole('button',{name:'Новая папка'}).click()
    await page.getByTestId('browser-folder-name').fill('Project Evidence')
    await page.getByRole('button',{name:'Создать',exact:true}).click()
    const folder=page.getByRole('button',{name:'Project Evidence',exact:true})
    await expect(folder).toBeVisible()
    await page.locator('#media-import-category').fill('PRIVATE-CATEGORY')
    await page.locator('#media-import-description').fill('PRIVATE-BATCH-CASE')
    await page.locator('#media-import-tags').fill('confidential, field')
    await context.setOffline(true)
    const dest=page.getByTestId('media-import-destination')
    await dest.selectOption({label:'Project Evidence'})
    await page.getByTestId('media-import-file').setInputFiles([
      {name:'BATCH-ONE.wav',mimeType:'audio/wav',buffer:Buffer.alloc(8192,0x51)},
      {name:'BATCH-TWO.webm',mimeType:'video/webm',buffer:Buffer.alloc(12288,0x42)},
    ])
    const importPanel=page.locator('.media-import-p1')
    await expect(importPanel.getByText(/Зашифровано на устройстве 2 из 2 файлов/))
      .toBeVisible({timeout:30000})
    const encrypted=await page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const folders=await import('/src/features/browser/application/folder-workspace.ts')
      const all=await media.listLocalMedia()
      const workspace=await folders.loadFolderWorkspace()
      const folder=Object.values(workspace.folders).find(x=>x.name==='Project Evidence')
      if(!folder)throw Error('missing_local_encrypted_folder')
      return {
        rows:await Promise.all(all.map(async x=>({
          mediaId:x.mediaId,state:x.state,type:x.mediaType,
          bytes:x.plainBytes,ciphertextOnly:x.chunks.every(c=>
            c.blob.type==='application/octet-stream'),
          folderId:workspace.placements['media:'+x.mediaId]??null,
          metadata:await media.readLocalMediaMetadata(x.mediaId),
        }))),
        folderId:folder.id,
      }
    })
    expect(encrypted.rows).toHaveLength(2)
    expect(encrypted.rows.map(x=>x.folderId)).toEqual([
      encrypted.folderId,encrypted.folderId])
    expect(encrypted.rows.every(x=>x.ciphertextOnly)).toBe(true)
    expect(encrypted.rows.every(x=>x.state==='queued')).toBe(true)
    expect(encrypted.rows.map(x=>x.metadata.fileName).sort()).toEqual(
      ['BATCH-ONE.wav','BATCH-TWO.webm'])
    expect(encrypted.rows.every(x=>
      x.metadata.category==='PRIVATE-CATEGORY'
        &&x.metadata.description==='PRIVATE-BATCH-CASE'
        &&x.metadata.tags?.join(',')==='confidential,field')).toBe(true)

    // Files intentionally are not in the root, until the selected folder is
    // opened. Neither folder path nor plaintext filename enters cloud API.
    const rows=page.locator('[data-testid^="browser-row-media:"]')
    await expect(rows).toHaveCount(0)
    await folder.click()
    await expect(rows).toHaveCount(2,{timeout:20000})
    await context.setOffline(false)
    await page.reload()
    await expect(page.getByTestId('browser-v3')).toBeVisible()
    await page.getByRole('button',{name:'Project Evidence',exact:true}).click()
    await expect(rows).toHaveCount(2)
    // This is still our existing local-first encrypted outbox, not a
    // simulated server success. Require actual remote ACK for both assets.
    await page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      await media.synchronizeMedia()
    })
    await expect.poll(()=>page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia()).filter(x=>x.state==='synced').length
    }),{timeout:45000}).toBe(2)
  }finally{
    await context.close()
  }
})
