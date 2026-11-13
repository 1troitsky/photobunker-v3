import {expect,test,type Page} from '@playwright/test'

type Notice={id:string;kind:string;targetId:string|null;readAt:number|null}

async function register(page:Page):Promise<string>{
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  const key=await page.locator('#generated-key').inputValue()
  expect(key).toMatch(/^PB2\./)
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  return key
}
async function notices(page:Page):Promise<Notice[]>{
  return page.evaluate(async()=>{
    const local=await import('/src/features/notifications/application/local-inbox.ts')
    return (await local.listLocalNotifications()).map(n=>({
      id:n.id,kind:n.kind,targetId:n.targetId,readAt:n.readAt,
    }))
  })
}

/**
 * Real Chromium + Laravel/PostgreSQL server-event producer, real device keys
 * and AES-GCM IndexedDB. No test auth shims, no client-written server event.
 * This is warm-offline acceptance, NOT unsupported cold-offline PWA bootstrap.
 */
test('P2 #198 A→B encrypted notification, lost ACK, offline local read and tenant boundary',async({browser})=>{
  test.setTimeout(190000)
  const aContext=await browser.newContext()
  const bContext=await browser.newContext()
  const cContext=await browser.newContext()
  const a=await aContext.newPage(),b=await bContext.newPage(),c=await cContext.newPage()
  try{
    const key=await register(a)
    await a.goto('/notifications')
    await expect(a.getByTestId('notifications-list')).toContainText(
      'Событие безопасности',{timeout:30000})
    const initial=await notices(a)
    expect(initial).toHaveLength(1)
    expect(initial[0]).toMatchObject({kind:'security',targetId:null,readAt:null})
    const eventId=initial[0]!.id
    const rawIndexedDb=await a.evaluate(async()=>{
      const db=await new Promise<IDBDatabase>((resolve,reject)=>{
        const request=indexedDB.open('pb3-encrypted-notifications-v1')
        request.onsuccess=()=>resolve(request.result)
        request.onerror=()=>reject(request.error)
      })
      try{
        const tx=db.transaction('rows','readonly')
        const request=tx.objectStore('rows').getAll()
        const rows=await new Promise<unknown[]>((resolve,reject)=>{
          request.onsuccess=()=>resolve(request.result as unknown[])
          request.onerror=()=>reject(request.error)
        })
        return JSON.stringify(rows)
      }finally{db.close()}
    })
    expect(rawIndexedDb).not.toContain(eventId)
    expect(rawIndexedDb).not.toContain('security')
    expect(rawIndexedDb).not.toContain('AccountCreated')

    // Prove ACK loss cannot destroy or replace locally encrypted data.
    // Server rows remain replayable; transport responds with a real failure.
    await a.route('**/notifications/v1/ack',route=>route.abort('failed'))
    const failed=await a.evaluate(async()=>{
      const sync=await import('/src/features/notifications/application/server-event-sync.ts')
      try{await sync.syncServerNotifications();return false}
      catch{return true}
    })
    expect(failed).toBe(true)
    expect(await notices(a)).toMatchObject([{id:eventId,readAt:null}])
    await a.unroute('**/notifications/v1/ack')

    await a.getByTestId('notification-'+eventId)
      .locator('button.notification-summary').click()
    await expect.poll(async()=>((await notices(a))[0]?.readAt??null))
      .not.toBeNull()
    const marked=(await notices(a))[0]!.readAt
    await a.reload()
    await expect(a.getByTestId('notifications-list')).toBeVisible()
    await expect.poll(async()=>((await notices(a))[0]?.readAt))
      .toBe(marked)
    const restored=await a.evaluate(async()=>{
      // Device bootstrap deliberately opens encrypted local state offline
      // until proof completes. Never bypass this security gate in production.
      const session=await import('/src/features/identity/application/session.ts')
      await session.reauthenticate()
      if(!session.activeSession.value?.online)throw Error('identity.proof_not_confirmed')
      const sync=await import('/src/features/notifications/application/server-event-sync.ts')
      return sync.syncServerNotifications()
    })
    expect(restored.saved).toBe(1) // harmless replay of the same server event
    expect(await notices(a)).toEqual([{id:eventId,kind:'security',targetId:null,readAt:marked}])

    // Warm offline: already-loaded shell and encrypted local history remain
    // usable without inventing Service Worker cold-start support.
    await aContext.setOffline(true)
    await expect(a.getByTestId('notifications-list')).toContainText('Событие безопасности')
    await a.getByTestId('notifications-unread').click()
    await expect(a.getByTestId('notifications-empty')).toContainText('Непрочитанных')
    await aContext.setOffline(false)

    // Second device uses the genuine account recovery flow, its own keys,
    // empty IndexedDB and a server-authenticated copy of the SAME event.
    await b.goto('/settings')
    await b.locator('#recovery-key').fill(key)
    await b.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(b.getByText('Подтверждённая сессия')).toBeVisible()
    await b.goto('/notifications')
    await expect(b.getByTestId('notifications-list')).toContainText(
      'Событие безопасности',{timeout:30000})
    expect(await notices(b)).toEqual([{id:eventId,kind:'security',targetId:null,readAt:null}])

    // Revoke the SECOND device through the real authenticated route.
    // Its cached ciphertext stays local but its server polling authorization
    // must immediately fail; a prior delivery ACK is not a privilege grant.
    const bDevice=await b.evaluate(async()=>{
      const session=await import('/src/features/identity/application/session.ts')
      return session.activeSession.value?.deviceId ?? null
    })
    expect(bDevice).toMatch(/^[0-9a-f-]{36}$/)
    const revoked=await a.evaluate(async deviceId=>{
      const api=await import('/src/features/identity/infrastructure/api.ts')
      return api.jsonApi<{revoked:boolean}>(
        '/identity/v2/devices/'+deviceId+'/revoke','POST',{})
    },bDevice!)
    expect(revoked.revoked).toBe(true)
    const denied=await b.request.get('/notifications/v1/events')
    expect(denied.status()).toBe(401)
    expect((await notices(b))[0]?.id).toBe(eventId)

    // A different account never receives another account's event ID.
    await register(c)
    await c.goto('/notifications')
    await expect(c.getByTestId('notifications-list')).toContainText(
      'Событие безопасности',{timeout:30000})
    const outsider=await notices(c)
    expect(outsider).toHaveLength(1)
    expect(outsider[0]!.id).not.toBe(eventId)
    expect(outsider[0]!.targetId).toBeNull()
    const response=await c.request.get('/notifications/v1/events/'+eventId+'/target')
    expect(response.status()).toBe(404)
  }finally{
    await aContext.close();await bContext.close();await cContext.close()
  }
})


test('P2 #198 encrypted local notification display preferences survive reload without changing server feed',async({page})=>{
  test.setTimeout(120000)
  await register(page)
  await page.goto('/notifications')
  await expect(page.getByTestId('notifications-list')).toContainText(
    'Событие безопасности',{timeout:30000})
  await page.getByTestId('notifications-settings').click()
  await expect(page).toHaveURL(/\/notifications\/settings$/)
  await expect(page.getByTestId('notification-setting-push')).toBeDisabled()
  const invitation=page.getByTestId('notification-setting-invitations')
  await invitation.uncheck()
  await page.getByTestId('notification-setting-badges').uncheck()
  // A quiet-hours schedule is a device-local presentation rule, NOT OS push.
  await page.getByTestId('notification-setting-quiet-enabled').check()
  await page.getByTestId('notification-setting-quiet-start').fill('22:00')
  await page.getByTestId('notification-setting-quiet-end').fill('08:00')
  await page.getByTestId('notification-settings-save').click()
  await expect(page.getByText('Сохранено в зашифрованном хранилище этого устройства.'))
    .toBeVisible()
  await page.reload()
  await expect(invitation).not.toBeChecked()
  await expect(page.getByTestId('notification-setting-badges')).not.toBeChecked()
  await expect(page.getByTestId('notification-setting-quiet-enabled')).toBeChecked()
  await expect(page.getByTestId('notification-setting-quiet-start')).toHaveValue('22:00')
  await expect(page.getByTestId('notification-setting-quiet-end')).toHaveValue('08:00')
  // Stored ciphertext cannot expose switches or event metadata.
  const raw=await page.evaluate(async()=>{
    const request=indexedDB.open('pb3-encrypted-notifications-v1')
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      request.onsuccess=()=>resolve(request.result)
      request.onerror=()=>reject(request.error)
    })
    try{
      const tx=db.transaction('preferences','readonly')
      const rows=tx.objectStore('preferences').getAll()
      return await new Promise<string>((resolve,reject)=>{
        rows.onsuccess=()=>resolve(JSON.stringify(rows.result))
        rows.onerror=()=>reject(rows.error)
      })
    }finally{db.close()}
  })
  expect(raw).not.toContain('invitations')
  expect(raw).not.toContain('badges')
  expect(raw).not.toContain('quietStart')
  expect(raw).not.toContain('quietEnabled')
  expect(raw).not.toContain('22:00')
  expect(raw).not.toContain('security')
  await page.goto('/notifications')
  await expect(page.getByTestId('notifications-list')).toContainText(
    'Событие безопасности',{timeout:30000})
  expect(await notices(page)).toHaveLength(1)
  // Even with badges hidden, critical security notices remain visible.
  await expect(page.locator('.notification-dot.isread')).toHaveCount(1)
})
