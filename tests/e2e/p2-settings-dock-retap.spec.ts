import { expect, test } from '@playwright/test'

test('UX Dock retap: Settings goes back one in-section screen and root never stacks',async({browser})=>{
  test.setTimeout(130000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try {
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByTestId('fieldwork-settings')).toBeVisible()

    const dock=page.getByRole('navigation',{name:'Главная навигация'})
    const settings=dock.getByRole('link',{name:'Настройки',exact:true})
    const rootPosition=await page.evaluate(()=>window.history.state?.position)
    await settings.click()
    await expect(page).toHaveURL(/\/settings$/)
    expect(await page.evaluate(()=>window.history.state?.position)).toBe(rootPosition)

    // A child reached from Settings retaps to its actual parent.
    await page.getByTestId('settings-nav-appearance').click()
    await expect(page).toHaveURL(/\/settings\/appearance$/)
    await settings.click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId('fieldwork-settings')).toBeVisible()

    // The search-to-field journey has TWO in-section levels:
    // Appearance -> Search (preserving 'dock') -> Settings.
    await page.locator('.shell-header')
      .getByRole('button',{name:'Поиск по настройкам'}).click()
    await page.getByTestId('settings-search-input').fill('dock')
    await page.getByTestId('settings-search-result-dock').click()
    await expect(page).toHaveURL(/\/settings\/appearance\?field=dock$/)
    await settings.click()
    await expect(page).toHaveURL(/\/settings\/search\?q=dock$/)
    await expect(page.getByTestId('settings-search-input')).toHaveValue('dock')
    await settings.click()
    await expect(page).toHaveURL(/\/settings$/)

    // Repeated top-level tap does not produce a duplicate history record.
    const finalPosition=await page.evaluate(()=>window.history.state?.position)
    await settings.click()
    await settings.click()
    await expect(page).toHaveURL(/\/settings$/)
    expect(await page.evaluate(()=>window.history.state?.position))
      .toBe(finalPosition)
  } finally {await context.close()}
})

test('UX Dock retap: editor -> viewer -> browser without external history back',async({browser})=>{
  test.setTimeout(130000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try {
    // A direct editor deep link with no verified previous Viewer route
    // must use replace-to-parent. No real E2EE media may be fabricated.
    const file='/browser/file/photo/00000000-0000-4000-8000-000000000001'
    await page.goto(file+'/edit')
    const dock=page.getByRole('navigation',{name:'Главная навигация'})
    const browserLink=dock.getByRole('link',{name:'Browser',exact:true})
    await expect(browserLink).toHaveAttribute('aria-current','page')
    await browserLink.click()
    await expect(page).toHaveURL(new RegExp(file+'$'))
    await browserLink.click()
    await expect(page).toHaveURL(/\/browser$/)

    // Repeated click at Browser root must not reload/fetch a new page.
    const historyPosition=await page.evaluate(()=>window.history.state?.position)
    await browserLink.click()
    await expect(page).toHaveURL(/\/browser$/)
    expect(await page.evaluate(()=>window.history.state?.position))
      .toBe(historyPosition)
  } finally {await context.close()}
})
