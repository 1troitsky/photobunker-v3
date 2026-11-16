import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // P1 and Browser P2 are required real-browser gates. Do not silently
  // exclude newly added Browser tests behind the P1-only allowlist.
  // Include BOTH approved Camera Fieldwork 1.2 UX specs in the real PG18/Garage
  // Chromium shard gate. Prior default discovery silently missed them.
  // Settings integration has its own explicit P2 gate; unrelated tracks (e.g. Matrix)
  // still have separate fixtures.
  testMatch: ['p1-*.spec.ts','p2-browser-*.spec.ts','p2-settings-*.spec.ts','p2-messages-*.spec.ts','p2-contacts-*.spec.ts','p2-camera-*.spec.ts','p2-welcome-*.spec.ts','p2-authorization-*.spec.ts'],
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
