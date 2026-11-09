import { test, expect } from '@playwright/test'

for (const [mode, origin] of [['vite-development', 'http://127.0.0.1:5173'],
                              ['production-preview', 'http://127.0.0.1:4173']] as const) {
  test(`${mode}: observe cold offline readiness without registering a worker`, async ({ browser }, info) => {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      await page.goto(origin + '/settings')
      await expect(page.getByRole('heading', {name: 'Настройки / Доступ'})).toBeVisible()
      const before = await page.evaluate(async () => ({
        secureContext: isSecureContext,
        controller: navigator.serviceWorker.controller !== null,
        registrations: (await navigator.serviceWorker.getRegistrations()).length,
        cacheNames: await caches.keys(),
        standalone: matchMedia('(display-mode: standalone)').matches,
        scripts: [...document.scripts].map(script => new URL(script.src || location.href).pathname),
      }))
      const failed: string[] = []
      page.on('requestfailed', request => {
        if (request.isNavigationRequest()) failed.push(request.failure()?.errorText ?? 'unknown')
      })
      await context.setOffline(true)
      let reloadError = false
      try { await page.reload({timeout: 10_000}) } catch { reloadError = true }
      const rendered = await page.getByRole('heading', {name: 'Настройки / Доступ'}).isVisible().catch(() => false)
      // This is an observation probe. A completed probe is not a PASS for
      // offline acceptance: the per-scenario status below remains explicit.
      await info.attach('offline-bootstrap-observation', {contentType: 'application/json', body: JSON.stringify({
        mode, before, reloadError, failedNavigations: failed, renderedOffline: rendered,
        status: rendered ? 'PASS' : 'BLOCKED BY DESIGN',
        reason: rendered ? 'Offline shell rendered' : 'No controlling trusted worker or verified shell bootstrap',
      })})
      expect(before.registrations).toBe(0)
      expect(before.controller).toBe(false)
      await context.setOffline(false)
      await page.goto(origin + '/settings')
      await expect(page.getByRole('heading', {name: 'Настройки / Доступ'})).toBeVisible()
    } finally { await context.close() }
  })
}
