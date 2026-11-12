import { test, expect, type Page } from '@playwright/test'

/**
 * REAL network boundary tests against the disposable PostgreSQL/Garage stack.
 * Encrypted media is created by the production client; no mock auth, mock
 * crypto, fake media endpoints or disabled regression gates.
 *
 * Playwright intercepts only faults on actual HTTP requests/responses.
 * Expired grant/signature token tests require a separate time-controlled,
 * independently signed issuer fixture and are NOT claimed by this suite.
 */
async function enroll(page: Page): Promise<string> {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Создать ключ' }).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button', { name: 'Завершить регистрацию' }).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  await page.evaluate(async () => {
    const identity = await import('/src/features/identity/application/session.ts')
    await identity.reauthenticate()
  })
  return page.evaluate(async () => {
    const identity = await import('/src/features/identity/application/session.ts')
    return identity.requireSession().accountId
  })
}

async function localState(page: Page, id: string) {
  return page.evaluate(async mediaId => {
    const media = await import('/src/features/media/application/media-outbox.ts')
    const row = (await media.listLocalMedia()).find(item => item.mediaId === mediaId)
    return row
      ? {
          state: row.state,
          lastError: row.lastError ?? null,
          operationId: row.operationId,
          count: row.chunks.length,
          containsPlaintextName: JSON.stringify(row).includes('PRIVATE-FAULT-INJECTION'),
          ciphertextOnly: row.chunks.every(c => c.blob.type === 'application/octet-stream'),
        }
      : null
  }, id)
}

test('P1-25 lost finalize ACK: real commit, offline E2EE outbox, idempotent replay, stranger denied', async ({ browser }) => {
  test.setTimeout(180_000)
  const ownerContext = await browser.newContext()
  const outsiderContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  const outsider = await outsiderContext.newPage()
  try {
    const ownerId = await enroll(owner)
    await owner.goto('/browser')
    const panel = owner.locator('.media-import-p1')
    await expect(panel.getByTestId('media-import-file')).toBeEnabled()

    await ownerContext.setOffline(true)
    const inputBytes = Buffer.alloc(14413, 0x6b)
    await panel.getByTestId('media-import-file').setInputFiles({
      name: 'PRIVATE-FAULT-INJECTION-LOSS.wav',
      mimeType: 'audio/wav',
      buffer: inputBytes,
    })
    await expect(panel.getByText(/Файл зашифрован и сохранён/)).toBeVisible()
    const initial = await owner.evaluate(async () => {
      const media = await import('/src/features/media/application/media-outbox.ts')
      const [row] = await media.listLocalMedia()
      if (!row) throw Error('fault.no_durable_ciphertext')
      return { id: row.mediaId, state: row.state }
    })
    expect(initial.state).toBe('queued')
    const sealed = await localState(owner, initial.id)
    expect(sealed).toMatchObject({
      state: 'queued', containsPlaintextName: false, ciphertextOnly: true,
    })

    let realFinalize = 0
    let discardedAck = 0
    await owner.route('**/media/v1/*/finalize', async route => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      if (discardedAck === 0) {
        // Commit the REAL signed operation to the server first. Only its
        // successful HTTP response is discarded, simulating a lost ACK.
        const response = await route.fetch()
        realFinalize = response.status()
        if (!response.ok()) {
          await route.fulfill({ response })
          return
        }
        discardedAck++
        await route.abort('failed')
        return
      }
      await route.continue()
    })

    await ownerContext.setOffline(false)
    await panel.getByRole('button', { name: 'Отправить медиа' }).click()
    await expect.poll(() => discardedAck, { timeout: 35_000 }).toBe(1)
    expect(realFinalize).toBe(200)

    // A lost transport response must not make the persisted encrypted upload
    // disappear. Replayed reserve/finalize returns the same verified receipt.
    await owner.evaluate(async () => {
      const identity = await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
      const media = await import('/src/features/media/application/media-outbox.ts')
      await media.synchronizeMedia()
    })
    await expect.poll(async () => (await localState(owner, initial.id))?.state, {
      timeout: 30_000,
    }).toBe('synced')

    const receiptProof = await owner.evaluate(async mediaId => {
      const media = await import('/src/features/media/application/media-outbox.ts')
      const api = await import('/src/features/identity/infrastructure/api.ts')
      const row = (await media.listLocalMedia()).find(item => item.mediaId === mediaId)
      if (!row) throw Error('fault.lost_local_row')
      const endpoint = '/media/v1/' + encodeURIComponent(mediaId) + '/finalize'
      const first = await api.jsonApi<{receipt: import('/src/features/media/application/media-outbox.ts').MediaReceipt}>(
        endpoint, 'POST', { operationId: row.operationId },
      )
      const again = await api.jsonApi<typeof first>(
        endpoint, 'POST', { operationId: row.operationId },
      )
      await media.verifyReceipt(row.contract, first.receipt)
      await media.verifyReceipt(row.contract, again.receipt)
      let wrongOperationError = ''
      try {
        await api.jsonApi(endpoint, 'POST', { operationId: crypto.randomUUID() })
      } catch (error) {
        wrongOperationError = error instanceof Error ? error.message : ''
      }
      const server = await media.listCloudMedia()
      const readback = await media.readCloudMedia(mediaId)
      const bytes = new Uint8Array(await readback.blob.arrayBuffer())
      return {
        identicalReceipt: JSON.stringify(first.receipt) === JSON.stringify(again.receipt),
        serverOccurrences: server.items.filter(item => item.mediaId === mediaId).length,
        serverCount: server.items.length,
        wrongOperationError,
        bytes: bytes.length,
        firstByte: bytes[0],
        lastByte: bytes[bytes.length - 1],
        leakedName: JSON.stringify(first).includes('PRIVATE-FAULT-INJECTION'),
      }
    }, initial.id)
    expect(receiptProof).toEqual({
      identicalReceipt: true,
      serverOccurrences: 1,
      serverCount: 1,
      wrongOperationError: 'api.http_409',
      bytes: 14413,
      firstByte: 0x6b,
      lastByte: 0x6b,
      leakedName: false,
    })

    const outsiderId = await enroll(outsider)
    expect(outsiderId).not.toBe(ownerId)
    const denied = await outsider.evaluate(async mediaId => {
      const [manifest, list] = await Promise.all([
        fetch('/media/v1/' + mediaId + '/manifests', {
          credentials: 'same-origin', headers: { Accept: 'application/json' },
        }),
        fetch('/media/v1', {
          credentials: 'same-origin', headers: { Accept: 'application/json' },
        }),
      ])
      return {
        manifestStatus: manifest.status,
        visible: (await list.json()).items.length,
      }
    }, initial.id)
    expect(denied).toEqual({ manifestStatus: 404, visible: 0 })
  } finally {
    await ownerContext.close()
    await outsiderContext.close()
  }
})

test('P1-25 corrupt AES-GCM ciphertext on PUT and GET: no false ACK, then clean retry', async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await enroll(page)
    await page.goto('/browser')
    const panel = page.locator('.media-import-p1')
    await expect(panel.getByTestId('media-import-file')).toBeEnabled()
    await context.setOffline(true)
    await panel.getByTestId('media-import-file').setInputFiles({
      name: 'PRIVATE-FAULT-INJECTION-CORRUPT.webm',
      mimeType: 'video/webm',
      buffer: Buffer.alloc(18021, 0x5e),
    })
    await expect(panel.getByText(/Файл зашифрован и сохранён/)).toBeVisible()
    const mediaId = await page.evaluate(async () => {
      const media = await import('/src/features/media/application/media-outbox.ts')
      const [row] = await media.listLocalMedia()
      if (!row || row.state !== 'queued') throw Error('fault.missing_offline_row')
      return row.mediaId
    })

    let corruptUploads = 0
    let rejectedHttp = 0
    let poison = true
    const chunkPattern = '**/media/v1/*/chunks/*'
    await page.route(chunkPattern, async route => {
      if (route.request().method() !== 'PUT' || !poison) {
        await route.continue()
        return
      }
      const requestBody = route.request().postDataBuffer()
      if (!requestBody || requestBody.length === 0) {
        throw Error('fault.no_encrypted_request_body')
      }
      // Keep original length and all HTTP auth headers. Change one byte of
      // the genuine AES-GCM ciphertext AFTER the device signed the manifest.
      const tampered = Buffer.from(requestBody)
      tampered[0] ^= 1
      const response = await route.fetch({ postData: tampered })
      corruptUploads++
      rejectedHttp = response.status()
      await route.fulfill({ response })
    })

    await context.setOffline(false)
    await panel.getByRole('button', { name: 'Отправить медиа' }).click()
    await expect.poll(() => corruptUploads, { timeout: 30_000 }).toBeGreaterThan(0)
    expect(rejectedHttp).toBe(503)
    await expect.poll(async () => (await localState(page, mediaId))?.state, {
      timeout: 25_000,
    }).toBe('retry')

    // No unverified artifact is allowed into the owner's cloud index.
    const before = await page.evaluate(async id => {
      const m = await import('/src/features/media/application/media-outbox.ts')
      const list = await m.listCloudMedia()
      return list.items.filter(item => item.mediaId === id).length
    }, mediaId)
    expect(before).toBe(0)

    poison = false
    await page.unroute(chunkPattern)
    await page.evaluate(async () => {
      const m = await import('/src/features/media/application/media-outbox.ts')
      await m.synchronizeMedia()
    })
    await expect.poll(async () => (await localState(page, mediaId))?.state, {
      timeout: 35_000,
    }).toBe('synced')

    let tamperedReads = 0
    await page.route(chunkPattern, async route => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      const response = await route.fetch()
      if (!response.ok()) {
        await route.fulfill({ response })
        return
      }
      const bytes = Buffer.from(await response.body())
      if (!bytes.length) throw Error('fault.empty_ciphertext_read')
      bytes[0] ^= 1
      tamperedReads++
      // Original X-Cipher-SHA256 remains unchanged. The client must reject
      // the response BEFORE any AES-GCM plaintext is given to the caller.
      await route.fulfill({ response, body: bytes })
    })
    const corruptRead = await page.evaluate(async id => {
      const m = await import('/src/features/media/application/media-outbox.ts')
      try {
        await m.readCloudMedia(id)
        return 'unexpected_plaintext'
      } catch (error) {
        return error instanceof Error ? error.message : 'unknown_failure'
      }
    }, mediaId)
    expect(tamperedReads).toBeGreaterThan(0)
    expect(corruptRead).toBe('media.chunk_corrupt')
    await page.unroute(chunkPattern)

    // The persisted verified remote object still decrypts correctly:
    // interception modified only the response, not Garage.
    const original = await page.evaluate(async id => {
      const m = await import('/src/features/media/application/media-outbox.ts')
      const data = await m.readCloudMedia(id)
      const bytes = new Uint8Array(await data.blob.arrayBuffer())
      return {
        size: bytes.length,
        first: bytes[0],
        last: bytes[bytes.length - 1],
        state: (await m.listLocalMedia()).find(row => row.mediaId === id)?.state,
      }
    }, mediaId)
    expect(original).toEqual({
      size: 18021,
      first: 0x5e,
      last: 0x5e,
      state: 'synced',
    })
  } finally {
    await context.close()
  }
})
