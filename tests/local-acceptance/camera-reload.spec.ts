import { test, expect } from '@playwright/test'
import { register, confirmedSession } from './helpers'

test('PR14 regression: late camera permission must recover after session hydration', async ({page}, info) => {
  await register(page)
  // Model a real permission response arriving after online login hydration.
  // Both network proof and getUserMedia are genuine; only their order is held.
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints)
      await new Promise<void>(resolve => { (window as any).__releaseQaCamera = resolve })
      return stream
    }
  })
  let releaseProof!: () => void
  const gate = new Promise<void>(resolve => { releaseProof = resolve })
  await page.route('**/identity/v2/proof', async route => { await gate; await route.continue() })
  await page.goto('/camera')
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseQaCamera)).toBe('function')
  releaseProof()
  await confirmedSession(page)
  await page.evaluate(() => (window as any).__releaseQaCamera())
  let started = false
  try {
    await expect.poll(() => page.locator('video').evaluate(el => (el as HTMLVideoElement).videoWidth),
                      {timeout: 3000}).toBeGreaterThan(0)
    started = true
  } finally {
    await info.attach('camera-hydration-observation', {contentType: 'application/json', body: JSON.stringify({
      status: started ? 'PASS' : 'FAIL', latePermissionAfterOnlineHydration: true,
      automaticallyStarted: started, cameraStartButtonEnabled: await page.getByRole('button', {name: 'Включить камеру'}).isEnabled(),
    })})
  }
})
