import {openImportSheet} from './helpers/browser-import'
import {mediaImportViews} from './helpers/browser-import'
import {browserHeader,filterBrowser} from './support/browser-ui'
import {searchBrowser,sortBrowser} from './support/browser-ui'
import {test,expect} from '@playwright/test'
import type {Locator} from '@playwright/test'

async function ensureFileMenu(row:Locator):Promise<void>{
  if(await row.getByTestId('browser-file-menu-panel').count()===0)
    await row.getByTestId('browser-file-menu-toggle').click()
}

// Hard navigation remounts the app before signed device reproof completes.
// Private offline writes require the same registered account and device,
// verified online by BOTH the client and the actual backend first.
async function awaitVerifiedCatalogSession(
  page:import('@playwright/test').Page,
  expected:{accountId:string;deviceId:string},
):Promise<void>{
  await expect.poll(()=>page.evaluate(async expected=>{
    const identity=await import('/src/features/identity/application/session.ts')
    const current=identity.activeSession.value
    if(!current)return 'device-unsealing'
    if(current.accountId!==expected.accountId||current.deviceId!==expected.deviceId)
      throw Error('qa404.wrong_local_account_or_device')
    if(!current.online)return 'signed-login-pending'
    const response=await fetch('/identity/v2/me',{
      credentials:'same-origin',cache:'no-store',
    })
    if(!response.ok)return 'server-session-'+response.status
    const proof=await response.json() as {accountId:string;deviceId:string}
    if(proof.accountId!==expected.accountId||proof.deviceId!==expected.deviceId)
      throw Error('qa404.wrong_server_account_or_device')
    return 'verified'
  },expected),{timeout:30_000}).toBe('verified')
}

test('P2 Browser v3: real anonymous login → offline encrypted media → catalog filters and decrypted viewer',async({browser})=>{
  test.setTimeout(120000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.locator('[data-testid="shell-status-link"][data-session-state="online"]')).toBeVisible()
    const registered=await page.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      const current=identity.requireSession()
      if(!current.online)throw Error('qa404.registration_unproved')
      return {accountId:current.accountId,deviceId:current.deviceId}
    })
    await page.goto('/browser')
    await expect(page.getByTestId('browser-v3')).toBeVisible()
    await expect(page.locator('.browser-heading-copy>small')).toContainText('0 фото')
    await awaitVerifiedCatalogSession(page,registered)

    await context.setOffline(true)
    // Owner-approved Browser v3: import is opened from Header as one sheet.
    await browserHeader(page,'upload')
    await expect(page.getByTestId('browser-import-sheet')).toBeVisible()
    await openImportSheet(page.getByTestId('media-import-file').page())
    await page.getByTestId('media-import-file').setInputFiles({
      name:'PRIVATE-VIDEO-TEST.webm',mimeType:'video/webm',
      buffer:Buffer.alloc(8192,0x42),
    })
    await expect(mediaImportViews(page)
      .getByText('Файл зашифрован и сохранён', {exact:false}))
      .toBeVisible()
    // Independently verify durable account-scoped AES-GCM ciphertext in IDB:
    // a visible toast alone is not evidence that the encrypted write committed.
    const saved=await page.evaluate(async accountId=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const items=await media.listLocalMedia()
      if(items.length!==1)throw Error('qa404.encrypted_outbox_missing')
      const row=items[0]!
      return {
        accountCorrect:row.accountId===accountId
          &&row.contract.accountId===accountId,
        kind:row.mediaType,plainBytes:row.plainBytes,state:row.state,
        ciphertextDurable:row.chunks.length>=2&&row.chunks.every(chunk=>
          chunk.blob instanceof Blob&&chunk.blob.size===chunk.bytes
          &&chunk.bytes>chunk.plainBytes
          &&/^[0-9a-f]{64}$/.test(chunk.sha256)),
        noPrivateName:!JSON.stringify(row).includes('PRIVATE-VIDEO-TEST.webm'),
      }
    },registered.accountId)
    expect(saved).toEqual({
      accountCorrect:true,kind:'video',plainBytes:8192,state:'queued',
      ciphertextDurable:true,noPrivateName:true,
    })
    const rows=page.locator('[data-testid^="browser-row-media:"]')
    await expect(rows).toHaveCount(1,{timeout:25000})
    await expect(rows.first()).toContainText(/на устройстве/i)
    await expect(rows.first()).toHaveAttribute('data-sync-state','queued')
    await page.getByTestId('browser-import-sheet-close').click()
    await expect(page.getByTestId('browser-import-sheet')).toBeHidden()

    await filterBrowser(page,'photo')
    await expect(rows).toHaveCount(0)
    await filterBrowser(page,'video')
    await expect(rows).toHaveCount(1)
    await searchBrowser(page,'NOT-THIS-ID')
    await expect(rows).toHaveCount(0)
    await searchBrowser(page,'')
    await page.getByRole('button',{name:'Сетка',exact:true}).click()
    await expect(page.getByTestId('browser-catalog')).toHaveClass(/browser-grid/)
    await ensureFileMenu(rows.first())
    await rows.first().getByRole('button',{name:/Открыть файл/}).click()
    const preview=page.getByTestId('browser-preview')
    await expect(preview).toContainText('PRIVATE-VIDEO-TEST.webm')
    await expect(preview.locator('video')).toBeVisible()
    await preview.getByRole('button',{name:'Закрыть просмотр'}).click()
    await expect(preview).toHaveCount(0)

    // Reload a live document then disconnect again: encrypted IndexedDB
    // survives reload. Cold offline app boot is a separate signed-PWA gate.
    await context.setOffline(false)
    await page.reload()
    await awaitVerifiedCatalogSession(page,registered)
    await context.setOffline(true)
    await expect(page.getByTestId('browser-v3')).toBeVisible()
    await expect(page.locator('[data-testid^="browser-row-media:"]')).toHaveCount(1)
  }finally{await context.close()}
})

test('P2 Browser: sort two genuinely encrypted offline files by confirmed byte size',async({browser})=>{
  test.setTimeout(90000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.locator('[data-testid="shell-status-link"][data-session-state="online"]')).toBeVisible()
    const registered=await page.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      const current=identity.requireSession()
      if(!current.online)throw Error('qa404.registration_unproved')
      return {accountId:current.accountId,deviceId:current.deviceId}
    })
    await page.goto('/browser')
    await awaitVerifiedCatalogSession(page,registered)
    await context.setOffline(true)
    await browserHeader(page,'upload')
    const picker=page.getByTestId('media-import-file')
    await picker.setInputFiles({
      name:'LOCAL-SMALL.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(8192,0x45),
    })
    const rows=page.locator('[data-testid^="browser-row-media:"]')
    await expect(rows).toHaveCount(1,{timeout:25000})
    await picker.setInputFiles({
      name:'LOCAL-LARGE.webm',mimeType:'video/webm',
      buffer:Buffer.alloc(32768,0x41),
    })
    await expect(rows).toHaveCount(2,{timeout:25000})
    const bySize=await page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const items=await media.listLocalMedia()
      if(items.length!==2)throw Error('expected two locally encrypted assets')
      return items.sort((a,b)=>b.plainBytes-a.plainBytes).map(x=>x.mediaId)
    })
    await sortBrowser(page,'size-largest')
    await expect(rows.first()).toHaveAttribute('data-testid','browser-row-media:'+bySize[0])
    await expect(rows.last()).toHaveAttribute('data-testid','browser-row-media:'+bySize[1])
    await expect(rows.first()).toHaveAttribute('data-plain-bytes','32768')
    await sortBrowser(page,'size-smallest')
    await expect(rows.first()).toHaveAttribute('data-testid','browser-row-media:'+bySize[1])
    await expect(rows.first()).toHaveAttribute('data-plain-bytes','8192')
    // Sort never modifies encrypted files, their account or durable outbox.
    expect(await page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia()).map(x=>x.plainBytes).sort((a,b)=>a-b)
    })).toEqual([8192,32768])
  }finally{await context.close()}
})
