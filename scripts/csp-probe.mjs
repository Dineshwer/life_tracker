#!/usr/bin/env node
/* Loads every route of a served build (BASE_URL, e.g. scripts/serve-with-headers.mjs) in Chromium and reports Content-Security-Policy violations.
   Also visits the 3D character page, the Entertainment tabs, a gym demo with a YouTube embed, and checks the service worker registers.
   Usage: BASE_URL=http://localhost:4173 node scripts/csp-probe.mjs      Exit code 1 if any violation is found. */
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:4173';
const routes = ['/today', '/habits', '/tasks', '/rejections', '/gym', '/one', '/journal', '/books', '/entertainment', '/character', '/rewards', '/settings', '/avatar-lab', '/sync-ui-lab'];
const browser = await chromium.launch({ channel: (process.env.PW_CHANNEL ?? 'chrome') || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
const page = await ctx.newPage();
const violations = new Set();
page.on('console', (m) => { const t = m.text(); if (/Refused to|Content Security Policy|violates the following/i.test(t)) violations.add(`${page.url()} :: ${t.slice(0, 260)}`); });
await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`Refused to (event) ${e.violatedDirective} ${e.blockedURI}`)));
const log = (s) => console.log(s);

for (const r of routes) {
  await page.goto(`${base}${r}?demo=1`, { waitUntil: 'load' });
  await page.waitForTimeout(r === '/character' || r === '/avatar-lab' ? 6000 : 1000);
  log(`visited ${r}`);
}
// Entertainment: click through every tab
await page.goto(`${base}/entertainment?demo=1`, { waitUntil: 'load' });
for (const tab of await page.getByRole('tab').all()) { await tab.click().catch(() => {}); await page.waitForTimeout(800); }
// Gym: expand exercises so YouTube embeds mount
await page.goto(`${base}/gym?demo=1`, { waitUntil: 'load' });
for (const b of (await page.getByRole('button', { name: /demo|how|form|video/i }).all()).slice(0, 6)) { await b.click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(400); }
log(`iframes on gym: ${await page.locator('iframe').count()}`);
// frame-src: mount the exact embeds the app uses (the network may be offline: the CSP check happens before the request)
await page.evaluate(() => { for (const u of ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0', 'https://www.youtube.com/embed/dQw4w9WgXcQ']) { const f = document.createElement('iframe'); f.src = u; document.body.appendChild(f); } });
await page.waitForTimeout(1500);
log(`embed iframes mounted: ${await page.locator('iframe').count()}`);
// Service worker
await page.goto(`${base}/today?demo=1`, { waitUntil: 'load' });
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.active?.state ?? 'none'; }).catch((e) => 'error: ' + e.message);
log(`service worker: ${sw}`);
await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1000);
// WebGL
const gl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
log(`webgl2: ${gl}`);
await browser.close();
if (violations.size) { console.error('\nCSP VIOLATIONS:\n' + [...violations].join('\n')); process.exit(1); }
log('\nNo CSP violations.');
