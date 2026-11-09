import { test, expect } from '@playwright/test'

test('production preview: five warm navigations, laboratory timing only', async ({ page }, info) => {
  // Same browser, viewport, URL and bundle before/after; no invented threshold.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('http://127.0.0.1:4173/settings')
  const samples = []
  for (let i = 0; i < 5; i++) {
    await page.goto('http://127.0.0.1:4173/settings')
    await expect(page.getByRole('heading', { name: 'Настройки / Доступ' })).toBeVisible()
    samples.push(await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
      return { responseEnd: nav.responseEnd, domContentLoaded: nav.domContentLoadedEventEnd,
        load: nav.loadEventEnd, transferSize: nav.transferSize,
        fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null }
    }))
  }
  await info.attach('production-navigation-timings', {
    body: JSON.stringify({ viewport: { width: 390, height: 844 }, samples }, null, 2),
    contentType: 'application/json',
  })
})
