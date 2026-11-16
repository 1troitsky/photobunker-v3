import { test, expect } from '@playwright/test'

test('Welcome 1.4 routes anonymously, uses original six SVG slides and real key-only account',async({page})=>{
  test.setTimeout(150000)
  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.getByTestId('welcome-screen')).toBeVisible()
  const configuredBrand=await page.evaluate(async()=>{
    const {brand}=await import('/src/config/brand.ts')
    return brand.name
  })
  await expect(page.locator('.welcome-brand-name')).toHaveText(configuredBrand)
  await expect(page.locator('.carousel')).toHaveAttribute('aria-label','Почему '+configuredBrand)
  await expect(page.locator('.carousel-copy')).toContainText(configuredBrand)
  await expect(page.locator('.shell-header')).toHaveCount(0)
  await expect(page.locator('.shell-dock')).toHaveCount(0)
  await expect(page.locator('.carousel-dot')).toHaveCount(6)
  await expect(page.getByRole('link',{name:'Восстановить аккаунт'})).toBeVisible()

  await page.getByRole('link',{name:'Создать аккаунт'}).click()
  await expect(page).toHaveURL(/\/welcome\/create$/)
  await page.getByRole('button',{name:'Создать Recovery Key'}).click()
  const key=await page.getByTestId('welcome-generated-key').inputValue()
  expect(key).toMatch(/^PB2\./)
  await expect(page.getByTestId('welcome-finish')).toBeDisabled()
  await page.getByText('Я сохранил Recovery Key отдельно от устройства.').click()
  await page.getByTestId('welcome-finish').click()
  await expect(page).toHaveURL(/\/assignments$/,{timeout:30000})
  await expect(page.locator('.shell-header')).toHaveCount(1)
  await expect(page.locator('.shell-dock')).toHaveCount(1)
})

test('Welcome Loader 1.6 exits after genuine local key hydration even when server login stalls',async({page})=>{
  test.setTimeout(120000)
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  // Hold only the REST login challenge, not the browser or local encrypted
  // IndexedDB. The same known device must remain available Local-First.
  let release:()=>void=()=>{}
  let intercepted=false
  const gate=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/identity/v2/challenges',async route=>{
    const body=route.request().postData()??''
    if(body.includes('"purpose":"login"')){
      intercepted=true
      await gate
    }
    await route.continue()
  })
  try{
    await page.goto('/browser')
    await page.reload({waitUntil:'domcontentloaded'})
    await expect.poll(async()=>page.evaluate(async()=>{
      const m=await import('/src/features/identity/application/session.ts')
      return !!m.activeSession.value&&!m.sessionBootstrapPending.value
    }),{timeout:30000}).toBe(true)
    // Local-first UI intentionally wins this race. Wait for the background
    // request to reach the held transport before asserting its offline state.
    await expect.poll(()=>intercepted).toBe(true)
    const local=await page.evaluate(async()=>{
      const m=await import('/src/features/identity/application/session.ts')
      return {offline:!m.activeSession.value?.online,loading:m.sessionBootstrapPending.value}
    })
    expect(local).toEqual({offline:true,loading:false})
    await expect(page.getByTestId('browser-v3')).toBeVisible()
  }finally{release();await page.unrouteAll({behavior:'ignoreErrors'})}
})
