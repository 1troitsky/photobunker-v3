import {defineConfig} from '@playwright/test'
export default defineConfig({testDir:'./media-reference',testMatch:'*.spec.ts',workers:1,retries:0,timeout:240000,expect:{timeout:15000},use:{
  baseURL:'http://127.0.0.1:5173',browserName:'chromium',permissions:['camera','microphone'],
  launchOptions:{args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']},trace:'off',screenshot:'off',video:'off',
}})
