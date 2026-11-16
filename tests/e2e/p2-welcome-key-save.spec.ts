import {test,expect} from '@playwright/test'

test('Welcome Recovery Key uses explicit native chooser and never auto-downloads plaintext',async({page})=>{
  test.setTimeout(100000)
  await page.addInitScript(()=>{
    const w=window as Window & {__savedKey?:string}
    Object.defineProperty(window,'showSaveFilePicker',{
      configurable:true,
      value:async()=>({
        createWritable:async()=>({
          write:async(file:Blob)=>{w.__savedKey=await file.text()},
          close:async()=>{},
        }),
      }),
    })
  })
  await page.goto('/welcome/create')
  await page.getByRole('button',{name:'Создать Recovery Key'}).click()
  await expect(page.getByTestId('welcome-generated-key')).not.toHaveValue('')
  await page.getByTestId('welcome-save-key').click()
  await expect(page.getByText('Файл Recovery Key сохранён в выбранном вами месте. Проверьте его.'))
    .toBeVisible()
  // The only plaintext copy passed to the mock OS picker is the real
  // freshly generated key. No synthetic server/account or fake file receipt.
  expect(await page.evaluate(()=>{
    const w=window as Window & {__savedKey?:string}
    return w.__savedKey===(
      document.querySelector<HTMLTextAreaElement>('[data-testid="welcome-generated-key"]')
        ?.value??'')+'\n'
  })).toBe(true)
  await expect(page.getByTestId('welcome-finish')).toBeDisabled()
})

test('Settings registration uses same OS-chosen destination and never auto-ACKs the Recovery Key',async({page})=>{
  test.setTimeout(100000)
  await page.addInitScript(()=>{
    const w=window as Window & {__savedSettingsKey?:string}
    Object.defineProperty(window,'showSaveFilePicker',{
      configurable:true,
      value:async()=>({
        createWritable:async()=>({
          write:async(file:Blob)=>{w.__savedSettingsKey=await file.text()},
          close:async()=>{},
        }),
      }),
    })
  })
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  const key=page.locator('#generated-key')
  await expect(key).not.toHaveValue('')
  await page.getByTestId('account-save-key').click()
  await expect(page.getByText('Файл Recovery Key сохранён в выбранном месте. Проверьте его.'))
    .toBeVisible()
  expect(await page.evaluate(()=>{
    const w=window as Window & {__savedSettingsKey?:string}
    return w.__savedSettingsKey===(
      document.querySelector<HTMLTextAreaElement>('#generated-key')?.value??'')+'\n'
  })).toBe(true)
  await expect(page.getByRole('button',{name:'Завершить регистрацию'})).toBeDisabled()
})
