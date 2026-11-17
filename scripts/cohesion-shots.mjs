// Screenshot every route x skin x mode. Usage: node scripts/cohesion-shots.mjs <phone|desktop> [routes,comma] [outDir]
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
const [proj = 'phone', routesArg, out = '/tmp/cohesion-shots'] = process.argv.slice(2);
const SKINS = (process.env.SKINS ?? 'canopy,paper,grimoire,pop,arcade,sumi,bauhaus,riso,blueprint,swiss,collage,rings,cyberpunk').split(',');
const MODES = (process.env.MODES ?? 'dark,light').split(',');
const ROUTES = (routesArg ?? '/today,/habits,/tasks,/rejections,/gym,/one,/journal,/books,/entertainment,/rewards,/settings').split(',');
const vp = proj === 'phone' ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } };
fs.mkdirSync(`${out}/${proj}`, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext(vp); const page = await ctx.newPage();
for (const r of ROUTES) for (const s of SKINS) for (const m of MODES) {
  await page.goto(`http://localhost:5188${r}?skin=${s}&mode=${m}&demo=1`, { waitUntil: 'load' }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${proj}/${r.replace(/\W+/g, '_')}-${s}-${m}.png` });
}
await b.close();
