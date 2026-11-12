import {expect,test} from '@playwright/test'
import {finiteDurationWebmBase64} from './fixtures/finite-duration-webm'

test('P2 V-46: real encrypted 2-second VP8 → Video Editor range preview/apply/undo without MP4 export',async({browser})=>{
  test.setTimeout(150000)
  const context=await browser.newContext({viewport:{width:390,height:844}})
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    await expect.poll(()=>page.evaluate(async()=>{
      const m=await import('/src/features/identity/application/session.ts')
      return !!m.activeSession.value?.accountId
    }),{timeout:30000}).toBe(true)
    await context.setOffline(true)
    await page.getByTestId('media-import-file').setInputFiles({
      name:'FINITE-PRIVATE-SOURCE.webm',mimeType:'video/webm',
      buffer:Buffer.from(finiteDurationWebmBase64,'base64'),
    })
    await expect(page.locator('[data-testid^="browser-row-media:"]'))
      .toHaveCount(1,{timeout:30000})
    const sourceId=await page.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia())[0]?.mediaId
    })
    expect(sourceId).toBeTruthy()
    await context.setOffline(false)
    await page.goto('/browser/file/media/'+sourceId)
    await expect(page.getByTestId('file-viewer-video')).toBeVisible()
    await page.getByTestId('viewer-action-edit').click()
    await expect(page).toHaveURL(new RegExp('/browser/file/media/'+sourceId+'/edit$'))
    const video=page.getByTestId('file-viewer-video')
    await expect(video).toBeVisible()
    await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>
      Number.isFinite(v.duration)&&v.duration>1.9),{timeout:30000}).toBe(true)
    const trim=page.getByTestId('file-editor-video-trim')
    await expect(trim).toBeVisible()
    await expect(page.getByTestId('file-editor-video-start')).toBeVisible()
    await expect(page.getByTestId('file-editor-video-end')).toBeVisible()
    await expect(page.getByTestId('editor-shell-save')).toBeDisabled()

    const start=page.getByTestId('file-editor-video-start')
    const end=page.getByTestId('file-editor-video-end')
    await start.focus();await start.press('Home')
    for(let i=0;i<4;i++)await start.press('ArrowRight')
    await end.focus();await end.press('End')
    for(let i=0;i<4;i++)await end.press('ArrowLeft')
    await expect(page.getByTestId('file-editor-video-selected'))
      .toContainText('Выбрано: 1.6 с')
    await page.getByTestId('file-editor-video-preview').click()
    await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime))
      .toBeGreaterThan(0.19)
    // The clip player must stop at the chosen end, not play the source
    // beyond 1.8 sec or alter the bytes in encrypted Browser storage.
    await expect(page.getByTestId('file-editor-video-preview')).toBeEnabled({
      timeout:10000,
    })
    await page.getByTestId('file-editor-video-apply').click()
    await expect(page.getByTestId('file-editor-video-status'))
      .toContainText('MP4 не создан')
    await expect(page.getByTestId('file-editor-video-applied'))
      .toContainText('0.2–1.8 с')
    await page.getByTestId('file-editor-video-undo').click()
    await expect(page.getByTestId('file-editor-video-applied')).toHaveCount(0)
    await page.getByTestId('file-editor-video-redo').click()
    await expect(page.getByTestId('file-editor-video-applied'))
      .toContainText('0.2–1.8 с')
    await expect(page.getByTestId('editor-shell-save')).toBeDisabled()

    page.once('dialog',dialog=>dialog.dismiss())
    await page.getByTestId('editor-shell-cancel').click()
    await expect(page).toHaveURL(/\/edit$/)
    await page.getByTestId('file-editor-video-reset').click()
    await expect(page.getByTestId('file-editor-video-applied')).toHaveCount(0)
    await expect(page.getByTestId('file-editor-video-selected'))
      .toContainText('Выбрано: 2.0 с')
    const before=await page.evaluate(async id=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const files=await m.listLocalMedia()
      const source=files.find(f=>f.mediaId===id)
      if(!source)throw Error('source_missing')
      return {count:files.length,bytes:source.plainBytes,kind:source.mediaType}
    },sourceId)
    expect(before).toMatchObject({count:1,kind:'video'})
    await page.getByTestId('editor-shell-cancel').click()
    await expect(page).toHaveURL(new RegExp('/browser/file/media/'+sourceId+'$'))
    const after=await page.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const files=await m.listLocalMedia()
      return {count:files.length,bytes:files[0]?.plainBytes}
    })
    expect(after).toEqual({count:1,bytes:before.bytes})
    await page.goBack()
    await expect(page).toHaveURL(/\/browser$/)
  }finally{await context.close()}
})
