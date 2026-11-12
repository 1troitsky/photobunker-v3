import {test,expect} from '@playwright/test'

test('P2 V-41: File Viewer fixed mobile/desktop geometry, media switching and accessible sheets',async({browser})=>{
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
    const picker=page.getByTestId('media-import-file')
    await picker.setInputFiles({
      name:'SCENE-PRIVATE-AUDIO.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(8192,0x52),
    })
    await expect(page.locator('[data-testid^="browser-row-media:"]'))
      .toHaveCount(1,{timeout:30000})
    await picker.setInputFiles({
      name:'SCENE-PRIVATE-VIDEO.webm',mimeType:'video/webm',
      buffer:Buffer.alloc(8192,0x53),
    })
    await expect(page.locator('[data-testid^="browser-row-media:"]'))
      .toHaveCount(2,{timeout:30000})
    const ids=await page.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const result:{type:string;id:string}[]=[]
      for(const item of await m.listLocalMedia())
        result.push({type:item.mediaType,id:item.mediaId})
      return result
    })
    const audioId=ids.find(x=>x.type==='audio')?.id
    const videoId=ids.find(x=>x.type==='video')?.id
    expect(audioId).toBeTruthy()
    expect(videoId).toBeTruthy()

    const geometry=()=>page.evaluate(()=>{
      const rect=(selector:string)=>{
        const node=document.querySelector<HTMLElement>(selector)
        if(!node)throw Error('missing '+selector)
        const r=node.getBoundingClientRect()
        return {top:Math.round(r.top),height:Math.round(r.height),
          bottom:Math.round(r.bottom)}
      }
      return {
        header:rect('.shell-header'),dock:rect('.shell-dock'),
        path:rect('.file-viewer-path'),stage:rect('.file-viewer-stage'),
        summary:rect('.file-viewer-summary'),actions:rect('.file-viewer-actions'),
        pager:rect('.file-viewer-navigation'),
        main:rect('.shell-main'),
      }
    })
    const assertGrid=(g:Awaited<ReturnType<typeof geometry>>)=>{
      expect(g.header.height).toBe(64)
      // The actual dock can include an OS safe area, but never shifts on media change.
      expect(g.dock.height).toBe(82)
      expect(g.path.height).toBe(45)
      expect(g.summary.height).toBe(114)
      expect(g.actions.height).toBe(57)
      expect(g.pager.height).toBe(48)
      expect(g.stage.height).toBeGreaterThan(100)
      expect(g.path.top).toBe(g.header.bottom)
      expect(g.stage.top).toBe(g.path.bottom)
      expect(g.summary.top).toBe(g.stage.bottom)
      expect(g.actions.top).toBe(g.summary.bottom)
      expect(g.pager.top).toBe(g.actions.bottom)
      expect(g.pager.bottom).toBe(g.dock.top)
    }

    for(const size of [{width:390,height:844},{width:1280,height:800}]){
      await page.setViewportSize(size)
      await page.goto('/browser/file/media/'+audioId)
      await expect(page.getByTestId('file-viewer-audio')).toBeVisible()
      const before=await geometry()
      assertGrid(before)
      const chrome=page.getByTestId('viewer-shell-actions')
      await expect(chrome.locator('button')).toHaveCount(4)
      await expect(chrome.getByRole('button',{name:'Избранное'})).toBeDisabled()
      await expect(chrome.getByRole('button',{name:'Копировать'})).toBeDisabled()
      await expect(chrome.getByRole('button',{name:'Скачать'})).toBeEnabled()
      await expect(chrome.getByRole('button',{name:'Удалить'})).toBeDisabled()
      await expect(page.getByTestId('file-viewer').locator('.shell-header'))
        .toHaveCount(0)
      await expect(page.getByTestId('file-viewer-path').getByRole('button'))
        .toHaveCount(0)
      await expect(page.getByRole('button',{name:'Публичная карточка'}))
        .toBeDisabled()
      await page.getByTestId('viewer-action-info').click()
      await expect(page.getByRole('dialog',{name:'Информация о файле'}))
        .toBeVisible()
      await expect(page.getByTestId('file-viewer-info'))
        .toContainText('SCENE-PRIVATE-AUDIO.wav')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog',{name:'Информация о файле'}))
        .toBeHidden()
      await expect(page.getByTestId('viewer-action-info')).toBeFocused()
      await page.getByTestId('viewer-action-edit').click()
      await expect(page.getByTestId('file-viewer-audio-editor')).toBeVisible()
      await page.getByTestId('viewer-panel-close').click()
      await expect(page.getByTestId('viewer-action-edit')).toBeFocused()
      expect(await geometry()).toEqual(before)

      await page.goto('/browser/file/media/'+videoId)
      await expect(page.getByTestId('file-viewer-video')).toBeVisible()
      const after=await geometry()
      expect(after).toEqual(before)
      assertGrid(after)
    }
    // The Header action bridge must disappear outside the viewer route.
    await page.goto('/settings')
    await expect(page.getByTestId('viewer-shell-actions')).toHaveCount(0)
  }finally{await context.close()}
})
