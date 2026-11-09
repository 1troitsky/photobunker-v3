import { test, expect, type Page } from '@playwright/test'

async function register(page: Page): Promise<string> {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Создать ключ' }).click()
  await expect(page.locator('#generated-key')).toHaveValue(/^PB2\./)
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button', { name: 'Завершить регистрацию' }).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  return (await page.locator('.foundation-card code').first().innerText()).trim()
}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    // Inspect the durable IndexedDB record directly, independent of Vue state.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pb3-encrypted-photo-outbox-v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const rows = await new Promise<any[]>((resolve, reject) => {
        const request = db.transaction('photos').objectStore('photos').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return Promise.all(rows.map(async row => ({
        accountId: row.accountId, photoId: row.photoId, operationId: row.operationId,
        state: row.state,
        assets: await Promise.all(row.assets.map(async (asset: any) => {
          const bytes = new Uint8Array(await asset.blob.arrayBuffer())
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
          return { kind: asset.kind, type: asset.blob.type, bytes: bytes.length,
            prefix: [...bytes.slice(0, 3)],
            digest: [...digest].map(x => x.toString(16).padStart(2, '0')).join(''),
            algorithm: asset.manifest.algorithm,
            plainBytes: asset.manifest.plainBytes,
            frames: asset.manifest.frames.length,
            declaredDigest: asset.sha256 }
        })),
      })))
    } finally { db.close() }
  })
}

async function captureOffline(page: Page) {
  await page.context().setOffline(true)
  await page.getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('link', { name: 'Камера', exact: true }).click()
  await expect.poll(() => page.locator('video').evaluate(el => (el as HTMLVideoElement).videoWidth))
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Сделать снимок' }).click()
  await expect(page.getByRole('status')).toContainText('Зашифровано и сохранено локально')
}

test('registration 503: busy feedback, retained operation ID, explicit retry succeeds', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Создать ключ' }).click()
  await expect(page.locator('#generated-key')).toHaveValue(/^PB2\./)
  await page.getByLabel('Я сохранил ключ восстановления').check()
  const operations: string[] = []
  page.on('request', req => {
    if (req.url().endsWith('/identity/v2/prepare')) operations.push(req.postDataJSON().operationId)
  })
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  await page.route('**/identity/v2/prepare', async route => {
    await blocked
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  })
  const finish = page.getByRole('button', { name: 'Завершить регистрацию' })
  await finish.click()
  await expect(finish).toBeDisabled()
  release()
  await expect(page.getByRole('alert')).toContainText('503')
  await expect(page.locator('#generated-key')).toHaveValue(/^PB2\./)
  await page.unroute('**/identity/v2/prepare')
  await finish.click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  expect(operations).toHaveLength(2)
  expect(operations[1]).toBe(operations[0])
})

test('ciphertext survives upload 503 and online reload; lost finalize ACK is idempotent', async ({ page }) => {
  const accountId = await register(page)
  await captureOffline(page)
  const before = await snapshot(page)
  expect(before).toHaveLength(1)
  expect(before[0].accountId).toBe(accountId)
  expect(before[0].state).toBe('queued')
  expect(before[0].assets.map(a => a.kind).sort()).toEqual(['master', 'metadata'])
  for (const asset of before[0].assets) {
    expect(asset.algorithm).toBe('AES-256-GCM')
    expect(asset.type).toBe('application/octet-stream')
    expect(asset.prefix.slice(0, 2)).not.toEqual([0xff, 0xd8]) // no raw JPEG
    expect(asset.bytes).toBe(asset.plainBytes + 16 * asset.frames)
    expect(asset.digest).toBe(asset.declaredDigest)
  }
  await page.route('**/photos/v1/reserve', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
  await page.context().setOffline(false)
  await page.getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('link', { name: 'Browser', exact: true }).click()
  await page.getByRole('button', { name: 'Синхронизировать' }).click()
  await expect(page.locator('.photo-row').first()).toContainText('retry')
  await page.reload()
  await expect(page.locator('.photo-row').first()).toContainText('retry')
  const afterReload = await snapshot(page)
  expect(afterReload[0].operationId).toBe(before[0].operationId)
  expect(afterReload[0].assets).toEqual(before[0].assets)
  await page.unroute('**/photos/v1/reserve')
  let lostAck = 0
  await page.route('**/photos/v1/*/finalize', async route => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    lostAck++
    await route.abort('connectionreset')
  })
  await page.getByRole('button', { name: 'Синхронизировать' }).click()
  await expect.poll(() => lostAck).toBe(1)
  // The lifecycle may already have retried the committed reservation and
  // recovered its receipt. Both retained retry and confirmed sync are valid.
  await expect(page.locator('.photo-row').first()).toContainText(/retry|synced/)
  await page.unroute('**/photos/v1/*/finalize')
  await page.reload()
  const sync = page.getByRole('button', { name: 'Синхронизировать' })
  await sync.click()
  // A persisted 'synced' row can render before the new session proof finishes.
  await expect(sync).toBeEnabled()
  await expect(page.locator('.photo-row').first()).toContainText('synced')
  const final = await snapshot(page)
  expect(final).toHaveLength(1)
  expect(final[0].operationId).toBe(before[0].operationId)
  expect(final[0].assets).toEqual(before[0].assets)
  const count = await page.evaluate(async () => {
    const response = await fetch('/photos/v1', { credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error('acceptance.cloud_list_http_' + response.status)
    return (await response.json()).items.length
  })
  expect(count).toBe(1)
  await page.getByRole('button', { name: 'Проверить из облака' }).click()
  await expect.poll(() => page.locator('img.decrypted-preview')
    .evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
})

test('same browser account switch isolates the retained encrypted queue', async ({ page }) => {
  const oldAccount = await register(page)
  await captureOffline(page)
  const original = await snapshot(page)
  await page.getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('link', { name: 'Настройки', exact: true }).click()
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Доступ закрыт на этом устройстве.')
  await page.context().setOffline(false)
  const newAccount = await register(page)
  expect(newAccount).not.toBe(oldAccount)
  await page.goto('/browser')
  await expect(page.getByText('Пока нет локально зашифрованных снимков.')).toBeVisible()
  const stillStored = await snapshot(page)
  expect(stillStored[0].assets).toEqual(original[0].assets)
  const denied = await page.evaluate(async id => {
    const path = '/src/features/photo-sync/application/p1-photo.ts'
    const module = await import(path)
    try { await module.readLocalPhoto(id); return false } catch { return true }
  }, original[0].photoId)
  expect(denied).toBe(true)
  await page.reload()
  await expect(page.getByText('Пока нет локально зашифрованных снимков.')).toBeVisible()
  expect((await snapshot(page))[0].assets).toEqual(original[0].assets)
})

test('camera denial is visible and retryable; leaving camera stops its tracks', async ({ page }) => {
  await register(page)
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    let deny = true
    navigator.mediaDevices.getUserMedia = constraints => {
      if (deny) { deny = false; return Promise.reject(new DOMException('Acceptance camera denied', 'NotAllowedError')) }
      return original(constraints)
    }
  })
  await page.getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('link', { name: 'Камера', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Acceptance camera denied')
  await expect(page.getByRole('button', { name: 'Сделать снимок' })).toBeDisabled()
  await page.getByRole('button', { name: 'Включить камеру' }).click()
  await expect.poll(() => page.locator('video').evaluate(el => (el as HTMLVideoElement).videoWidth))
    .toBeGreaterThan(0)
  await page.locator('video').evaluate(el => {
    (window as any).__acceptanceTracks = ((el as HTMLVideoElement).srcObject as MediaStream).getTracks()
  })
  await page.getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('link', { name: 'Browser', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__acceptanceTracks.every((t: MediaStreamTrack) => t.readyState === 'ended')))
    .toBe(true)
})

test('mobile widths, keyboard activation, route back and viewport evidence', async ({ page, browser }, info) => {
  for (const width of [320, 375, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Настройки / Доступ' })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect.soft(overflow, `Horizontal overflow at ${width}px`).toBe(false)
  }
  const create = page.getByRole('button', { name: 'Создать ключ' })
  await create.focus()
  await expect(create).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#generated-key')).toHaveValue(/^PB2\./)
  // Drop the synthetic key from the DOM before taking any screenshot.
  await page.goto('/contacts')
  await page.getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('link', { name: 'Камера', exact: true }).click()
  await expect(page).toHaveURL(/\/camera$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/contacts$/)
  await page.setViewportSize({ width: 390, height: 844 })
  await info.attach('mobile-390', { body: await page.screenshot(), contentType: 'image/png' })
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  try {
    const phone = await touch.newPage()
    await phone.goto('/settings')
    await phone.getByRole('navigation', { name: 'Главная навигация' })
      .getByRole('link', { name: 'Камера', exact: true }).tap()
    await expect(phone).toHaveURL(/\/camera$/)
    await expect(phone.getByText('Для съёмки нужен анонимный аккаунт.')).toBeVisible()
    await info.attach('touch-390', { body: await phone.screenshot(), contentType: 'image/png' })
  } finally { await touch.close() }
})

test('cold offline reload: application shell must remain available', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Настройки / Доступ' })).toBeVisible()
  await page.context().setOffline(true)
  // A real reload, not a Vue route change; documents a known release gate.
  await page.reload({ timeout: 15_000 }).catch(() => {})
  await expect(page.getByRole('heading', { name: 'Настройки / Доступ' })).toBeVisible({ timeout: 3000 })
})
