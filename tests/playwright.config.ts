import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  timeout: 120000,
  expect: { timeout: 10000 },
  use: {
    baseURL: process.env.BASE_URL || 'https://564b6ab6-6c10-41e3-9c31-1c7b0614b72b-00-1sx2x4owrojd1.kirk.replit.dev',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: [['list']]
});