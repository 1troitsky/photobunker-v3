import {openImportTools,openImportSheet} from '../helpers/browser-import'
import {expect,type Locator,type Page} from '@playwright/test'

// Exercise the approved Header controls before accessing their actual sheets.
// No force clicks, hidden aliases, DOM mutation, or simulated network success.
export async function openBrowserSettings(page:Page):Promise<void>{
  if(await page.getByTestId('browser-import-sheet').isVisible())
    await page.getByTestId('browser-import-sheet-close').click()
  if(!await page.getByTestId('browser-archive-preferences').isVisible())
    await page.getByTestId('browser-header-settings').click()
  await expect(page.getByTestId('browser-archive-preferences')).toBeVisible()
}
export async function closeBrowserSettings(page:Page):Promise<void>{
  if(await page.getByTestId('browser-archive-preferences').isVisible())
    await page.getByTestId('browser-settings-close').click()
}
export async function browserControl(scope:Page|Locator,name:'Синхронизировать'|'Обновить'):Promise<void>{
  if('page' in scope){
    const page=scope.page(),tools=await openImportTools(page)
    await tools.getByRole('button',{name,exact:true}).click()
    await openImportSheet(page)
    return
  }
  const page=scope,browser=await page.getByTestId('browser-header-settings').count()>0
  if(browser){
    await openBrowserSettings(page)
    await page.getByTestId('browser-archive-preferences').locator(':scope > .action-row').getByRole('button',{name,exact:true}).click()
    await closeBrowserSettings(page)
  }else await page.getByRole('button',{name,exact:true}).click()
}
export async function searchBrowser(page:Page,value:string):Promise<void>{
  if(!await page.getByTestId('browser-search').isVisible())
    await page.getByTestId('browser-header-search').click()
  await page.getByTestId('browser-search').fill(value)
}
export async function sortBrowser(page:Page,value:string):Promise<void>{
  await openBrowserSettings(page)
  await page.getByTestId('browser-sort').selectOption(value)
  await closeBrowserSettings(page)
}
export async function filterBrowser(page:Page,value:'all'|'photo'|'video'|'audio'):Promise<void>{
  if(!await page.getByTestId('browser-filter-'+value).isVisible())
    await page.getByTestId('browser-header-search').click()
  await page.getByTestId('browser-filter-'+value).click()
}
export async function syncBrowserFolders(page:Page):Promise<void>{
  await openBrowserSettings(page)
  await page.getByTestId('browser-folder-sync').click()
  await closeBrowserSettings(page)
}

export async function exchangeReady(page:Page,timeout=20000):Promise<void>{
  const uploading=await page.getByTestId('browser-import-sheet').isVisible()
  await openBrowserSettings(page)
  await expect(page.getByText('Ключ обмена подготовлен')).toBeVisible({timeout})
  await closeBrowserSettings(page)
  if(uploading)await page.getByTestId('browser-header-upload').click()
}
export async function openPhotoExchange(page:Page):Promise<void>{
  if(!await page.getByTestId('browser-photo-share-sheet').isVisible())
    await openBrowserSettings(page)
}

export async function browserHeader(page:Page,action:string):Promise<void>{
  for(const id of ['browser-file-menu-panel','browser-folder-menu-panel'])
    if(await page.getByTestId(id).isVisible())await page.keyboard.press('Escape')
  if(await page.getByTestId('browser-import-sheet').isVisible())
    await page.getByTestId('browser-import-sheet-close').click()
  await closeBrowserSettings(page)
  await page.getByTestId('browser-header-'+action).click()
}
