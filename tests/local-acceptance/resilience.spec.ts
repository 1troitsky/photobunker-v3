import { test, expect } from '@playwright/test'
import { register, snapshot, captureOffline, confirmedSession } from './helpers'

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

test('ciphertext survives upload 503 and online reload; lost finalize ACK is idempotent', async ({ page }, info) => {
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
    expect(asset.prefix.slice(0, 2)).not.toEqual([0xff, 0xd8])
    expect(asset.bytes).toBe(asset.plainBytes + 16 * asset.frames)
    expect(asset.digest).toBe(asset.declaredDigest)
  }
  const stages: string[] = ['encrypted-local']
  async function retained(stage: string) {
    const rows = await snapshot(page)
    expect(rows).toHaveLength(1)
    expect(rows[0].accountId).toBe(accountId)
    expect(rows[0].photoId).toBe(before[0].photoId)
    expect(rows[0].operationId).toBe(before[0].operationId)
    expect(rows[0].assets).toEqual(before[0].assets)
    stages.push(stage)
  }
  // Hold subsequent reserve retries after a committed finalization, making
  // the lost-ACK -> reload boundary deterministic even with auto recovery.
  let unavailable = true
  let committed = false
  let lostAck = 0
  let originalRequest: {contract: string; signature: string} | undefined
  await page.route('**/photos/v1/reserve', async route => {
    if (unavailable || committed) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    } else {
      originalRequest = route.request().postDataJSON()
      await route.continue()
    }
  })
  await page.context().setOffline(false)
  await page.getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('link', { name: 'Browser', exact: true }).click()
  const sync = page.getByRole('button', { name: 'Синхронизировать' })
  await sync.click()
  await expect(sync).toBeEnabled()
  await expect(page.locator('.photo-row').first()).toContainText('retry')
  await retained('upload-503')
  await page.reload()
  await confirmedSession(page)
  await retained('reload-after-503')
  unavailable = false
  await page.route('**/photos/v1/*/finalize', async route => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    committed = true
    lostAck++
    await route.abort('connectionreset')
  })
  await sync.click()
  await expect.poll(() => lostAck).toBe(1)
  await expect(sync).toBeEnabled()
  await retained('server-committed-ack-lost')
  await page.reload()
  await confirmedSession(page)
  await retained('reload-after-lost-ack')
  await page.unroute('**/photos/v1/reserve')
  await page.unroute('**/photos/v1/*/finalize')
  await sync.click()
  await expect(sync).toBeEnabled()
  await expect(page.locator('.photo-row').first()).toContainText('synced')
  await retained('retry-confirmed')
  expect(originalRequest).toBeDefined()
  // Send the exact signed wire operation twice, rather than calling a flush
  // that legitimately skips already-synced rows. No state/DB mutation in QA.
  const server = await page.evaluate(async request => {
    const path = '/src/features/identity/infrastructure/api.ts'
    const {jsonApi} = await import(path)
    const replies = []
    for (let attempt = 0; attempt < 2; attempt++) {
      replies.push((await jsonApi('/photos/v1/reserve', 'POST', request)).state)
    }
    const listing = await jsonApi('/photos/v1')
    return {replies, count: listing.items.length, photoId: listing.items[0]?.photoId}
  }, originalRequest!)
  expect(server.replies).toEqual(['active', 'active'])
  expect(server.count).toBe(1)
  expect(server.photoId).toBe(before[0].photoId)
  await retained('duplicate-requests')
  const downloads: number[] = []
  page.on('response', response => {
    if (response.request().method() === 'GET' && /\/photos\/v1\/[^/]+\/objects\//.test(response.url())) {
      downloads.push(response.status())
    }
  })
  await page.getByRole('button', { name: 'Обновить', exact: true }).click()
  await page.getByRole('button', { name: 'Проверить из облака' }).click()
  const image = page.locator('img.decrypted-preview')
  await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  expect(downloads.length).toBeGreaterThan(0)
  expect(downloads.every(status => status === 200)).toBe(true)
  const matchingPlaintext = await image.evaluate(async (el, photoId) => {
    const path = '/src/features/photo-sync/application/p1-photo.ts'
    const {readLocalPhoto} = await import(path)
    const local = await readLocalPhoto(photoId)
    const cloud = await (await fetch((el as HTMLImageElement).src)).blob()
    const digest = async (blob: Blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].join(',')
    return await digest(local) === await digest(cloud)
  }, before[0].photoId)
  expect(matchingPlaintext).toBe(true)
  await retained('garage-download-decrypted')
  await info.attach('lost-ack-proof', {contentType: 'application/json', body: JSON.stringify({
    stages, lostAcknowledgements: lostAck, signedReplays: server.replies.length,
    serverPhotoCount: server.count, objectDownloads: downloads.length,
    ciphertextRetained: true, cloudPlaintextMatchesLocal: matchingPlaintext,
  })})
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
