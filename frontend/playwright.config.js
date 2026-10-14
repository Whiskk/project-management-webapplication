import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: a real browser against the running app and backend.
 *
 * Local:  ./bin/start-dev.sh, then `npm run e2e`
 * AWS:    E2E_BASE_URL=https://<cloudfront> E2E_ADMIN_PASSWORD=... npm run e2e
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.js',
  // Journeys share one database, so run them one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // One retry: locally, LocalStack starting Lambda containers adds Docker network
  // interfaces, and Chromium aborts in-flight page loads (net::ERR_NETWORK_CHANGED),
  // leaving a blank page. A retry absorbs that; real failures fail both attempts.
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    // 127.0.0.1 rather than localhost: the Vite dev server listens on IPv4 only,
    // and localhost may resolve to IPv6 (::1) first.
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
});
