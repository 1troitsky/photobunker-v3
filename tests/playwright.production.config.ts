import {defineConfig} from '@playwright/test'
import base from './playwright.config'

// Compiled Nginx acceptance: these journeys use visible controls and native
// browser APIs only. /src and unsigned worker delivery must return 404.
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: [
    '**/production/*.spec.ts',
    '**/p2-browser-public-card-live.spec.ts',
    '**/p2-settings-pin-changes.spec.ts',
    '**/p2-welcome-key-save.spec.ts',
  ],
  use: {...base.use,baseURL:process.env.PB3_BASE_URL??'http://127.0.0.1:5173'},
})
