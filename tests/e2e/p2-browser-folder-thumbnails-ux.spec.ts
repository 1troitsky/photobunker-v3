import {test,expect} from '@playwright/test'

test('Browser v3: real offline E2EE folder thumbnail has no persistent plaintext cache',async({page,context})=>{
  test.setTimeout(140000)
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  await page.goto('/browser')
  await expect(page.getByTestId('browser-header-folder')).toBeEnabled()

  await page.getByTestId('browser-header-folder').click()
  await page.getByTestId('browser-folder-name').fill('Encrypted covers')
  await page.getByRole('button',{name:'Создать',exact:true}).click()
  await expect(page.getByRole('button',{name:'Encrypted covers',exact:true}))
    .toBeVisible()

  // Real, browser-generated PNG bytes, rather than a fake MIME label on a
  // random byte buffer; the Web decoder must render the private preview.
  const png=await page.evaluate(()=>{
    const c=document.createElement('canvas')
    c.width=96;c.height=96
    const ctx=c.getContext('2d')!
    for(let x=0;x<96;x+=3){
      ctx.fillStyle='hsl('+((x*17)%360)+' 80% 45%)'
      ctx.fillRect(x,0,3,96)
    }
    ctx.fillStyle='#fff';ctx.fillRect(2,2,12,12)
    return c.toDataURL('image/png').split(',')[1]!
  })
  expect(Buffer.from(png,'base64').length).toBeGreaterThan(128)
  await context.setOffline(true)
  await page.getByTestId('browser-header-upload').click()
  await page.getByTestId('media-import-file').setInputFiles({
    name:'LOCAL-ONLY-PRIVATE-COVER.png',mimeType:'image/png',
    buffer:Buffer.from(png,'base64'),
  })
  const row=page.locator('[data-testid^="browser-row-media:"]')
  await expect(row).toHaveCount(1,{timeout:30000})
  const id=await page.evaluate(async()=>{
    const m=await import('/src/features/media/application/media-outbox.ts')
    const rows=await m.listLocalMedia()
    return rows.find(row=>row.mediaType==='photo')!.mediaId
  })
  await page.getByTestId('browser-import-sheet-close').click()
  await page.getByTestId('browser-tab-personal').click()
  await expect(page.getByTestId('browser-personal-catalog-scope')).toBeVisible()
  await expect(row).toHaveCount(1)
  await page.getByTestId('browser-tab-assignments').click()
  await expect(row).toHaveCount(0)
  await page.getByTestId('browser-tab-active').click()
  await expect(row).toHaveCount(1)
  await row.getByRole('combobox',{name:'Папка файла '+id})
    .selectOption({label:'Encrypted covers'})
  await expect(row).toHaveCount(0)

  const folder=page.locator('.browser-folder-item').filter({
    has:page.getByRole('button',{name:'Encrypted covers',exact:true}),
  })
  const thumb=folder.getByTestId('browser-folder-thumb')
  await expect(thumb).toBeVisible({timeout:30000})
  await expect(folder.locator('.browser-folder-cover-cell')).toHaveCount(4)
  const objectURL=await thumb.getAttribute('src')
  expect(objectURL).toMatch(/^blob:/)
  await expect.poll(()=>thumb.evaluate(
    node=>(node as HTMLImageElement).naturalWidth),{
    timeout:20000,
  }).toBe(96)
  // Never store an objectURL, source filename, original photo, thumbnail or
  // decrypted metadata in browser localStorage to fake persistence.
  const plaintext=await page.evaluate(()=>Object.values(localStorage).join(' '))
  expect(plaintext).not.toContain('LOCAL-ONLY-PRIVATE-COVER')
  expect(plaintext).not.toContain(objectURL!)

  await page.evaluate(()=>{
    const revoked:string[]=[]
    const original=URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL=(url:string)=>{
      revoked.push(url);original(url)
    }
    ;(window as Window&{__folderThumbnailRevoked?:string[]}).__folderThumbnailRevoked=revoked
  })
  await page.getByRole('button',{name:'Encrypted covers',exact:true}).click()
  await expect(thumb).toHaveCount(0)
  await expect(row).toHaveCount(1)
  const fileThumb=row.getByTestId('browser-file-thumb')
  await expect(fileThumb).toBeVisible()
  expect(await fileThumb.getAttribute('src')).toBe(objectURL)
  // One objectURL is shared between the folder cover and the authenticated
  // file row, then explicitly revoked when leaving Browser entirely.
  await page.locator('.shell-dock a[href="/camera"]').click()
  await page.waitForFunction(url=>
    (window as Window&{__folderThumbnailRevoked?:string[]})
      .__folderThumbnailRevoked?.includes(url),objectURL)
  // The original E2EE file is still available; disposing the thumbnail
  // must NOT remove or decrypt any durable outbox ciphertext.
  await page.goto('/browser')
  await expect(page.getByTestId('browser-header-folder')).toBeEnabled()
  const recovered=await page.evaluate(async mediaId=>{
    const m=await import('/src/features/media/application/media-outbox.ts')
    const media=await m.readLocalMedia(mediaId)
    return {name:media.metadata.fileName,mime:media.blob.type,bytes:media.blob.size}
  },id)
  expect(recovered).toMatchObject({
    name:'LOCAL-ONLY-PRIVATE-COVER.png',mime:'image/png',
  })
  expect(recovered.bytes).toBeGreaterThan(0)
})
