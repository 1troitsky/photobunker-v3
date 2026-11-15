import {expect,test} from '@playwright/test'

test('Browser v3: file and encrypted-folder three-dot actions use original local operations',async({page,context})=>{
  test.setTimeout(120000)
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  await page.goto('/browser')
  await page.getByTestId('browser-header-folder').click()
  await page.getByTestId('browser-folder-name').fill('Private Actions')
  await page.getByRole('button',{name:'Создать',exact:true}).click()
  await expect(page.getByRole('button',{name:'Private Actions',exact:true}))
    .toBeVisible()

  await context.setOffline(true)
  await page.getByTestId('media-import-file').setInputFiles({
    name:'ACTION-ENCRYPTED.wav',mimeType:'audio/wav',
    buffer:Buffer.alloc(8192,0x43),
  })
  const row=page.locator('[data-testid^="browser-row-media:"]')
  await expect(row).toHaveCount(1,{timeout:25000})
  const mediaId=(await row.getAttribute('data-testid'))!.split(':')[1]!
  const trigger=row.getByTestId('browser-file-menu-toggle')
  await expect(trigger).toHaveAttribute('aria-expanded','false')
  await expect(row.getByTestId('browser-file-menu-panel')).toHaveCount(0)
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded','true')
  const panel=row.getByTestId('browser-file-menu-panel')
  await expect(panel).toHaveAttribute('role','dialog')
  await expect(panel.getByRole('link',{
    name:'Полный просмотр файла '+mediaId,
  })).toBeVisible()
  await expect(panel.getByRole('combobox',{
    name:'Папка файла '+mediaId,
  })).toBeVisible()
  await panel.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await page.getByTestId('browser-tab-personal').click()
  await expect(panel).toHaveCount(0)
  await page.getByTestId('browser-tab-active').click()
  await trigger.click()
  await panel.getByRole('combobox',{name:'Папка файла '+mediaId})
    .selectOption({label:'Private Actions'})
  await expect(row).toHaveCount(0)
  await page.getByRole('button',{name:'Private Actions',exact:true}).click()
  await expect(row).toHaveCount(1)

  const folderTrigger=page.getByRole('button',{
    name:'Действия с папкой Private Actions',
  })
  await expect(folderTrigger).toHaveAttribute('aria-expanded','false')
  await folderTrigger.click()
  const folderPanel=page.getByTestId('browser-folder-menu-panel')
  await expect(folderPanel).toHaveAttribute('role','dialog')
  await expect(folderPanel.getByRole('button',{
    name:'Переименовать Private Actions',
  })).toBeVisible()
  await expect(folderPanel.getByRole('combobox',{
    name:'Переместить папку Private Actions',
  })).toBeVisible()
  await folderPanel.press('Escape')
  await expect(folderPanel).toHaveCount(0)
  await expect(folderTrigger).toBeFocused()

  // The original encrypted media and folder placement are not modified
  // by opening or dismissing presentation-only action menus.
  const result=await page.evaluate(async id=>{
    const media=await import('/src/features/media/application/media-outbox.ts')
    const item=(await media.listLocalMedia()).find(x=>x.mediaId===id)!
    return {size:item.plainBytes,state:item.state}
  },mediaId)
  expect(result).toEqual({size:8192,state:'queued'})
  const storage=await page.evaluate(()=>Object.values(localStorage).join(' '))
  expect(storage).not.toContain('Private Actions')
  expect(storage).not.toContain('ACTION-ENCRYPTED.wav')
})
