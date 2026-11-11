import { test, expect } from '@playwright/test';
import { MODES, SKINS, expectCleanLayout, layout, shot, visit, watch } from './fixtures';

/** Every route renders in every theme and mode without errors or layout breakage. Narrow with ROUTES=/gym,/today SKINS=paper MODES=dark. */
const ALL = ['/today', '/habits', '/tasks', '/rejections', '/gym', '/one', '/journal', '/books', '/entertainment', '/character', '/rewards', '/settings'];
const ROUTES = process.env.ROUTES ? process.env.ROUTES.split(',') : ALL;

for (const route of ROUTES) for (const skin of SKINS) for (const mode of MODES) {
  test(`${route} · ${skin} · ${mode}`, async ({ page }, info) => {
    const w = watch(page);
    await visit(page, route, skin, mode);
    await expect(page.locator('.main, .page, #root > *').first()).toBeVisible();
    const touch = info.project.name !== 'desktop';
    expectCleanLayout(await layout(page, { touch }), `${route} ${skin} ${mode}`);
    if (process.env.SHOTS) await shot(page, info, `${route.replace(/\W+/g, '_')}-${skin}-${mode}`);
    w.stop();
    expect(w.errors, 'console/page errors').toEqual([]);
  });
}
