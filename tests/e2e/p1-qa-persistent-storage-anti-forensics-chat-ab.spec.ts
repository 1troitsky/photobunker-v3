import { expect, test, type Page } from '@playwright/test'

// #378: this is deliberately a narrow browser-origin anti-forensics check.
// Keep Playwright artifacts off: a failed assertion must not record recovery keys,
// decrypted screen contents, file bytes, or private import metadata.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

type PrivateMarkers = {
  recoveryKey: string
  filename: string
  category: string
  description: string
  tag: string
  payload: string
}

async function inspectOriginPersistence(page: Page, markers: PrivateMarkers) {
  return page.evaluate(async secrets => {
    const needles = Object.values(secrets).filter(value => value.length >= 12)
    const exposures = new Set<string>()
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const checked = new WeakSet<object>()
    let rows = 0
    let mediaRows = 0
    let cacheResponses = 0
    let inspectedBytes = 0

    function scanString(value: string, source: string): void {
      if (needles.some(secret => value.includes(secret))) exposures.add(source)
    }
    function scanBytes(value: Uint8Array, source: string): void {
      inspectedBytes += value.byteLength
      // Bound a test fixture to avoid accepting partial scans silently.
      if (value.byteLength > 8 * 1024 * 1024)
        throw Error('anti_forensics.unbounded_persistent_blob')
      const content = decoder.decode(value)
      scanString(content, source)
      // A UTF-8 decode cannot find a marker straddling malformed-byte chunks;
      // search its exact byte sequence as an independent check.
      for (const needle of needles) {
        const pattern = encoder.encode(needle)
        outer: for (let i = 0; i <= value.length - pattern.length; i++) {
          for (let j = 0; j < pattern.length; j++)
            if (value[i + j] !== pattern[j]) continue outer
          exposures.add(source)
          break
        }
      }
    }
    async function scan(value: unknown, source: string, depth = 0): Promise<void> {
      if (depth > 24) throw Error('anti_forensics.unbounded_persistence_nesting')
      if (typeof value === 'string') { scanString(value, source); return }
      if (value === null || typeof value !== 'object') return
      if (value instanceof CryptoKey) {
        if (value.extractable) throw Error('anti_forensics.extractable_stored_key')
        return
      }
      if (value instanceof Blob) {
        scanBytes(new Uint8Array(await value.arrayBuffer()), source)
        return
      }
      if (value instanceof ArrayBuffer) {
        scanBytes(new Uint8Array(value), source)
        return
      }
      if (ArrayBuffer.isView(value)) {
        scanBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), source)
        return
      }
      if (checked.has(value)) return
      checked.add(value)
      if (Array.isArray(value)) {
        for (const member of value) await scan(member, source, depth + 1)
      } else {
        for (const [key, member] of Object.entries(value)) {
          scanString(key, source)
          await scan(member, source, depth + 1)
        }
      }
    }

    for (const storage of [localStorage, sessionStorage]) {
      const source = storage === localStorage ? 'localStorage' : 'sessionStorage'
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key !== null) {
          scanString(key, source)
          scanString(storage.getItem(key) ?? '', source)
        }
      }
    }
    scanString(document.cookie, 'document.cookie')

    if (typeof indexedDB.databases !== 'function')
      throw Error('anti_forensics.indexeddb_enumeration_unavailable')
    const databases = await indexedDB.databases()
    let dbCount = 0
    for (const entry of databases) {
      if (!entry.name) continue
      const name = entry.name
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        request.onblocked = () => reject(Error('anti_forensics.db_blocked'))
      })
      dbCount++
      try {
        for (const storeName of Array.from(db.objectStoreNames)) {
          const values = await new Promise<unknown[]>((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly')
            const request = tx.objectStore(storeName).getAll()
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
            tx.onabort = () => reject(tx.error)
          })
          rows += values.length
          if (name === 'pb3-encrypted-media-outbox-v1' && storeName === 'files')
            mediaRows += values.length
          for (const item of values) await scan(item, 'indexedDB/' + name + '/' + storeName)
        }
      } finally { db.close() }
    }

    const names = await caches.keys()
    for (const name of names) {
      scanString(name, 'CacheStorage/key')
      const cache = await caches.open(name)
      const keys = await cache.keys()
      for (const request of keys) {
        scanString(request.url, 'CacheStorage/request')
        const response = await cache.match(request)
        if (!response) continue
        cacheResponses++
        scanBytes(new Uint8Array(await response.arrayBuffer()), 'CacheStorage/response')
      }
    }
    return {
      exposures: Array.from(exposures).sort(),
      dbCount, rows, mediaRows, cacheResponses, inspectedBytes,
    }
  }, markers)
}

test('P1 #378 genuine encrypted offline media stays private in persistent browser stores and logout revokes decoded blob', async ({ browser }) => {
  test.setTimeout(150_000)
  const context = await browser.newContext()
  const page = await context.newPage()
  let recoveryKey: string | null = null
  const filename = 'PB3-378-PRIVATE-FILENAME-UNIQUE.wav'
  const category = 'PB3-378-PRIVATE-CATEGORY'
  const description = 'PB3-378-PRIVATE-DESCRIPTION-DO-NOT-PERSIST'
  const tag = 'PB3-378-PRIVATE-TAG'
  const payload = 'PB3-378-PRIVATE-BINARY-CONTENT-' + 'q'.repeat(128)
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  try {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Создать ключ' }).click()
    recoveryKey = await page.locator('#generated-key').inputValue()
    expect(recoveryKey).toMatch(/^PB2\./)
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button', { name: 'Завершить регистрацию' }).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()

    // Existing Vite shell stays loaded: this is genuine warm Local-First,
    // not a claimed signed Service Worker or cold offline startup.
    await page.goto('/browser')
    const importPanel = page.locator('.media-import-p1')
    await expect(importPanel.getByTestId('media-import-file')).toBeEnabled()
    await context.setOffline(true)
    await importPanel.locator('#media-import-category').fill(category)
    await importPanel.locator('#media-import-description').fill(description)
    await importPanel.locator('#media-import-tags').fill(tag)
    await importPanel.getByTestId('media-import-file').setInputFiles({
      name: filename,
      mimeType: 'audio/wav',
      buffer: Buffer.from(payload.repeat(16), 'utf8'),
    })
    await expect(importPanel.getByText(/Файл зашифрован и сохранён/)).toBeVisible()
    const localRow = importPanel.locator('.photo-row').filter({ hasText: 'queued' }).first()
    await expect(localRow).toBeVisible()
    await localRow.getByRole('button', { name: 'Открыть' }).click()
    const decoded = importPanel.getByTestId('media-decrypted-preview')
    await expect(decoded).toContainText(filename)
    await expect(decoded).toContainText(description)
    const blobUrl = await decoded.locator('audio').getAttribute('src')
    expect(blobUrl).toMatch(/^blob:/)

    // Scan actual origin disk APIs, not merely an application JSON object.
    const markers = { recoveryKey, filename, category, description, tag, payload }
    const persisted = await inspectOriginPersistence(page, markers)
    expect(persisted.mediaRows).toBeGreaterThan(0)
    expect(persisted.dbCount).toBeGreaterThan(0)
    expect(persisted.inspectedBytes).toBeGreaterThan(0)
    expect(persisted.exposures).toEqual([])
    expect(downloads).toEqual([])

    // Exercise the REAL local logout while the decrypted Browser is mounted.
    // No remote logout ACK is asserted while genuinely offline.
    await page.evaluate(async () => {
      const identity = await import('/src/features/identity/application/session.ts')
      await identity.logout()
    })
    await expect(decoded).toHaveCount(0)
    await expect(importPanel.getByText('Нет импортированных файлов.')).toBeVisible()
    expect(await page.evaluate(async url => {
      try { return (await fetch(url)).ok } catch { return false }
    }, blobUrl!)).toBe(false)

    const afterLogout = await inspectOriginPersistence(page, markers)
    expect(afterLogout.exposures).toEqual([])
    expect(afterLogout.mediaRows).toBeGreaterThan(0) // durable CIPHERTEXT is preserved
    expect(downloads).toEqual([])

    await context.setOffline(false)
    await page.reload()
    await expect(importPanel.getByText('Нет импортированных файлов.')).toBeVisible()
    const signedOut = await page.evaluate(async () => {
      const identity = await import('/src/features/identity/application/session.ts')
      return identity.activeSession.value === null
    })
    expect(signedOut).toBe(true)
    const afterReload = await inspectOriginPersistence(page, markers)
    expect(afterReload.exposures).toEqual([])
    expect(afterReload.mediaRows).toBeGreaterThan(0)
  } finally {
    recoveryKey = null
    await context.close()
  }
})
