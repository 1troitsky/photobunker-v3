import {defineConfig} from '@playwright/test'
export default defineConfig({testDir:'.',testMatch:'*.spec.ts',workers:1,retries:0,timeout:360000,expect:{timeout:15000},use:{
  baseURL:'http://127.0.0.1:5173',browserName:'chromium',trace:'off',screenshot:'off',video:'off',
}})
