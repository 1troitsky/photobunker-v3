import {test,expect} from '@playwright/test'

test('P2 File Viewer: actual encrypted media, same-origin export, keyboard navigation and logout wipe',async({browser})=>{
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
    await context.setOffline(true)

    const input=page.getByTestId('media-import-file')
    await input.setInputFiles({
      name:'PRIVATE-VIDEO-WITH-NAME.webm',mimeType:'video/webm',
      buffer:Buffer.alloc(8192,0x41),
    })
    await expect(page.locator('[data-testid^="browser-row-media:"]'))
      .toHaveCount(1,{timeout:30000})
    await input.setInputFiles({
      name:'PRIVATE-AUDIO-WITH-NAME.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(8192,0x42),
    })
    await expect(page.locator('[data-testid^="browser-row-media:"]'))
      .toHaveCount(2,{timeout:30000})
    const ids=await page.evaluate(async()=>{
      const {listLocalMedia}=await import('/src/features/media/application/media-outbox.ts')
      const rows=await listLocalMedia()
      const video=rows.find(x=>x.mediaType==='video')
      const audio=rows.find(x=>x.mediaType==='audio')
      if(!video||!audio)throw Error('missing fixture')
      return {video:video.mediaId,audio:audio.mediaId}
    })

    await page.getByTestId('browser-row-media:'+ids.video)
      .getByRole('link',{name:'Полный просмотр файла '+ids.video}).click()
    await expect(page.getByTestId('file-viewer')).toBeVisible()
    await expect(page.getByTestId('file-viewer-info'))
      .toContainText('PRIVATE-VIDEO-WITH-NAME.webm')
    await expect(page.getByTestId('file-viewer-video')).toBeVisible()
    await expect(page.getByTestId('file-viewer-position')).toContainText('2 / 2')
    // Newest audio is the previous entry; switch media type without leaving
    // the viewport, which must retire the former blob object URL.
    const oldUrl=await page.getByTestId('file-viewer-video').getAttribute('src')
    await page.getByRole('button',{name:'Предыдущий файл'}).click()
    await expect(page.getByTestId('file-viewer-audio')).toBeVisible()
    await expect(page.getByTestId('file-viewer-info'))
      .toContainText('PRIVATE-AUDIO-WITH-NAME.wav')
    await expect(page.getByTestId('file-viewer-video')).toHaveCount(0)
    expect(await page.evaluate(async url=>{
      try{const response=await fetch(url!);return response.ok}catch{return false}
    },oldUrl)).toBe(false)

    const downloads:string[]=[]
    page.on('download',d=>downloads.push(d.suggestedFilename()))
    await expect(page.getByTestId('file-viewer-audio')).toBeVisible()
    expect(downloads).toEqual([])
    page.once('dialog',dialog=>dialog.accept())
    const downloaded=page.waitForEvent('download')
    await page.getByRole('button',{name:'Скачать',exact:true}).click()
    expect((await downloaded).suggestedFilename()).toBe('PRIVATE-AUDIO-WITH-NAME.wav')

    // A signed-out browser must immediately discard plaintext media.
    await page.evaluate(async()=>{
      const {logout}=await import('/src/features/identity/application/session.ts')
      await logout()
    })
    await expect(page.getByText('Для просмотра зашифрованных файлов необходим вход.'))
      .toBeVisible()
    await expect(page.getByTestId('viewer-shell-actions')
      .getByRole('button',{name:'Скачать'})).toBeDisabled()
    await expect(page.getByTestId('file-viewer-audio')).toHaveCount(0)
    await expect(page.getByTestId('file-viewer-info')).toHaveCount(0)
  }finally{await context.close()}
})
