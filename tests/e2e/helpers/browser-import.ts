import {expect,type Locator,type Page} from '@playwright/test'

/** Exercise the approved visible Header→sheet journey, never hidden controls. */
export async function openImportSheet(page:Page):Promise<Locator>{
  const sheet=page.getByTestId('browser-import-sheet')
  if(await page.getByTestId('browser-archive-preferences').isVisible())await page.getByTestId('browser-settings-close').click()
  if(!await sheet.isVisible())await page.getByTestId('browser-header-upload').click()
  await expect(sheet).toBeVisible()
  return sheet
}
export async function closeImportSheet(page:Page):Promise<void>{
  const sheet=page.getByTestId('browser-import-sheet')
  if(await sheet.isVisible())await sheet.getByTestId('browser-import-sheet-close').click()
  await expect(sheet).toBeHidden()
}
export async function chooseEncryptedFile(input:Locator,files:Parameters<Locator['setInputFiles']>[0]):Promise<void>{
  const page=input.page(),sheet=await openImportSheet(page)
  await expect(input).toBeVisible();await expect(input).toBeEnabled()
  await input.setInputFiles(files)
  // Await actual durable encryption, not a timer or fabricated server ACK.
  await expect(sheet.getByText(/Файл зашифрован и сохранён|Зашифровано на устройстве/)).toBeVisible()
  await expect(input).toBeEnabled()
  await closeImportSheet(page)
}

/** One live importer, with advanced operations in the real Browser settings. */
export function mediaImportViews(page:Page):Locator{
  return page.locator('.media-import-p1, .media-import-tools')
}
export async function openImportPanel(page:Page):Promise<Locator>{
  await openImportSheet(page)
  return mediaImportViews(page)
}
export async function openImportTools(page:Page):Promise<Locator>{
  await closeImportSheet(page)
  if(!await page.getByTestId('browser-archive-preferences').isVisible())
    await page.getByTestId('browser-header-settings').click()
  const tools=page.getByTestId('browser-import-tools')
  await expect(tools).toBeVisible()
  return tools
}
export async function sendImportedMedia(page:Page):Promise<void>{
  const tools=await openImportTools(page)
  await tools.getByRole('button',{name:'Отправить медиа',exact:true}).click()
}
export async function openMediaExchange(page:Page):Promise<Locator>{
  if(!await page.getByTestId('browser-media-share-sheet').isVisible())await openImportTools(page)
  return page.getByTestId('media-share-panel')
}
