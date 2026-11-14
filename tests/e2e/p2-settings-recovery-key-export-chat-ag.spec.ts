import { test, expect } from '@playwright/test'
import { text as streamText } from 'node:stream/consumers'

test('P2 #400: Recovery Key download requires deliberate click and preserves registration', async ({ browser }) => {
  test.setTimeout(120000)
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  try {
    // Test the genuine browser download fallback (Safari/Firefox compatibility).
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true, value: undefined,
      })
    })
    let downloads = 0
    page.on('download', () => { downloads++ })
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Создать ключ' }).click()
    await expect(page.getByTestId('recovery-key-save')).toBeVisible()
    const key = await page.locator('#generated-key').inputValue()
    expect(key.startsWith('PB2.')).toBe(true)
    expect(downloads).toBe(0) // No key file is written just by rendering the key.
    await expect(page.getByTestId('recovery-key-save-warning')).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('recovery-key-save').click(),
    ])
    expect(download.suggestedFilename()).toBe('recovery-key.txt')
    const stream = await download.createReadStream()
    if (!stream) throw new Error('Recovery Key export stream absent')
    // Never print or attach plaintext Key to a test failure log.
    expect((await streamText(stream)) === (key + '\n')).toBe(true)
    await expect(page.getByRole('status')).toContainText('Загрузка файла запрошена')
    await expect(page.locator('#generated-key')).toBeVisible()

    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button', { name: 'Завершить регистрацию' }).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await expect(page.locator('#generated-key')).toHaveCount(0)
    await expect(page.getByTestId('recovery-key-save')).toHaveCount(0)
    expect(downloads).toBe(1)
  } finally { await context.close() }
})

test('P2 #400: native picker writes only after user action without network or local storage', async ({ browser }) => {
  test.setTimeout(90000)
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.addInitScript(() => {
      // Simulate only the OS file picker; the UI/crypto/key generation stays real.
      const state: { value?: string; closed?: boolean; opens: number } = { opens: 0 }
      Object.defineProperty(window, '__pb3KeySaveTest', { value: state })
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async () => {
          state.opens++
          return {
            createWritable: async () => ({
              write: async (blob: Blob) => { state.value = await blob.text() },
              close: async () => { state.closed = true },
              abort: async () => { state.value = undefined },
            }),
          }
        },
      })
    })
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Создать ключ' }).click()
    const key = await page.locator('#generated-key').inputValue()
    const initial = await page.evaluate(() => (window as unknown as {
      __pb3KeySaveTest: { opens: number; closed?: boolean }
    }).__pb3KeySaveTest)
    expect(initial.opens).toBe(0)
    await page.getByTestId('recovery-key-save').click()
    await expect(page.getByRole('status')).toContainText('Ключ сохранён')
    const matched = await page.evaluate((expected) => {
      const v = (window as unknown as {
        __pb3KeySaveTest: { value?: string; closed?: boolean; opens: number }
      }).__pb3KeySaveTest
      return v.opens === 1 && v.closed === true && v.value === expected + '\n'
    }, key)
    expect(matched).toBe(true)
  } finally { await context.close() }
})
