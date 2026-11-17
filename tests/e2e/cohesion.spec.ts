import { test, expect } from '@playwright/test';
import { MODES, SKINS, contrastIssues, visit } from './fixtures';

/** Lasting cross-theme cohesion checks (shared styling layer). Narrow with SKINS= MODES= ROUTES=. */
const ALL = ['/today', '/habits', '/tasks', '/rejections', '/gym', '/one', '/journal', '/books', '/entertainment', '/rewards', '/settings'];
const ROUTES = process.env.ROUTES ? process.env.ROUTES.split(',') : ALL;

test.describe('fonts', () => {
  for (const skin of SKINS) test(`fonts load · ${skin}`, async ({ page }) => {
    await visit(page, '/today', skin, 'dark');
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      const cs = getComputedStyle(document.documentElement);
      const first = (v: string) => v.split(',')[0].trim().replace(/['"]/g, '');
      const fams = { display: first(cs.getPropertyValue('--font-display')), ui: first(cs.getPropertyValue('--font-ui')) };
      await document.fonts.ready;
      const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/['"]/g, ''));
      return { fams, loaded };
    });
    for (const [k, f] of Object.entries(r.fams)) expect(r.loaded, `${skin} ${k} font "${f}" not loaded`).toContain(f);
  });
});

/** Browser-default looking controls (grey buttons, default input borders, native number spinners). */
async function unstyled(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const nm = (el: Element) => el.tagName.toLowerCase() + (typeof (el as HTMLElement).className === 'string' ? '.' + (el as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    for (const el of document.querySelectorAll('button, input, select, textarea')) {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      if (!r.width || cs.display === 'none') continue;
      const t = (el as HTMLInputElement).type;
      if (el.tagName === 'BUTTON' && cs.backgroundColor === 'rgb(239, 239, 239)') out.push('grey button ' + nm(el));
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !['checkbox', 'radio', 'range', 'hidden', 'file', 'color'].includes(t)) {
        if (cs.borderTopColor === 'rgb(118, 118, 118)' && cs.borderTopWidth !== '0px') out.push('default border ' + nm(el));
        if (el.tagName === 'SELECT' && cs.appearance === 'auto' && cs.backgroundImage === 'none') out.push('native select ' + nm(el));
        if (t === 'number' && cs.getPropertyValue('-moz-appearance') === '' && (el as HTMLElement).dataset.spin !== 'ok') {
          const sp = getComputedStyle(el, '::-webkit-inner-spin-button'); if (sp.appearance === 'auto' || sp.appearance === 'inner-spin-button') out.push('number spinner ' + nm(el));
        }
      }
    }
    return out;
  });
}

for (const route of ROUTES) for (const skin of SKINS) for (const mode of MODES) {
  test(`no unstyled controls · ${route} · ${skin} · ${mode}`, async ({ page }) => {
    await visit(page, route, skin, mode);
    expect(await unstyled(page)).toEqual([]);
  });
}

test.describe('contrast of shared components', () => {
  for (const skin of SKINS) for (const mode of MODES) test(`shared contrast · ${skin} · ${mode}`, async ({ page }, info) => {
    await visit(page, '/habits', skin, mode);
    const phone = info.project.name !== 'desktop';
    const first = await contrastIssues(page, phone ? '.tabbar' : '.rail');
    const add = page.getByRole('button', { name: /add/i }).first();
    await add.click(); await page.waitForTimeout(400);
    const sheet = await contrastIssues(page, '.sheet');
    expect([...first, ...sheet]).toEqual([]);
  });
});

test('skins differ in computed card style', async ({ page }) => {
  const seen = new Map<string, string>();
  for (const skin of SKINS) {
    await visit(page, '/habits', skin, 'light');
    const sig = await page.evaluate(() => {
      const c = getComputedStyle(document.documentElement);
      return ['--card', '--card-bw', '--r-card', '--shadow', '--font-display', '--accent'].map((k) => c.getPropertyValue(k).trim()).join('|');
    });
    expect(seen.get(sig), `${skin} has the same card tokens as ${seen.get(sig)}`).toBeUndefined();
    seen.set(sig, skin);
  }
});
