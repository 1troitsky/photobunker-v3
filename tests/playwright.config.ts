import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Every versioned P1 vertical is a mandatory real-browser gate.
  // Explicit older-file allowlist accidentally skipped MediaFile E2E
  // in PR28–30 while the two original suites remained green.
  testMatch: ['p1-*.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    headless: true,
    permissions: ['camera'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],
    },
    trace: 'retain-on-failure',
  },
})
