import { test, expect } from '@playwright/test'

test('UX Appearance 1.3: Dock draft, cancel, save, device reload and protected Settings',async ({browser}) => {
  test.setTimeout(130000)
  const context=await browser.newContext()
  const page=await context.newPage()
  const dock=page.getByRole('navigation',{name:'Главная навигация'})
  try {
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()

    await page.getByTestId('settings-nav-appearance').click()
    await expect(page).toHaveURL(/\/settings\/appearance$/)
    await expect(page.getByTestId('appearance-page')).toBeVisible()
    await expect(dock.getByRole('link')).toHaveCount(5)
    await expect(page.getByTestId('dock-remove-settings')).toHaveCount(0)
    await expect(page.getByTestId('dock-add-notifications')).toBeDisabled()
    await expect(page.getByTestId('dock-add-messages')).toBeDisabled()

    // Editing the actual Shell Dock previews immediately but is NOT persisted.
    await page.getByTestId('dock-remove-contacts').click()
    await expect(page.getByTestId('dock-count')).toHaveText('4 / 6')
    await expect(dock.getByRole('link')).toHaveCount(4)
    await page.getByRole('button',{name:'Отмена',exact:true}).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(dock.getByRole('link')).toHaveCount(5)

    // Re-enter, reorder, commit to local preference storage, and reload.
    await page.getByTestId('settings-nav-appearance').click()
    await page.getByTestId('dock-remove-contacts').click()
    await page.getByTestId('dock-up-settings').click()
    await expect(dock.getByRole('link')).toHaveCount(4)
    const order=await dock.locator('a').allTextContents()
    expect(order.join('|')).toMatch(/Задания.*Browser.*Настройки.*Камера/s)
    await page.getByRole('button',{name:'Сохранить',exact:true}).click()
    await expect(page.getByText('Сохранено на этом устройстве.')).toBeVisible()
    const saved=await page.evaluate(()=>localStorage.getItem('pb3.appearance.v2'))
    expect(JSON.parse(saved||'null')).toEqual({
      version:2,
      dock:['assignments','browser','settings','camera'],
      launch:'tasks',
    })
    await page.reload()
    await expect(dock.getByRole('link')).toHaveCount(4)
    await expect(page.getByTestId('dock-count')).toHaveText('4 / 6')

    // Restore approved default through the editor, not backend account data.
    await page.getByRole('button',{name:'Вернуть стандартный порядок'}).click()
    await expect(dock.getByRole('link')).toHaveCount(5)
    await page.getByRole('button',{name:'Сохранить',exact:true}).click()
    await page.reload()
    await expect(dock.getByRole('link')).toHaveCount(5)
    await expect(dock.getByRole('link',{name:'Настройки'})).toBeVisible()
    await dock.getByRole('link',{name:'Настройки'}).click()
    await expect(page.getByTestId('fieldwork-settings')).toBeVisible()
    await expect(page.getByRole('button',{name:'Проверить сессию'})).toBeVisible()
  } finally {
    await context.close()
  }
})
