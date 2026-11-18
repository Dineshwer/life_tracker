import { defineConfig } from '@playwright/test';

/** Multi-device sync E2E. Run from the project root:  npx playwright test -c tests/e2e-sync/playwright.config.ts
    Starts (1) the mock Supabase on MOCK_PORT (PGlite + the real migrations) and (2) a second Vite dev server on APP_PORT whose
    VITE_SUPABASE_URL points at the mock. Serial on purpose: every test resets the one mock database. */
export const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 54329);
export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 5190);
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: '../../test-results/e2e-sync',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    channel: 'chrome',
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 900 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [{ name: 'sync' }],
  webServer: [
    { command: `PORT=${MOCK_PORT} npx vite-node tests/e2e-sync/mockSupabase.ts`, url: `http://localhost:${MOCK_PORT}/__test/stats`, reuseExistingServer: false, timeout: 90_000, cwd: '../..' },
    { command: `VITE_SUPABASE_URL=http://localhost:${MOCK_PORT} VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npx vite --port ${APP_PORT} --strictPort`, url: `http://localhost:${APP_PORT}`, reuseExistingServer: false, timeout: 90_000, cwd: '../..' },
  ],
});
