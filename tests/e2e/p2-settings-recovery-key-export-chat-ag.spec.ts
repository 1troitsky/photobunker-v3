import { test, expect } from '@playwright/test'

test('P2 #400: explicit system share requires a click and preserves registration', async ({ browser }) => {
  test.setTimeout(120000)
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  try {
    await page.addInitScript(() => {
      const state: { value?: string; opens: number } = { opens: 0 }
      Object.defineProperty(window, '__pb3KeyShareTest', { value: state })
      Object.defineProperty(window, 'showSaveFilePicker', {configurable:true,value:undefined})
      Object.defineProperty(navigator, 'canShare', {configurable:true,value:()=>true})
      Object.defineProperty(navigator, 'share', {configurable:true,value:async(data:{files:File[]})=>{
        state.opens++;state.value=await data.files[0]!.text()
      }})
    })
    let downloads=0
    page.on('download',()=>{downloads++})
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await expect(page.getByTestId('account-save-key')).toBeVisible()
    const key=await page.locator('#generated-key').inputValue()
    expect(key.startsWith('PB2.')).toBe(true)
    expect(downloads).toBe(0)
    expect(await page.evaluate(()=>(window as unknown as {
      __pb3KeyShareTest:{opens:number}
    }).__pb3KeyShareTest.opens)).toBe(0)
    await page.getByTestId('account-save-key').click()
    await expect(page.getByText('Системное меню закрыто. Проверьте сохранение в «Файлы»; не передавайте ключ другим людям.')).toBeVisible()
    expect(await page.evaluate(expected=>{
      const state=(window as unknown as {__pb3KeyShareTest:{opens:number;value?:string}}).__pb3KeyShareTest
      return state.opens===1&&state.value===expected+'\n'
    },key)).toBe(true)
    // A closed OS sheet is never treated as proof the key was saved.
    await expect(page.getByRole('button',{name:'Завершить регистрацию'})).toBeDisabled()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await expect(page.locator('#generated-key')).toHaveCount(0)
    await expect(page.getByTestId('account-save-key')).toHaveCount(0)
    expect(downloads).toBe(0)
  } finally { await context.close() }
})

test('P2 #400: native picker writes only after user action without network or local storage', async ({ browser }) => {
  test.setTimeout(90000)
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.addInitScript(() => {
      // Simulate only the OS file picker; the UI/crypto/key generation stays real.
      const state: { value?: string; closed?: boolean; opens: number } = { opens: 0 }
      Object.defineProperty(window, '__pb3KeySaveTest', { value: state })
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async () => {
          state.opens++
          return {
            createWritable: async () => ({
              write: async (blob: Blob) => { state.value = await blob.text() },
              close: async () => { state.closed = true },
              abort: async () => { state.value = undefined },
            }),
          }
        },
      })
    })
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Создать ключ' }).click()
    const key = await page.locator('#generated-key').inputValue()
    const initial = await page.evaluate(() => (window as unknown as {
      __pb3KeySaveTest: { opens: number; closed?: boolean }
    }).__pb3KeySaveTest)
    expect(initial.opens).toBe(0)
    await page.getByTestId('account-save-key').click()
    await expect(page.getByText('Файл Recovery Key сохранён в выбранном месте. Проверьте его.')).toBeVisible()
    const matched = await page.evaluate((expected) => {
      const v = (window as unknown as {
        __pb3KeySaveTest: { value?: string; closed?: boolean; opens: number }
      }).__pb3KeySaveTest
      return v.opens === 1 && v.closed === true && v.value === expected + '\n'
    }, key)
    expect(matched).toBe(true)
  } finally { await context.close() }
})
