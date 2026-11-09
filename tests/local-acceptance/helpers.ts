import { expect, type Page } from '@playwright/test'

export async function register(page: Page): Promise<string> {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Создать ключ' }).click()
  await expect(page.locator('#generated-key')).toHaveValue(/^PB2\./)
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button', { name: 'Завершить регистрацию' }).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  return (await page.locator('.foundation-card code').first().innerText()).trim()
}

export async function snapshot(page: Page) {
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
          return { assetId: asset.assetId, kind: asset.kind, type: asset.blob.type, bytes: bytes.length,
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

export async function captureOffline(page: Page) {
  await page.context().setOffline(true)
  await page.getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('link', { name: 'Камера', exact: true }).click()
  await expect.poll(() => page.locator('video').evaluate(el => (el as HTMLVideoElement).videoWidth))
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Сделать снимок' }).click()
  await expect(page.getByRole('status')).toContainText('Зашифровано и сохранено локально')
}

export async function confirmedSession(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const path = '/src/features/identity/application/session.ts'
    const session = await import(path)
    if (!session.activeSession.value) await session.resumeExistingDevice()
    // reauthenticate joins the application's pending bootstrap proof without
    // starting a second hydration or rotating an already-confirmed session.
    await session.reauthenticate()
    if (!session.activeSession.value?.online) throw new Error('acceptance.session_not_confirmed')
  })
}
