import {expect,test} from '@playwright/test'

test('Browser v3: per-photo share opens existing key-verified E2EE flow, not an unrestricted link',async({page})=>{
  test.setTimeout(120000)
  await page.setViewportSize({width:390,height:844})
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.locator('[data-testid="shell-status-link"][data-session-state="online"]')).toBeVisible()

  const photoId=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas')
    canvas.width=80;canvas.height=80
    const ctx=canvas.getContext('2d')
    if(!ctx)throw Error('canvas_unsupported')
    ctx.fillStyle='#164f36';ctx.fillRect(0,0,80,80)
    ctx.fillStyle='#c79267';ctx.fillRect(12,18,45,49)
    const jpeg=await new Promise<Blob>((resolve,reject)=>{
      canvas.toBlob(blob=>blob?resolve(blob):reject(Error('jpeg_failed')),'image/jpeg',0.85)
    })
    const outbox=await import('/src/features/photo-sync/application/p1-photo.ts')
    const photo=await outbox.captureEncrypted(jpeg)
    return photo.photoId
  })
  await page.goto('/browser')
  const row=page.getByTestId('browser-row-photo:'+photoId)
  await expect(row).toBeVisible({timeout:30000})
  const toggle=row.getByTestId('browser-file-menu-toggle')
  await toggle.click()
  await row.getByRole('button',{name:'Поделиться файлом '+photoId}).click()
  const sheet=page.getByTestId('browser-photo-share-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet).toHaveAttribute('role','dialog')
  await expect(sheet).toHaveAttribute('aria-modal','true')
  await expect(page.getByTestId('browser-photo-share-close')).toBeFocused()
  await expect(sheet.locator('.share-panel')).toBeVisible()
  await expect(sheet.getByRole('heading',{name:'Полученные фотографии'})).toHaveCount(0)
  await expect(sheet.getByRole('heading',{name:'Исходящие разрешения'})).toBeVisible()
  // A local queued ciphertext is not a sent grant or a shareable public URL.
  await expect(sheet).toContainText('сверки ключа получателя')
  await expect(sheet.getByText('Отпечаток получателя')).toHaveCount(0)
  await page.getByTestId('browser-photo-share-close').press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(toggle).toBeFocused()
  // No new grant, account switch, or plaintext URL is created by opening UI.
  const grants=await page.evaluate(async()=>{
    const m=await import('/src/features/sharing/grant-flow.ts')
    return (await m.listOutgoingGrants()).length
  })
  expect(grants).toBe(0)
})
