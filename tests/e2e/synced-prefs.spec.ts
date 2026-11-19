import { test, expect } from '@playwright/test';
import { visit } from './fixtures';

/** Everything the user does must live in the synced store (the `kv` collection), not only in this browser. */
const kv = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('life-tracker-v1') || '{}');
  return Object.fromEntries(((raw.state?.kv ?? []) as { id: string; value: string }[]).map((x) => [x.id, x.value]));
});

test('legacy browser-only data is migrated into the synced store at startup', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('ledger-gym-start', '2026-10-01');
    localStorage.setItem('ledger-gym-skills', JSON.stringify({ handstand: 3 }));
    localStorage.setItem('ledger-cardio', JSON.stringify([{ id: 'c1', date: '2026-11-01', minutes: 20 }]));
    localStorage.setItem('ledger-mobility-2026-11-01', JSON.stringify(['primer:0']));
    localStorage.setItem('ledger-ht-topics', JSON.stringify(['security-hacking']));
    localStorage.setItem('ledger-mirror-ids', '{}'); // a cache: must NOT be migrated
  });
  await visit(page, '/today', 'canopy', 'dark');
  await page.waitForTimeout(500);
  const k = await kv(page);
  expect(k['ledger-gym-start']).toBe('2026-10-01');
  expect(JSON.parse(k['ledger-gym-skills'])).toEqual({ handstand: 3 });
  expect(JSON.parse(k['ledger-cardio'])).toHaveLength(1);
  expect(JSON.parse(k['ledger-mobility-2026-11-01'])).toEqual(['primer:0']);
  expect(JSON.parse(k['ledger-ht-topics'])).toEqual(['security-hacking']);
  expect(k['ledger-mirror-ids']).toBeUndefined();
  // caches stay in the browser untouched; migrated originals are removed once safely in the store
  const ls = await page.evaluate(() => ({ cache: localStorage.getItem('ledger-mirror-ids'), old: localStorage.getItem('ledger-gym-start') }));
  expect(ls.cache).toBe('{}');
  expect(ls.old).toBeNull();
});

test('ticking a mobility drill and picking feed topics write to the synced store', async ({ page }) => {
  await visit(page, '/gym', 'canopy', 'dark');
  await page.getByRole('tab', { name: /mobility/i }).first().click().catch(async () => { await page.getByText(/^Mobility$/).first().click(); });
  const check = page.locator('.mob-check').first();
  await check.waitFor();
  await check.click();
  await page.waitForTimeout(300);
  const k = await kv(page);
  const mob = Object.keys(k).filter((x) => x.startsWith('ledger-mobility-'));
  expect(mob.length).toBeGreaterThan(0);
  expect(JSON.parse(k[mob[0]]).length).toBeGreaterThan(0);

  await visit(page, '/entertainment', 'canopy', 'dark');
  await page.getByRole('tab', { name: 'HackerTube', exact: true }).click();
  await page.getByRole('button', { name: /pick topics/i }).click();
  await page.locator('.en-cat').first().click();
  await page.waitForTimeout(300);
  expect(JSON.parse((await kv(page))['ledger-ht-topics']).length).toBeGreaterThan(0);
});

test('synced values survive a reload', async ({ page }) => {
  await visit(page, '/habits', 'paper', 'light');
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('life-tracker-v1')!); s.state.kv = [{ id: 'ledger-gym-start', value: '2026-09-09' }]; localStorage.setItem('life-tracker-v1', JSON.stringify(s)); });
  await page.reload();
  await page.waitForTimeout(500);
  expect((await kv(page))['ledger-gym-start']).toBe('2026-09-09');
});
