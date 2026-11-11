import { defineConfig } from '@playwright/test';

/** E2E tests run against a local dev server with NO Supabase (so `?demo=1` loads sample data) and use the installed Google Chrome,
    so no browser download is needed. Filter with env vars: SKINS=canopy,paper MODES=dark ROUTES=/gym,/today
    Run:  npx playwright test tests/e2e/<file>.spec.ts --project=phone      (projects: desktop, phone, phone-small) */
const PORT = 5188;
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/artifacts',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: Number(process.env.PW_WORKERS ?? 2),
  retries: 0,
  reporter: [['list']],
  use: { baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`, channel: 'chrome', trace: 'off', screenshot: 'off', video: 'off', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    { name: 'phone-small', use: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ],
  webServer: process.env.BASE_URL ? undefined : { command: `VITE_SUPABASE_URL= VITE_SUPABASE_PUBLISHABLE_KEY= npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 60_000 },
});
