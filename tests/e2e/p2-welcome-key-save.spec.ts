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

test('Welcome cancelled native Save does not acknowledge Recovery Key or silently download',async({page})=>{
  test.setTimeout(100000)
  await page.addInitScript(()=>{
    Object.defineProperty(window,'showSaveFilePicker',{
      configurable:true,
      value:async()=>{throw new DOMException('cancelled','AbortError')},
    })
  })
  let downloads=0
  page.on('download',()=>{downloads++})
  await page.goto('/welcome/create')
  await page.getByRole('button',{name:'Создать Recovery Key'}).click()
  await expect(page.getByTestId('welcome-generated-key')).not.toHaveValue('')
  await page.getByTestId('welcome-save-key').click()
  await expect(page.getByTestId('welcome-generated-key')).not.toHaveValue('')
  await expect(page.getByText('Файл Recovery Key сохранён в выбранном вами месте. Проверьте его.'))
    .toHaveCount(0)
  await expect(page.getByTestId('welcome-finish')).toBeDisabled()
  expect(downloads).toBe(0)
})

test('Settings unsupported browser offers manual copy without false Save acknowledgement',async({page})=>{
  test.setTimeout(100000)
  await page.addInitScript(()=>{
    Object.defineProperty(window,'showSaveFilePicker',{
      configurable:true,value:undefined,
    })
    Object.defineProperty(navigator,'canShare',{
      configurable:true,value:undefined,
    })
    Object.defineProperty(navigator,'share',{
      configurable:true,value:undefined,
    })
  })
  let downloads=0
  page.on('download',()=>{downloads++})
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await expect(page.locator('#generated-key')).not.toHaveValue('')
  await page.getByTestId('account-save-key').click()
  await expect(page.getByText('Этот браузер не поддерживает выбор места. Скопируйте Recovery Key и сохраните отдельно.'))
    .toBeVisible()
  await expect(page.getByRole('button',{name:'Завершить регистрацию'})).toBeDisabled()
  expect(downloads).toBe(0)
})

test('Welcome opens a single native chooser despite repeated Save attempts',async({page})=>{
  test.setTimeout(100000)
  await page.addInitScript(()=>{
    const w=window as Window & {
      __pickerCalls?:number
      __completePicker?:(()=>void)
    }
    w.__pickerCalls=0
    Object.defineProperty(window,'showSaveFilePicker',{
      configurable:true,
      value:()=>new Promise(resolve=>{
        w.__pickerCalls=(w.__pickerCalls??0)+1
        w.__completePicker=()=>resolve({
          createWritable:async()=>({
            write:async()=>{},
            close:async()=>{},
          }),
        })
      }),
    })
  })
  await page.goto('/welcome/create')
  await page.getByRole('button',{name:'Создать Recovery Key'}).click()
  await expect(page.getByTestId('welcome-generated-key')).not.toHaveValue('')
  const save=page.getByTestId('welcome-save-key')
  await save.click()
  await expect(save).toBeDisabled()
  expect(await page.evaluate(()=>(
    window as Window & {__pickerCalls?:number}
  ).__pickerCalls)).toBe(1)
  await page.evaluate(()=>(
    window as Window & {__completePicker?:(()=>void)}
  ).__completePicker?.())
  await expect(save).toBeEnabled()
  await expect(page.getByText('Файл Recovery Key сохранён в выбранном вами месте. Проверьте его.'))
    .toBeVisible()
  await expect(page.getByTestId('welcome-finish')).toBeDisabled()
})
