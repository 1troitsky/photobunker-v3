import { expect, test } from '@playwright/test'

test('UX Appearance 1.3: atomic Dock and Start Page, Cancel, reload, exact search and deep links', async ({browser}) => {
  test.setTimeout(130000)
  const context=await browser.newContext()
  const page=await context.newPage()
  const dock=page.getByRole('navigation',{name:'Главная навигация'})
  try {
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByTestId('fieldwork-settings')).toBeVisible()

    // Unsaved launch + Dock edits are cancelled as one draft, even across
    // two different controls. The default root keeps the existing behavior.
    await page.getByTestId('settings-nav-appearance').click()
    await expect(page.getByTestId('launch-page-tasks')).toBeChecked()
    await page.getByTestId('launch-page-browser').check()
    await page.getByTestId('dock-remove-contacts').click()
    await expect(dock.getByRole('link')).toHaveCount(4)
    await page.getByRole('button',{name:'Отмена',exact:true}).click()
    await expect(dock.getByRole('link')).toHaveCount(5)
    await page.goto('/')
    await expect(page).toHaveURL(/\/assignments$/)

    // One Save must persist both preferences atomically, in a single v2
    // blob. Direct routes continue to behave as direct routes.
    await page.goto('/settings')
    await page.getByTestId('settings-nav-appearance').click()
    await page.getByTestId('launch-page-browser').check()
    await page.getByTestId('dock-remove-contacts').click()
    await page.getByRole('button',{name:'Сохранить',exact:true}).click()
    await expect(page.getByText('Сохранено на этом устройстве.')).toBeVisible()
    const saved=await page.evaluate(()=>localStorage.getItem('pb3.appearance.v2'))
    expect(JSON.parse(saved||'null')).toEqual({
      version:2,
      dock:['assignments','browser','camera','settings'],
      launch:'browser',
    })
    await page.reload()
    await expect(page.getByTestId('launch-page-browser')).toBeChecked()
    await expect(dock.getByRole('link')).toHaveCount(4)

    await page.goto('/')
    await expect(page).toHaveURL(/\/browser$/)
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/settings$/)

    // Search must jump to the actual control, never just the top of
    // Appearance. No intermediate route is fabricated.
    await page.locator('.shell-header')
      .getByRole('button',{name:'Поиск по настройкам'}).click()
    await page.getByTestId('settings-search-input').fill('launch page')
    await page.getByTestId('settings-search-result-start-page').click()
    await expect(page).toHaveURL(/\/settings\/appearance\?field=launch$/)
    await expect(page.locator('#setting-field-launch')).toBeFocused()
    await expect(page.getByTestId('launch-page-browser')).toBeChecked()

    // Restore default through the one accepted Save action.
    await page.getByTestId('launch-page-tasks').check()
    await page.getByRole('button',{name:'Сохранить',exact:true}).click()
    await page.goto('/')
    await expect(page).toHaveURL(/\/assignments$/)
  } finally {
    await context.close()
  }
})
