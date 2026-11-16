import { test, expect } from '@playwright/test'

test('P2 Data & Storage: real encrypted offline queue, server usage and logout privacy', async ({ browser }) => {
  test.setTimeout(180000)
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  })
  const page = await context.newPage()
  try {
    await page.goto('/settings/storage')
    await expect(page.getByTestId('storage-signed-out')).toBeVisible()
    await expect(page.getByTestId('storage-local-ready')).toHaveCount(0)
    await expect(page.getByTestId('storage-server-ready')).toHaveCount(0)

    await page.getByRole('link', { name: 'Создать или восстановить аккаунт' }).click()
    await page.getByRole('button', { name: 'Создать ключ' }).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button', { name: 'Завершить регистрацию' }).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await expect(page.getByTestId('settings-nav-data-storage'))
      .toHaveAttribute('href', '/settings/storage')
    await page.getByTestId('settings-nav-data-storage').click()
    await expect(page.getByTestId('storage-local-ready')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('storage-server-ready')).toBeVisible({ timeout: 25000 })
    // Real owner GET must be reachable through the Vite dev proxy.
    const backupReply=await page.request.get('/backup/v1/limits')
    expect(backupReply.status()).toBe(200)
    await expect(page.getByTestId('storage-backup-technical-ready')).toBeVisible({timeout:25000})
    await expect(page.getByTestId('storage-backup-technical-ready'))
      .toContainText('не подтверждает')
    await expect(page.getByTestId('storage-backup-unavailable')).toBeVisible()
    await expect(page.getByTestId('storage-local-pending-count')).toHaveText('0')
    await expect(page.getByTestId('storage-effective-plan')).toHaveText('free')
    await expect(page.getByTestId('storage-recorded-cipher-bytes')).toHaveText('0 Б')
    await expect(page.getByTestId('storage-cloud-quota')).toBeVisible()
    await expect(page.getByTestId('storage-files-quota')).toBeVisible()
    // Owner-approved Storage 1.2: confirmed quota section is visually before
    // the local queue. Keep the encrypted queue available offline as a sibling.
    const quotaBox=await page.getByTestId('storage-cloud-section').boundingBox()
    const localBox=await page.getByTestId('storage-open-queue').boundingBox()
    expect(quotaBox&&localBox&&quotaBox.y+quotaBox.height<=localBox.y+2).toBe(true)
    await expect(page.getByTestId('storage-cloud-quota').locator('progress')).toHaveAttribute('value','0')
    await expect(page.getByTestId('storage-backup-unavailable')).toBeVisible()
    await expect(page.getByRole('button',{name:'Управление копиями и автообновлением'})).toBeDisabled()
    await expect(page.getByRole('button',{name:'Очистить кэш'})).toBeDisabled()

    // Real AES-GCM local Photo objects are created while disconnected. No
    // server ACK, fake sync, browser gallery or OS Camera Roll is involved.
    await context.setOffline(true)
    await expect(page.getByTestId('storage-server-offline')).toBeVisible()
    await expect(page.getByTestId('storage-backup-technical-ready')).toHaveCount(0)
    const result = await page.evaluate(async () => {
      const { captureEncrypted } = await import('/src/features/photo-sync/application/p1-photo.ts')
      const canvas = document.createElement('canvas')
      canvas.width = 16; canvas.height = 16
      const ctx = canvas.getContext('2d')
      if (!ctx) throw Error('canvas unavailable')
      ctx.fillStyle = '#127733'
      ctx.fillRect(0, 0, 16, 16)
      const jpeg = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(Error('no jpeg')), 'image/jpeg')
      })
      const stored = await captureEncrypted(jpeg)
      return {
        photoId: stored.photoId,
        state: stored.state,
        bytes: stored.assets.reduce((sum, a) => sum + a.blob.size, 0),
      }
    })
    expect(result.state).toBe('queued')
    expect(result.bytes).toBeGreaterThan(0)
    await page.getByTestId('storage-refresh').click()
    await expect(page.getByTestId('storage-local-ready')).toBeVisible()
    await expect(page.getByTestId('storage-local-pending-count')).toHaveText('1')
    await expect(page.getByTestId('storage-local-pending-bytes')).not.toHaveText('0 Б')
    await expect(page.getByTestId('storage-local-pending-bytes')).not.toContainText('МиБ')
    await expect(page.getByTestId('storage-server-ready')).toHaveCount(0)

    // Real ciphertext rows must be inspectable, not just a cosmetic counter.
    await expect(page.getByTestId('storage-queue-summary')).toContainText('1 файл')
    await page.getByTestId('storage-open-queue').click()
    await expect(page.getByTestId('storage-queue-detail')).toBeVisible()
    await expect(page.getByTestId('storage-queue-item')).toHaveCount(1)
    await expect(page.getByTestId('storage-queue-item')).toContainText('Фото')
    await expect(page.getByTestId('storage-queue-state')).toContainText('Ожидает отправки')
    await expect(page.getByTestId('storage-queue-item')).toContainText('шифротекста')
    await page.getByTestId('storage-queue-filter-conflict').click()
    await expect(page.getByTestId('storage-queue-item')).toHaveCount(0)
    await expect(page.getByTestId('storage-queue-empty')).toBeVisible()
    await page.getByTestId('storage-queue-filter-pending').click()
    await expect(page.getByTestId('storage-queue-item')).toHaveCount(1)
    await expect(page.getByTestId('storage-server-ready')).toHaveCount(0)
    // Offline manual retry is disabled: no false success or lost ciphertext.
    await expect(page.getByTestId('storage-retry-queue')).toBeDisabled()

    // Force a genuine transient transport error during automatic reconnect.
    // All later successful requests MUST reach the real API / PG18 / Garage.
    await page.route('**/photos/v1/reserve', route => route.abort('failed'))
    await context.setOffline(false)
    await page.evaluate(async () => {
      const { flushOutbox } = await import('/src/features/photo-sync/application/p1-photo.ts')
      await flushOutbox()
    })
    await expect.poll(async () => page.evaluate(async () => {
      const { listLocalPhotos } = await import('/src/features/photo-sync/application/p1-photo.ts')
      return (await listLocalPhotos())[0]?.state
    }), { timeout: 20000 }).toBe('retry')
    await page.unroute('**/photos/v1/reserve')
    await page.getByTestId('storage-refresh').click()
    await expect(page.getByTestId('storage-local-pending-count')).toHaveText('1')
    await expect(page.getByTestId('storage-retry-queue')).toBeEnabled()
    await page.getByTestId('storage-retry-queue').click()
    await expect(page.getByTestId('storage-retry-notice')).toContainText(
      'больше нет ожидающих файлов', { timeout: 45000 })
    await expect(page.getByTestId('storage-local-pending-count')).toHaveText('0')
    await expect(page.getByTestId('storage-queue-item')).toHaveCount(0)
    // Server authorization, real S3 ciphertext readback and local AEAD
    // decryption prove this was not a fake UI ACK.
    const verified = await page.evaluate(async photoId => {
      const { listCloudPhotos, readCloudPhoto } =
        await import('/src/features/photo-sync/application/p1-photo.ts')
      const list = await listCloudPhotos()
      const blob = await readCloudPhoto(photoId)
      return { listed: list.items.some(x => x.photoId === photoId), bytes: blob.size }
    }, result.photoId)
    expect(verified.listed).toBe(true)
    expect(verified.bytes).toBeGreaterThan(128)

    await expect(page.getByTestId('storage-server-ready')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('storage-effective-plan')).toHaveText('free')

    await page.getByRole('navigation', { name: 'Главная навигация' })
      .getByRole('link', { name: 'Настройки' }).click()
    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect(page.getByRole('button', { name: 'Создать ключ' })).toBeVisible()
    await page.goto('/settings/storage')
    // Owner-only technical limits must deny a signed-out browser.
    const deniedBackup=await page.request.get('/backup/v1/limits')
    expect(deniedBackup.status()).toBe(401)
    await expect(page.getByTestId('storage-signed-out')).toBeVisible()
    await expect(page.getByTestId('storage-local-ready')).toHaveCount(0)
    await expect(page.getByTestId('storage-queue-item')).toHaveCount(0)
    await expect(page.getByTestId('storage-server-ready')).toHaveCount(0)
  } finally {
    await context.close()
  }
})
