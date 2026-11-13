import { expect, test } from '@playwright/test'

test('UX Settings search: Header, RU/EN synonym, exact Dock field, browser Back and pending language',async ({browser}) => {
  test.setTimeout(130000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try {
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByTestId('fieldwork-settings')).toBeVisible()

    const shellHeader=page.locator('.shell-header')
    await expect(shellHeader).toHaveCount(1)
    await shellHeader.getByRole('button',{name:'Поиск по настройкам'}).click()
    await expect(page).toHaveURL(/\/settings\/search$/)
    const input=page.getByTestId('settings-search-input')
    await expect(input).toBeFocused()
    await input.fill('DoCk')
    await expect(page.getByTestId('settings-search-result-dock')).toBeVisible()
    await expect(page).toHaveURL(/\/settings\/search\?q=DoCk$/)

    await page.getByTestId('settings-search-result-dock').click()
    await expect(page).toHaveURL(/\/settings\/appearance\?field=dock$/)
    await expect(page.getByTestId('appearance-page')).toBeVisible()
    await expect(page.locator('#setting-field-dock')).toBeFocused()
    await expect(shellHeader).toHaveCount(1)
    await expect(page.getByRole('navigation',{name:'Главная навигация'})).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(/\/settings\/search\?q=DoCk$/)
    await expect(page.getByTestId('settings-search-input')).toHaveValue('DoCk')
    await input.fill('язык')
    await expect(page.getByTestId('settings-search-pending-language')).toBeVisible()
    await expect(page.getByTestId('settings-search-result-dock')).toHaveCount(0)
    await expect(page.getByRole('link',{name:/Язык/})).toHaveCount(0)

    await input.fill('панель')
    await expect(page.getByTestId('settings-search-result-dock')).toBeVisible()
    await shellHeader.getByRole('button',{name:'Закрыть поиск'}).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId('fieldwork-settings')).toBeVisible()
  } finally {
    await context.close()
  }
})
