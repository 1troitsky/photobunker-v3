import {expect,type Locator,type Page} from '@playwright/test'

/** Exercise the approved visible Header→sheet journey, never hidden controls. */
export async function openImportSheet(page:Page):Promise<Locator>{
  const sheet=page.getByTestId('browser-import-sheet')
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
