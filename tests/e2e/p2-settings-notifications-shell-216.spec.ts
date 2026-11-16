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
    await expect(page.getByTestId('shell-status-link')).toHaveAttribute('data-session-state','offline')
    await expect(page.getByTestId('shell-status-link').locator('.status-dot'))
      .not.toHaveClass(/session-online/)
    await dock.getByRole('link',{name:'Уведомления'}).click()
    await expect(page).toHaveURL(/\/notifications$/)
    await expect(page.getByTestId('notifications-page')).toBeVisible()
    await expect(page.getByTestId('notifications-signed-out')).toHaveCount(0)
    await expect(page.getByTestId('notifications-list')).toHaveCount(0)
    // A previously signed session may still carry online=true after
    // Chromium disconnects. The inbox must NOT expose server-only actions.
    await expect(page.getByText('Локальный режим. Показаны сохранённые зашифрованные уведомления.'))
      .toBeVisible()
    await expect(page.getByTestId('notifications-refresh')).toBeDisabled()
    await expect(page.locator('.shell-header').getByTestId('notifications-mark-all')).toBeDisabled()
    await expect(page.locator('.shell-header').getByTestId('notifications-settings')).toBeVisible()
    await expect(page.getByTestId('notifications-page').getByTestId('notifications-mark-all')).toHaveCount(0)
    await expect(page.getByTestId('verified-plan-link')).toHaveCount(0)

    await page.getByTestId('notifications-settings').click()
    await expect(page).toHaveURL(/\/notifications\/settings$/)
    await expect(page.getByTestId('notification-settings-page')).toBeVisible()
    await expect(page.getByTestId('notification-setting-push')).toBeDisabled()
    // Fieldwork 1.5: Save/Cancel stay above the persistent Dock, including
    // on a narrow phone, without creating a second scrolling list.
    const settingsBar=page.locator('.notification-settings .settings-actions')
    await expect(settingsBar).toHaveCSS('position','sticky')
    await expect(settingsBar).toBeInViewport()
    const barBox=await settingsBar.boundingBox()
    const dockBox=await dock.boundingBox()
    expect(barBox&&dockBox&&barBox.y+barBox.height<=dockBox.y+2).toBe(true)
    await page.getByTestId('notification-setting-invitations').uncheck()
    // Approved Notifications 1.5 categories are independent and persist
    // in the encrypted device-local store even without network connectivity.
    for(const category of ['newFiles','reviews','backups','subscription']){
      await expect(page.getByTestId('notification-setting-'+category)).toBeChecked()
      await page.getByTestId('notification-setting-'+category).uncheck()
    }
    await expect(page.getByText('Уведомления безопасности')).toBeVisible()
    await expect(page.getByText('Пока недоступно')).toBeVisible()
    await page.getByTestId('notification-settings-save').click()
    await expect(page.getByText('Сохранено в зашифрованном хранилище этого устройства.'))
      .toBeVisible()

    // Nested Dock retap never escapes to unrelated browser history.
    await dock.getByRole('link',{name:'Уведомления'}).click()
    await expect(page).toHaveURL(/\/notifications$/)
    await page.getByTestId('notifications-settings').click()
    await expect(page.getByTestId('notification-setting-invitations')).not.toBeChecked()
    for(const category of ['newFiles','reviews','backups','subscription']){
      await expect(page.getByTestId('notification-setting-'+category)).not.toBeChecked()
    }
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


test('P2 #216: real encrypted offline notification details restore focus to event or filter',async({browser})=>{
  const context=await browser.newContext({
    viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  })
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByTestId('fieldwork-settings')).toBeVisible()

    // Create a genuine owner-key-encrypted LOCAL event in IndexedDB, not
    // a synthetic Matrix/network notification or unauthenticated DOM row.
    const id=await page.evaluate(async()=>{
      const {recordLocalNotification}=await import(
        '/src/features/notifications/application/local-inbox.ts')
      const id=crypto.randomUUID()
      await recordLocalNotification({
        id,kind:'security',targetId:null,occurredAt:Date.now(),
      })
      return id
    })
    await context.setOffline(true)
    // The fixed 64px Header status must navigate to the REAL encrypted
    // local inbox via Vue Router even when the device is offline. It must
    // not claim Matrix/server notification delivery or duplicate Shell UI.
    const status=page.getByTestId('shell-status-link')
    await expect(status).toHaveAttribute('href','/notifications')
    await expect(status).toHaveAccessibleName('Открыть локальные уведомления')
    await status.click()
    await expect(page).toHaveURL(/\/notifications$/)
    const card=page.getByTestId('notification-'+id)
    const summary=card.locator('button.notification-summary')
    await expect(card).toBeVisible()

    // An unread event remains expanded after its encrypted read ACK.
    await page.getByTestId('notifications-unread').click()
    await summary.click()
    await expect(page.getByTestId('notification-details')).toBeVisible()
    await expect(card.locator('.notification-dot.isread')).toBeVisible()
    await page.getByTestId('notifications-back-to-list').click()
    await expect(page.getByTestId('notifications-empty')).toBeVisible()
    await expect(page.getByTestId('notifications-unread')).toBeFocused()

    // In All, the same read event remains present and restores focus to
    // its own summary, not the document body or another Shell action.
    await page.getByTestId('notifications-all').click()
    await summary.click()
    await expect(page.getByTestId('notification-details')).toBeVisible()
    await page.getByTestId('notifications-back-to-list').click()
    await expect(summary).toBeFocused()
    await expect(page.getByTestId('notification-details')).toHaveCount(0)
  }finally{
    await context.close()
  }
})
