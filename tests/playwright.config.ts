import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'p1-identity-photo.spec.ts',
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
