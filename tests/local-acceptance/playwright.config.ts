import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    permissions: ['camera'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    // Registration screens contain synthetic Recovery Keys; never trace them.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
})
