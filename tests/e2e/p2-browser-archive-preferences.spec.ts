import {expect,test} from '@playwright/test'
import type {Locator} from '@playwright/test'

async function ensureFileMenu(row:Locator):Promise<void>{
  if(await row.getByTestId('browser-file-menu-panel').count()===0)
    await row.getByTestId('browser-file-menu-toggle').click()
}

test('P2 Browser: Local-First signed archive settings, independent-device recovery, no auto-TTL extension and direct delete',async({browser})=>{
  test.setTimeout(185000)
  const aContext=await browser.newContext(),bContext=await browser.newContext()
  const a=await aContext.newPage(),b=await bContext.newPage()
  try{
    await a.goto('/settings')
    await a.getByRole('button',{name:'Создать ключ'}).click()
    const recoveryKey=await a.locator('#generated-key').inputValue()
    await a.getByLabel('Я сохранил ключ восстановления').check()
    await a.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(a.getByText('Подтверждённая сессия')).toBeVisible()
    await a.goto('/browser')
    await a.getByTestId('browser-header-settings').click()
    await expect(a.getByTestId('browser-pref-use-archive')).toBeChecked()
    await expect(a.getByTestId('browser-pref-auto-delete')).toBeChecked()
    await expect(a.getByTestId('browser-pref-unconfirmed')).toHaveCount(0)
    await a.getByTestId('browser-pref-auto-delete').uncheck()
    await expect(a.getByTestId('browser-pref-status'))
      .toContainText('подтверждены сервером',{timeout:20000})
    const pref=await a.evaluate(async()=>{
      const r=await fetch('/browser/v1/archive/preferences')
      return r.json() as Promise<{revision:number;useArchive:boolean;
        autoDeleteAfter7Days:boolean;writeEnabled:boolean;autoCleanupEnabled:boolean}>
    })
    expect(pref).toMatchObject({revision:1,useArchive:true,
      autoDeleteAfter7Days:false,writeEnabled:true,autoCleanupEnabled:false})
    await a.getByTestId('browser-settings-close').click()

    // A second browser with its own nonextractable device key recovers the
    // account and sees the authoritative owner-signed policy.
    await b.goto('/settings')
    await b.locator('#recovery-key').fill(recoveryKey)
    await b.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(b.getByText('Подтверждённая сессия')).toBeVisible()
    await b.goto('/browser')
    await b.getByTestId('browser-header-settings').click()
    await expect(b.getByTestId('browser-pref-auto-delete')).not.toBeChecked()
    await expect(b.getByTestId('browser-pref-use-archive')).toBeChecked()
    await expect(b.getByTestId('browser-pref-unconfirmed')).toHaveCount(0)
    await b.getByTestId('browser-settings-close').click()

    await a.getByTestId('media-import-file').setInputFiles({
      name:'PRIVATE-PREF-VOICE.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(8192,0x31),
    })
    await expect(a.locator('[data-testid^="browser-row-media:"]'))
      .toHaveCount(1,{timeout:30000})
    await a.locator('.media-import-p1').getByRole('button',{name:'Отправить медиа'}).click()
    await a.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      await m.synchronizeMedia()
    })
    await expect.poll(()=>a.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).filter(x=>x.state==='synced').length
    }),{timeout:30000}).toBe(1)
    await a.getByRole('button',{name:'Обновить',exact:true}).first().click()
    const row=a.locator('[data-testid^="browser-row-media:"]')
    await ensureFileMenu(row)
    await expect(row.getByRole('button',{name:/Архивировать файл/})).toBeVisible()
    const assetId=(await row.getAttribute('data-testid'))!
      .slice('browser-row-media:'.length)
    a.once('dialog',d=>d.accept())
    await ensureFileMenu(row)
    await row.getByRole('button',{name:/Архивировать файл/}).click()
    await expect(a.getByTestId('browser-archive-status'))
      .toContainText('помещён в архив',{timeout:20000})
    const archive=await a.evaluate(async id=>{
      const r=await fetch('/browser/v1/archive')
      const x=await r.json() as {items:Array<{
        assetId:string;archiveUntilMs:number|null;state:string;physicalStatus:string
      }>}
      return x.items.find(item=>item.assetId===id)
    },assetId)
    expect(archive).toMatchObject({
      assetId,state:'archived',archiveUntilMs:null,physicalStatus:'not_started',
    })
    await a.getByTestId('browser-tab-archive').click()
    await ensureFileMenu(row)
    await row.getByRole('button',{name:/Восстановить файл/}).click()
    await expect(a.getByTestId('browser-archive-status'))
      .toContainText('восстановлен из архива',{timeout:20000})
    await a.getByTestId('browser-tab-active').click()
    await expect(row).toHaveCount(1)

    // Signed policy opts out of archive; direct owner-confirmed deletion
    // now creates a tombstone, never claims verified physical GC.
    await a.getByTestId('browser-header-settings').click()
    await a.getByTestId('browser-pref-use-archive').uncheck()
    await expect(a.getByTestId('browser-pref-status'))
      .toContainText('подтверждены сервером',{timeout:20000})
    await a.getByTestId('browser-settings-close').click()
    await ensureFileMenu(row)
    await expect(row.getByRole('button',{name:/Запросить прямое удаление файла/}))
      .toBeVisible()
    a.once('dialog',d=>d.accept())
    await row.getByRole('button',{name:/Запросить прямое удаление файла/}).click()
    await expect(a.getByTestId('browser-archive-status'))
      .toContainText('физическая очистка S3 ещё НЕ подтверждена',{timeout:20000})
    // Accepted Browser v3 hides the Archive tab when the owner disables it.
    // UI hiding NEVER constitutes deletion proof or extends any signed TTL.
    await expect(a.getByTestId('browser-tab-archive')).toHaveCount(0)
    const tombstone=await a.evaluate(async id=>{
      const r=await fetch('/browser/v1/archive')
      const data=await r.json() as {items:Array<{
        assetId:string;state:string;physicalStatus:string
      }>}
      return data.items.find(item=>item.assetId===id)
    },assetId)
    expect(tombstone).toMatchObject({
      assetId,state:'deleting',physicalStatus:'pending_gc',
    })

    // With remote network absent, the option toggles locally, but no
    // destructive action is authorized until a signed server ACK.
    await aContext.setOffline(true)
    await a.getByTestId('browser-header-settings').click()
    await a.getByTestId('browser-pref-use-archive').check()
    await expect(a.getByTestId('browser-pref-unconfirmed')).toBeVisible()
    await expect(a.getByTestId('browser-pref-status'))
      .toContainText('Ожидает подтверждения сервера.')
    await a.getByTestId('browser-settings-close').click()
    // Vite's dev server is deliberately not an offline Service Worker
    // acceptance environment. Restore the network but fail preference
    // requests across a reload to verify device-encrypted draft durability.
    await aContext.setOffline(false)
    await a.route('**/browser/v1/archive/preferences',route=>route.abort('failed'))
    await a.reload()
    await a.getByTestId('browser-header-settings').click()
    await expect(a.getByTestId('browser-pref-use-archive')).toBeChecked()
    await expect(a.getByTestId('browser-pref-unconfirmed')).toBeVisible()
    await a.unroute('**/browser/v1/archive/preferences')
    await a.getByTestId('browser-pref-sync').click()
    await expect(a.getByTestId('browser-pref-unconfirmed'))
      .toHaveCount(0,{timeout:20000})
    await a.getByTestId('browser-settings-close').click()
    const after=await a.evaluate(async()=>{
      const r=await fetch('/browser/v1/archive/preferences')
      return r.json() as Promise<{useArchive:boolean;autoDeleteAfter7Days:boolean}>
    })
    expect(after).toMatchObject({useArchive:true,autoDeleteAfter7Days:false})
  }finally{
    await aContext.close();await bContext.close()
  }
})
