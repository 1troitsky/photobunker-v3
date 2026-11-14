import { expect, test } from '@playwright/test'

/**
 * #390: actual Camera route, real key-only user, production AES-GCM IndexedDB
 * outbox, PostgreSQL18 + Garage. Only the *HTTP response* to the first real
 * ciphertext PUT is replaced with 503. No fabricated reserve/finalize receipt,
 * no manual sync, route transition, foreground/online event after failure.
 */
test('P1 #390 Camera keeps retrying a verified lost chunk ACK without opening Browser', async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await browser.newContext()
  const page = await context.newPage()
  const filename = 'PRIVATE-P1-390-CAMERA.wav'
  const plainSize = 8192 + 17
  let forwardedPutStatus = 0
  let lostAck = 0
  try {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Создать ключ' }).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button', { name: 'Завершить регистрацию' }).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/camera')
    await page.evaluate(async () => {
      const identity = await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
      if (!identity.requireSession().online) throw Error('qa390.session_not_online')
    })

    await context.setOffline(true)
    const mediaId = await page.evaluate(async ({ fileName, length }) => {
      const media = await import('/src/features/media/application/media-outbox.ts')
      const source = new Uint8Array(length).fill(71)
      source[0] = 11
      source[4096] = 19
      source[source.length - 1] = 29
      const mediaId = await media.enqueueEncryptedMedia(
        new File([source], fileName, { type: 'audio/wav' }))
      const row = (await media.listLocalMedia()).find(item => item.mediaId === mediaId)
      if (!row || row.state !== 'queued' || row.chunks.length < 2
        || JSON.stringify(row).includes(fileName)) {
        throw Error('qa390.encrypted_offline_outbox_missing')
      }
      return mediaId
    }, { fileName: filename, length: plainSize })

    await page.route('**/media/v1/*/chunks/*', async route => {
      if (route.request().method() !== 'PUT' || lostAck !== 0) {
        await route.continue()
        return
      }
      // The ciphertext PUT really commits to Garage; only its response to
      // the PWA is lost. The durable original ciphertext must be replayed.
      const backend = await route.fetch()
      forwardedPutStatus = backend.status()
      lostAck += 1
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify({ error: 'qa390_transient_lost_ack' }),
      })
    })
    await context.setOffline(false)

    await expect.poll(() => lostAck, { timeout: 30_000 }).toBe(1)
    expect(forwardedPutStatus).toBe(200)
    await expect.poll(() => page.evaluate(async id => {
      const media = await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia()).find(item => item.mediaId === id)?.state
    }, mediaId), { timeout: 30_000 }).toBe('retry')

    // Deliberately do NOTHING else: no synchronizeMedia(), Browser mount,
    // reload, changing online state, or visibility event. The global app
    // coordinator must schedule a bounded retry while staying on Camera.
    await expect.poll(() => page.evaluate(async id => {
      const media = await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia()).find(item => item.mediaId === id)?.state
    }, mediaId), { timeout: 100_000, intervals: [250, 500, 1000, 2000] }).toBe('synced')
    expect(lostAck).toBe(1)
    expect(new URL(page.url()).pathname).toBe('/camera')

    const verified = await page.evaluate(async id => {
      const media = await import('/src/features/media/application/media-outbox.ts')
      const response = await fetch('/media/v1/' + id + '/manifests', {
        credentials: 'same-origin', cache: 'no-store',
      })
      if (response.status !== 200) throw Error('qa390.signed_finalize_missing')
      const manifest = await response.json()
      const recovered = await media.readCloudMedia(id)
      const bytes = new Uint8Array(await recovered.blob.arrayBuffer())
      return {
        receipt: manifest.receipt?.receiptHash,
        publicLeaks: JSON.stringify(manifest).includes('PRIVATE-P1-390'),
        size: bytes.length,
        name: recovered.metadata.fileName,
        mime: recovered.blob.type,
        first: bytes[0],
        middle: bytes[4096],
        last: bytes.at(-1),
      }
    }, mediaId)
    expect(verified.receipt).toMatch(/^[a-f0-9]{64}$/)
    expect(verified).toMatchObject({
      publicLeaks: false, size: plainSize, name: filename,
      mime: 'audio/wav', first: 11, middle: 19, last: 29,
    })
  } finally {
    await context.close()
  }
})
