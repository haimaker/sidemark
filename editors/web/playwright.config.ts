import {defineConfig, devices} from '@playwright/test'

// Smoke tests run against the production build served by `vite preview`.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4317/',
    trace: 'retain-on-failure'
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
  webServer: {
    command: 'npx vite preview --port 4317 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4317/',
    reuseExistingServer: false,
    timeout: 30_000
  }
})
