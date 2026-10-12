import { defineConfig, devices } from '@playwright/test'

// WebKit only: Leading runs inside the system WebKit, so Chrome results would mislead.
export default defineConfig({
  testDir: 'test/browser',
  timeout: 120_000,
  use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:5174' },
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }],
  webServer: { command: 'npx vite --port 5174 --strictPort', port: 5174, reuseExistingServer: true },
})
