import { test, expect, type Page } from '@playwright/test';
import { MODES, SKINS, contrastIssues, expectCleanLayout, layout, shot, visit, watch } from './fixtures';

/** Theme matrix for Gym (every tab) and The one: 13 skins x 2 modes. Narrow with SKINS=, MODES=. */
const GYM_TABS = ['Log', 'Plan', 'Mobility', 'Skills', 'Progress', 'Body'] as const;
const CASES: { name: string; route: string; tab?: string }[] = [
  ...GYM_TABS.map((t) => ({ name: `/gym ${t}`, route: '/gym', tab: t })),
  { name: '/one', route: '/one' },
];

async function openTab(page: Page, tab?: string) {
  if (!tab) return;
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await page.waitForTimeout(800); // tab body fade-in
}

for (const c of CASES) for (const skin of SKINS) for (const mode of MODES) {
  test(`${c.name} · ${skin} · ${mode}`, async ({ page }, info) => {
    const w = watch(page);
    await visit(page, c.route, skin, mode);
    await openTab(page, c.tab);
    // Log tab: expand a bit more so the open row and its GIF are part of the check
    await expect(page.locator('.main')).toBeVisible();
    expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), `${c.name} ${skin} ${mode}`);
    const issues = await contrastIssues(page, '.main');
    expect(issues, 'contrast').toEqual([]);
    if (process.env.SHOTS) await shot(page, info, `${c.name.replace(/\W+/g, '_')}-${skin}-${mode}`, true);
    w.stop();
    // compute-pressure: Chrome noise from an embedded tutorial iframe, not an app error
    expect(w.errors.filter((e) => !/compute-pressure/.test(e)), 'console/page errors').toEqual([]);
  });
}
