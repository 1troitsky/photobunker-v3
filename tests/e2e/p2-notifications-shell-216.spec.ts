import { test, expect } from '@playwright/test'

test('P2 #216: real account, encrypted Notifications UI, offline route/settings and no unauthenticated leak',async({browser})=>{
  test.setTimeout(150000)
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  const page=await context.newPage()
  const dock=page.getByRole('navigation',{name:'Главная навигация'})
  try{
    await page.goto('/notifications')
    await expect(page.getByTestId('notifications-signed-out')).toBeVisible()
    await expect(page.getByTestId('notifications-list')).toHaveCount(0)
    await page.getByRole('link',{name:'Создать или восстановить аккаунт'}).click()
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByTestId('fieldwork-settings')).toBeVisible()
    await expect(page.getByTestId('settings-nav-notifications'))
      .toHaveAttribute('href','/notifications')

    // The newly added sixth Dock action is a real route, not a cosmetic icon.
    await page.getByTestId('settings-nav-appearance').click()
    await page.getByTestId('dock-add-notifications').click()
    await expect(page.getByTestId('dock-count')).toHaveText('6 / 6')
    await page.getByRole('button',{name:'Сохранить',exact:true}).click()
    await expect(dock.getByRole('link',{name:'Уведомления'})).toBeVisible()

    // SPA navigation and encrypted local preferences remain usable offline.
    // Cold HTTP reload offline is NOT claimed: signed PWA SW is still gated.
    await context.setOffline(true)
    await dock.getByRole('link',{name:'Уведомления'}).click()
    await expect(page).toHaveURL(/\/notifications$/)
    await expect(page.getByTestId('notifications-page')).toBeVisible()
    await expect(page.getByTestId('notifications-signed-out')).toHaveCount(0)
    await expect(page.getByTestId('notifications-list')).toHaveCount(0)
    await expect(page.getByTestId('notifications-mark-all')).toBeDisabled()

    await page.getByTestId('notifications-settings').click()
    await expect(page).toHaveURL(/\/notifications\/settings$/)
    await expect(page.getByTestId('notification-settings-page')).toBeVisible()
    await expect(page.getByTestId('notification-setting-push')).toBeDisabled()
    await page.getByTestId('notification-setting-invitations').uncheck()
    await page.getByTestId('notification-settings-save').click()
    await expect(page.getByText('Сохранено в зашифрованном хранилище этого устройства.'))
      .toBeVisible()

    // Nested Dock retap never escapes to unrelated browser history.
    await dock.getByRole('link',{name:'Уведомления'}).click()
    await expect(page).toHaveURL(/\/notifications$/)
    await page.getByTestId('notifications-settings').click()
    await expect(page.getByTestId('notification-setting-invitations')).not.toBeChecked()
    await expect(page.getByTestId('notification-setting-push')).toBeDisabled()

    // After logout, no private inbox rows render even if the route is visited.
    await context.setOffline(false)
    await dock.getByRole('link',{name:'Настройки'}).click()
    await page.getByRole('button',{name:'Выйти'}).click()
    await expect(page.getByRole('button',{name:'Создать ключ'})).toBeVisible()
    await dock.getByRole('link',{name:'Уведомления'}).click()
    await expect(page.getByTestId('notifications-signed-out')).toBeVisible()
    await expect(page.getByTestId('notifications-list')).toHaveCount(0)
  }finally{
    await context.close()
  }
})
