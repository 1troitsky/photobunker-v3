import {test,expect} from '@playwright/test'

test('P2 Appearance: real key-only account → live Dock preview → cancel/save → offline/reload',async({browser})=>{
  test.setTimeout(180000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.getByTestId('appearance-open').click()
    await expect(page.getByTestId('appearance-page')).toBeVisible()

    const dock=page.locator('.shell-dock a')
    await expect(dock).toHaveCount(5)
    await expect(page.getByTestId('dock-selected-settings')).toBeVisible()
    await expect(page.getByRole('button',{name:'Убрать Настройки'})).toHaveCount(0)
    await expect(page.getByRole('button',{name:'Добавить Уведомления'})).toBeDisabled()

    // Preview changes the single real Shell Dock without persisting.
    await page.getByRole('button',{name:'Добавить Сообщения'}).click()
    await expect(dock).toHaveCount(6)
    await expect(page.locator('.shell-dock a[href="/messages"]')).toBeVisible()
    await expect(page.getByText('Достигнут предел: 6 разделов',{exact:false})).toBeVisible()
    await page.getByRole('button',{name:'Отмена'}).click()
    await expect(dock).toHaveCount(5)
    await expect(page.locator('.shell-dock a[href="/messages"]')).toHaveCount(0)

    // Save a valid 5-item order with mandatory Settings in the middle.
    await page.getByRole('button',{name:'Убрать Контакты'}).click()
    await page.getByRole('button',{name:'Добавить Сообщения'}).click()
    await page.getByRole('button',{name:'Переместить Настройки вверх'}).click()
    await expect(dock).toHaveCount(5)
    expect(await dock.evaluateAll(anchors=>anchors.map(a=>a.getAttribute('href'))))
      .toEqual(['/assignments','/browser','/settings','/camera','/messages'])
    await page.getByRole('button',{name:'Сохранить'}).click()
    await expect(page.getByText('Настройки Dock зашифрованы',{exact:false})).toBeVisible()

    // Offline edits are real local writes, not network ACKs.
    await context.setOffline(true)
    await page.getByRole('button',{name:'Убрать Камера'}).click()
    await expect(dock).toHaveCount(4)
    await page.getByRole('button',{name:'Сохранить'}).click()
    await expect(page.getByText('Настройки Dock зашифрованы',{exact:false})).toBeVisible()
    await context.setOffline(false)

    await page.reload()
    await expect(page.getByTestId('appearance-page')).toBeVisible()
    await expect(dock).toHaveCount(4)
    expect(await dock.evaluateAll(anchors=>anchors.map(a=>a.getAttribute('href'))))
      .toEqual(['/assignments','/browser','/settings','/messages'])
    await expect(page.getByTestId('dock-selected-settings')).toBeVisible()
    await expect(page.getByTestId('dock-selected-camera')).toHaveCount(0)
  }finally{await context.close()}
})
