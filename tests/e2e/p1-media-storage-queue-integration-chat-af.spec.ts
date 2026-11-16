import { expect, test } from '@playwright/test'

/**
 * #178 cross-feature gate: genuine Camera MediaFile ciphertext outbox visible in
 * Data & Storage while offline; real Garage PUT lost ACK; original shell retry
 * recovers, with signed server readback and no fabricated receipt.
 */
test('P1/P2 integration: Camera encrypted audio queue → Storage visibility → automatic server replay', async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  const fileName = 'PRIVATE-QUEUE-CAMERA-INTEGRATION.wav'
  const plainSize = 8192 + 31
  let lostAck = 0
  let physicalPut = 0
  try {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Создать ключ' }).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button', { name: 'Завершить регистрацию' }).click()
    await expect(page.locator('[data-testid="shell-status-link"][data-session-state="online"]')).toBeVisible()

    await page.goto('/camera')
    // A real signed session is needed after hard navigation; never mock auth.
    await page.evaluate(async () => {
      const identity = await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
      if (!identity.requireSession().online) throw Error('integration.session_unverified')
    })
    await context.setOffline(true)
    const mediaId = await page.evaluate(async ({ name, bytes }) => {
      const { enqueueEncryptedMedia, listLocalMedia } =
        await import('/src/features/media/application/media-outbox.ts')
      const payload = new Uint8Array(bytes).fill(83)
      payload[0] = 11
      payload[4096] = 19
      payload[payload.length - 1] = 29
      const id = await enqueueEncryptedMedia(new File([payload], name, { type: 'audio/wav' }))
      const stored = (await listLocalMedia()).find(row => row.mediaId === id)
      if (!stored || stored.state !== 'queued' || stored.chunks.length < 2
        || JSON.stringify(stored).includes(name)) throw Error('integration.unencrypted_media_queue')
      return id
    }, { name: fileName, bytes: plainSize })

    // Use real SPA navigation while offline, not an unavailable fresh network page.
    await page.getByRole('navigation', { name: 'Главная навигация' })
      .getByRole('link', { name: 'Настройки' }).click()
    await page.getByTestId('settings-nav-data-storage').click()
    await expect(page.getByTestId('storage-local-ready')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('storage-server-offline')).toBeVisible()
    await expect(page.getByTestId('storage-local-pending-count')).toHaveText('1')
    await page.getByTestId('storage-open-queue').click()
    await expect(page.getByTestId('storage-queue-item')).toHaveCount(1)
    await expect(page.getByTestId('storage-queue-item')).toContainText('Аудио')
    await expect(page.getByTestId('storage-queue-item')).toContainText('шифротекста')
    await expect(page.getByTestId('storage-retry-queue')).toBeDisabled()

    await page.getByRole('navigation', { name: 'Главная навигация' })
      .getByRole('link', { name: 'Камера' }).click()
    await expect(page).toHaveURL(/\/camera$/)

    // Real backend/Garage receives the first encrypted PUT; only the HTTP
    // response is deliberately lost, as in source #390. No fake 200 or ACK.
    await page.route('**/media/v1/*/chunks/*', async route => {
      if (route.request().method() !== 'PUT' || lostAck) {
        await route.continue()
        return
      }
      const response = await route.fetch()
      physicalPut = response.status()
      lostAck++
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify({ error: 'integration_lost_ack' }),
      })
    })
    await context.setOffline(false)
    await expect.poll(() => lostAck, { timeout: 30_000 }).toBe(1)
    expect(physicalPut).toBe(200)

    // No user-triggered retry and no Browser mount; automatic coordinator
    // must replay durable ciphertext and obtain an actual server receipt.
    await expect.poll(() => page.evaluate(async id => {
      const { listLocalMedia } = await import('/src/features/media/application/media-outbox.ts')
      return (await listLocalMedia()).find(row => row.mediaId === id)?.state
    }, mediaId), { timeout: 100_000, intervals: [250, 500, 1000, 2000] }).toBe('synced')

    const cloud = await page.evaluate(async id => {
      const { readCloudMedia } = await import('/src/features/media/application/media-outbox.ts')
      const response = await fetch('/media/v1/' + id + '/manifests', {
        credentials: 'same-origin', cache: 'no-store',
      })
      if (response.status !== 200) throw Error('integration.missing_signed_manifest')
      const manifest = await response.json()
      const original = await readCloudMedia(id)
      const bytes = new Uint8Array(await original.blob.arrayBuffer())
      return {
        receipt: manifest.receipt?.receiptHash,
        leaks: JSON.stringify(manifest).includes('PRIVATE-QUEUE-CAMERA-INTEGRATION'),
        name: original.metadata.fileName,
        type: original.blob.type, size: bytes.length,
        first: bytes[0], middle: bytes[4096], last: bytes.at(-1),
      }
    }, mediaId)
    expect(cloud.receipt).toMatch(/^[a-f0-9]{64}$/)
    expect(cloud).toMatchObject({
      leaks: false, name: fileName, type: 'audio/wav',
      size: plainSize, first: 11, middle: 19, last: 29,
    })

    await page.getByRole('navigation', { name: 'Главная навигация' })
      .getByRole('link', { name: 'Настройки' }).click()
    await page.getByTestId('settings-nav-data-storage').click()
    await expect(page.getByTestId('storage-local-ready')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('storage-local-pending-count')).toHaveText('0')
    await page.getByTestId('storage-open-queue').click()
    await expect(page.getByTestId('storage-queue-item')).toHaveCount(0)
    await expect(page.getByTestId('storage-server-ready')).toBeVisible({ timeout: 30_000 })
  } finally {
    await context.close()
  }
})
