import {openImportSheet} from './helpers/browser-import'
import {mediaImportViews,openImportTools} from './helpers/browser-import'
import {browserControl,browserHeader,searchBrowser} from './support/browser-ui'
import {expect,test} from '@playwright/test'

test('P2 Browser: offline private metadata search and second-device cloud search without plaintext disclosure',async({browser})=>{
  test.setTimeout(170000)
  const aContext=await browser.newContext(),bContext=await browser.newContext()
  const a=await aContext.newPage(),b=await bContext.newPage()
  const secret='PRIVATE-SEARCH-SAMPLE'
  try{
    await a.goto('/settings')
    await a.getByRole('button',{name:'Создать ключ'}).click()
    const recoveryKey=await a.locator('#generated-key').inputValue()
    await a.getByLabel('Я сохранил ключ восстановления').check()
    await a.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(a.locator('[data-testid="shell-status-link"][data-session-state="online"]')).toBeVisible()
    await a.goto('/browser')
    await expect(a.getByTestId('browser-v3')).toBeVisible()
    // Owner-approved Browser v3 places private upload controls in the
    // Header-triggered sheet; none are visible beneath the catalog.
    await browserHeader(a,'upload')
    await expect(a.getByTestId('browser-import-sheet')).toBeVisible()
    await openImportTools(a)
    await a.locator('#media-import-category').fill('Полевые отчёты')
    await a.locator('#media-import-description').fill('Секретная заметка для клиента')
    await a.locator('#media-import-tags').fill('evidence, night')
    await aContext.setOffline(true)
    // Changing online state must not erase a user's unsent private evidence.
    await expect(a.locator('#media-import-category')).toHaveValue('Полевые отчёты')
    await expect(a.locator('#media-import-description'))
      .toHaveValue('Секретная заметка для клиента')
    await expect(a.locator('#media-import-tags')).toHaveValue('evidence, night')
    await openImportSheet(a.getByTestId('media-import-file').page())
    await a.getByTestId('media-import-file').setInputFiles({
      name:secret+'.wav',mimeType:'audio/wav',
      buffer:Buffer.alloc(8192,0x42),
    })
    const rows=a.locator('[data-testid^="browser-row-media:"]')
    await expect(rows).toHaveCount(1,{timeout:25000})
    await a.getByTestId('browser-import-sheet-close').click()
    await expect(a.getByTestId('browser-import-sheet')).toBeHidden()
    // Assert actual AEAD-decrypted persistence, not only UI search behavior.
    const metadata=await a.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const encrypted=await m.listLocalMedia()
      return m.readLocalMediaMetadata(encrypted[0]!.mediaId)
    })
    expect(metadata).toMatchObject({
      fileName:secret+'.wav',category:'Полевые отчёты',
      description:'Секретная заметка для клиента',
      tags:['evidence','night'],
    })
    await searchBrowser(a,secret)
    await expect(rows).toHaveCount(1,{timeout:15000})
    await expect(a.getByTestId('browser-private-search-status'))
      .toContainText('Проверено 1 из 1',{timeout:20000})
    for(const text of ['секретная заметка','полевые','evidence night']){
      await searchBrowser(a,text)
      await expect(a.getByTestId('browser-private-search-status'))
        .toContainText('Проверено 1 из 1',{timeout:20000})
      await expect(rows).toHaveCount(1)
    }
    await searchBrowser(a,'НЕСУЩЕСТВУЮЩЕЕ-ПОЛЕ')
    await expect(a.getByTestId('browser-private-search-status'))
      .toContainText('Все загруженные файлы проверены',{timeout:20000})
    await expect(rows).toHaveCount(0)
    await searchBrowser(a,'')
    await expect(rows).toHaveCount(1)

    // Search across virtual folders must not change encrypted placement or
    // send private keywords to the backend. Only loaded rows are in scope.
    const movedId=await a.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia())[0]!.mediaId
    })
    await a.getByRole('button',{name:'Новая папка'}).click()
    await a.getByTestId('browser-folder-name').fill('Секретный раздел')
    await a.getByRole('button',{name:'Создать папку',exact:true}).click()
    await rows.getByTestId('browser-file-menu-toggle').click()
    await rows.getByRole('combobox',{name:'Папка файла '+movedId})
      .selectOption({label:'Секретный раздел'})
    await expect(rows).toHaveCount(0)
    await searchBrowser(a,'секретная заметка')
    await expect(rows).toHaveCount(0)
    await a.getByTestId('browser-search-folder-scope').selectOption('all')
    await expect(a.getByTestId('browser-private-search-status'))
      .toContainText('Проверено 1 из 1',{timeout:20000})
    await expect(rows).toHaveCount(1)
    await expect(a.getByTestId('browser-search-result-folder'))
      .toHaveText('Папка: Секретный раздел')
    await a.getByTestId('browser-search-folder-scope').selectOption('current')
    await expect(rows).toHaveCount(0)
    await searchBrowser(a,'')

    await aContext.setOffline(false)
    await a.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      await m.synchronizeMedia()
    })
    await expect.poll(()=>a.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).filter(row=>row.state==='synced').length
    }),{timeout:30000}).toBe(1)

    await b.goto('/settings')
    await b.locator('#recovery-key').fill(recoveryKey)
    await b.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(b.locator('[data-testid="shell-status-link"][data-session-state="online"]')).toBeVisible()
    const requests:string[]=[]
    b.on('request',request=>{
      const url=request.url()
      if(url.includes('/media/v1')||url.includes('/photos/v1'))
        requests.push(url+(request.postData()??''))
    })
    await b.goto('/browser')
    const remote=b.locator('[data-testid^="browser-row-media:"]')
    await expect(remote).toHaveCount(1,{timeout:25000})
    await expect(remote.first()).toHaveAttribute('data-location','cloud')
    await searchBrowser(b,'секретная заметка')
    await expect(b.getByTestId('browser-private-search-status'))
      .toContainText('Проверено 1 из 1',{timeout:30000})
    await expect(remote).toHaveCount(1)
    // Authenticated ciphertext endpoints receive opaque UUIDs only.
    expect(requests.some(x=>x.includes('/manifests'))).toBe(true)
    expect(requests.filter(x=>x.includes('/chunks/'))).toHaveLength(1)
    expect(requests.join('\n')).not.toContain('секретная')
    expect(requests.join('\n')).not.toContain(secret)
    expect(requests.join('\n')).not.toContain('evidence')

    await searchBrowser(b,'night')
    await expect(b.getByTestId('browser-private-search-status'))
      .toContainText('Проверено 1 из 1',{timeout:30000})
    await expect(remote).toHaveCount(1)
    // V-33: explicit expanded search must NEVER silently broaden a
    // selected-folder search to "All" when wider authorized index pages
    // arrive. The recovered cloud row is in root; the new empty folder
    // cannot inherit that row's encrypted virtual placement.
    await browserHeader(b,'folder')
    await b.getByTestId('browser-folder-name').fill('Only This Private Folder')
    await b.getByRole('button',{name:'Создать папку',exact:true}).click()
    // A folder's actual encrypted IndexedDB commit is distinct from the
    // click. Wait for the new folder to be visible and durably discoverable
    // before selecting its private-search scope; otherwise a racing browser
    // hydration may leave the scope at 'current' and hide its target picker.
    await expect(b.getByRole('button',{name:'Only This Private Folder',exact:true}))
      .toBeVisible({timeout:20000})
    await expect.poll(()=>b.evaluate(async()=>{
      const folders=await import('/src/features/browser/application/folder-workspace.ts')
      return Object.values((await folders.loadFolderWorkspace()).folders)
        .some(row=>row.name==='Only This Private Folder')
    }),{timeout:20000}).toBe(true)
    await b.getByTestId('browser-search-folder-scope').selectOption('selected')
    await expect(b.getByTestId('browser-search-folder-scope')).toHaveValue('selected')
    await b.getByTestId('browser-search-folder-target')
      .selectOption({label:'Only This Private Folder'})
    await expect(remote).toHaveCount(0)
    await b.getByTestId('browser-private-search-expand').click()
    await expect(b.getByTestId('browser-expanded-search-status'))
      .toContainText('Индексы этих двух типов загружены полностью.',{timeout:30000})
    await expect(b.getByTestId('browser-search-folder-scope')).toHaveValue('selected')
    await expect(b.getByTestId('browser-search-folder-target'))
      .toHaveText('Only This Private Folder')
    await expect(remote).toHaveCount(0)
    await b.getByTestId('browser-search-folder-scope').selectOption('all')
    await expect(b.getByTestId('browser-private-search-status'))
      .toContainText('Проверено 1 из 1',{timeout:30000})
    await expect(remote).toHaveCount(1)
    expect(requests.join('\n')).not.toContain('секретная')
    expect(requests.join('\n')).not.toContain(secret)
    expect(requests.join('\n')).not.toContain('night')
    await searchBrowser(b,'NOT-A-PRIVATE-KEYWORD')
    await expect(b.getByTestId('browser-private-search-status'))
      .toContainText('Все загруженные файлы проверены',{timeout:30000})
    await expect(remote).toHaveCount(0)

    // V-35: the embedded MediaImportPanel is a SEPARATE catalog reader.
    // Return one REAL signed/ciphertext-authorized row twice to mimic a
    // stale/malicious index. The local-first UI must retain the previous
    // authentic cloud list and cursor, rather than accepting duplicated IDs.
    await browserHeader(b,'upload')
    const sheet=b.getByTestId('browser-import-sheet')
    await expect(sheet).toBeVisible()
    const panel=mediaImportViews(sheet)
    const verifiedCloud=panel.getByRole('button',{name:'Проверить из облака'})
    await expect(verifiedCloud).toHaveCount(1,{timeout:20000})
    let duplicateDelivered=0
    await b.route('**/media/v1',async route=>{
      const response=await route.fetch()
      const data=await response.json() as {
        items:Array<Record<string,unknown>>;nextCursor:string|null
      }
      if(data.items.length!==1)throw Error('expected 1 authenticated media')
      duplicateDelivered++
      await route.fulfill({response,contentType:'application/json',
        body:JSON.stringify({...data,items:[data.items[0],data.items[0]]})})
    })
    await browserControl(panel,'Обновить')
    await expect(panel.getByRole('alert'))
      .toContainText('browser.invalid_cloud_catalog_page',{timeout:20000})
    expect(duplicateDelivered).toBeGreaterThan(0)
    await expect(verifiedCloud).toHaveCount(1)
    await b.unroute('**/media/v1')
    await browserControl(panel,'Обновить')
    await expect(panel.getByRole('alert')).toHaveCount(0,{timeout:20000})
    await expect(verifiedCloud).toHaveCount(1)

    // A slow older authenticated response must NOT overwrite the newer
    // successful refresh in the same mounted component.
    let unlockOld!:()=>void
    let sawOld!:()=>void
    let servedNew!:()=>void
    const oldPending=new Promise<void>(resolve=>{sawOld=resolve})
    const oldGate=new Promise<void>(resolve=>{unlockOld=resolve})
    const newFinished=new Promise<void>(resolve=>{servedNew=resolve})
    let refreshCalls=0
    await b.route('**/media/v1',async route=>{
      refreshCalls++
      if(refreshCalls===1){
        sawOld()
        await oldGate
        await route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({items:[],nextCursor:null})})
        return
      }
      const response=await route.fetch()
      await route.fulfill({response})
      servedNew()
    })
    await browserControl(panel,'Обновить')
    await oldPending
    await browserControl(panel,'Обновить')
    await newFinished
    unlockOld()
    await expect(verifiedCloud).toHaveCount(1,{timeout:20000})
    await b.waitForTimeout(200)
    await expect(verifiedCloud).toHaveCount(1)
    expect(refreshCalls).toBe(2)
    await b.unroute('**/media/v1')

    expect(requests.join('\n')).not.toContain('секретная')
    expect(requests.join('\n')).not.toContain(secret)
    await b.getByTestId('browser-import-sheet-close').click()
    await expect(sheet).toBeHidden()
  }finally{
    await aContext.close();await bContext.close()
  }
})
