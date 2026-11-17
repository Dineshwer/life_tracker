import { test, expect, type Page } from '@playwright/test';
import { MODES, SKINS, contrastIssues, expectCleanLayout, layout, shot, visit, watch } from './fixtures';
import { rejectionProgress } from '../../src/lib/rejections';

/** Rejections, Journal and Books: theme matrix + real user flows. */

const KEY = 'life-tracker-v1';
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const TODAY = () => daysAgo(0);

// ---------- helpers ----------
/** Seed the persisted store before the first load (only when nothing is stored, so reloads keep user changes). */
async function seed(page: Page, state: Record<string, unknown>) {
  await page.addInitScript(([k, s]) => { if (!localStorage.getItem(k as string)) localStorage.setItem(k as string, JSON.stringify({ state: s, version: 2 })); }, [KEY, state] as const);
}
async function open(page: Page, route: string, skin = 'canopy', mode = 'dark') {
  await page.goto(`${route}?skin=${skin}&mode=${mode}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  await expect(page.locator('.page-title')).toBeVisible();
}
const store = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').state ?? {}, KEY);
const rejRows = (n: number, dayOffset = 0) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, date: daysAgo(dayOffset), createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), what: `Ask number ${i + 1}` }));
const xpFor = (rejections: { id: string }[]) => rejections.map((r) => ({ id: `x${r.id}`, date: TODAY(), stat: 'discipline', amount: 10, reason: 'Rejection', ref: `rej:${r.id}` }));
/** Navigate inside the SPA without a page load (what tapping the tab bar does). */
const spaGo = (page: Page, to: string) => page.evaluate((p) => { history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, to);
/** Accept every window.confirm. */
const autoConfirm = (page: Page) => page.on('dialog', (d) => d.accept());

// ---------- pure progress maths ----------
test.describe('rejection progress maths', () => {
  const cases: [number, Partial<ReturnType<typeof rejectionProgress>>][] = [
    [0, { blocks: 0, inBlock: 0, cells: 0, inRun: 0, done: false }],
    [1, { blocks: 0, inBlock: 1, cells: 0, inRun: 1 }],
    [9, { blocks: 0, inBlock: 9, cells: 0, inRun: 9 }],
    [10, { blocks: 0, inBlock: 10, cells: 1, inRun: 0 }],
    [99, { blocks: 0, inBlock: 99, cells: 9, inRun: 9 }],
    [100, { blocks: 1, inBlock: 0, cells: 0, inRun: 0 }],
    [101, { blocks: 1, inBlock: 1, cells: 0, inRun: 1 }],
    [999, { blocks: 9, inBlock: 99, cells: 9, inRun: 9, done: false }],
    [1000, { blocks: 10, inBlock: 100, inRun: 10, done: true, pct: 1 }],
    [1500, { blocks: 10, inBlock: 100, inRun: 10, done: true, pct: 1 }],
  ];
  for (const [total, want] of cases) test(`total ${total}`, () => { expect(rejectionProgress(total)).toMatchObject(want); });
});

// ---------- theme matrix ----------
const ROUTES = (process.env.ROUTES ? process.env.ROUTES.split(',') : ['/rejections', '/journal', '/books']);
for (const route of ROUTES) for (const skin of SKINS) for (const mode of MODES) {
  test(`matrix ${route} · ${skin} · ${mode}`, async ({ page }, info) => {
    const w = watch(page);
    await visit(page, route, skin, mode);
    await expect(page.locator('.page-title')).toBeVisible();
    // let entrance animations finish so axe samples final colours
    await page.waitForTimeout(900);
    expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), `${route} ${skin} ${mode}`);
    expect(await contrastIssues(page, '.page'), `contrast ${route} ${skin} ${mode}`).toEqual([]);
    if (process.env.SHOTS) await shot(page, info, `${route.replace(/\W+/g, '_')}-${skin}-${mode}`, true);
    w.stop();
    expect(w.errors, 'console/page errors').toEqual([]);
  });
}

// ---------- REJECTIONS flows ----------
test.describe('rejections flows', () => {
  test('empty account: empty state, disabled submit, no NaN', async ({ page }) => {
    const w = watch(page);
    await open(page, '/rejections');
    await expect(page.locator('.rj-big')).toHaveText('0');
    await expect(page.locator('.rj-empty')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log rejection' })).toBeDisabled();
    const text = await page.locator('.page').innerText();
    expect(text).not.toMatch(/NaN|Infinity|undefined/);
    await expect(page.locator('.rj-stat-eta')).toHaveText('Log 5 to see');
    expect(w.errors).toEqual([]);
  });

  test('whitespace-only what is rejected (Ctrl+Enter, Enter in input) and nothing is stored', async ({ page }) => {
    await open(page, '/rejections');
    const what = page.getByLabel('What did you do to get it?');
    await what.fill('   \n  ');
    await what.press('Control+Enter');
    await page.getByLabel('Who or where (optional)').fill('someone');
    await page.getByLabel('Who or where (optional)').press('Enter');
    expect((await store(page)).rejections ?? []).toEqual([]);
    await expect(page.locator('.rj-big')).toHaveText('0');
  });

  test('log with Ctrl+Enter: +10 XP, numbering, trimmed fields, survives reload, form cleared and refocused', async ({ page }) => {
    await open(page, '/rejections');
    const what = page.getByLabel('What did you do to get it?');
    await what.fill('  Asked for a discount  ');
    await page.getByLabel('Who or where (optional)').fill(' Cafe ');
    await what.press('Control+Enter');
    await expect(page.locator('.rj-big')).toHaveText('1');
    await expect(page.locator('.rj-flash')).toContainText('#1 logged');
    await expect(what).toBeFocused();
    await expect(what).toHaveValue('');
    await expect(page.getByLabel('Who or where (optional)')).toHaveValue('');
    let s = await store(page);
    expect(s.rejections).toHaveLength(1);
    expect(s.rejections[0]).toMatchObject({ what: 'Asked for a discount', who: 'Cafe', date: TODAY() });
    expect(s.xp.filter((e: { amount: number }) => e.amount === 10)).toHaveLength(1);
    await page.reload();
    await expect(page.locator('.rj-big')).toHaveText('1');
    await expect(page.locator('.rj-what')).toHaveText('Asked for a discount');
    s = await store(page);
    expect(s.rejections).toHaveLength(1);
  });

  test('rapid double submit cannot log the same text twice', async ({ page }) => {
    await open(page, '/rejections');
    await page.getByLabel('What did you do to get it?').fill('Once only');
    const btn = page.getByRole('button', { name: 'Log rejection' });
    await btn.dblclick();
    expect((await store(page)).rejections).toHaveLength(1);
  });

  test('stats with 1..4 entries today: pace, no ETA until 5, ETA at 5', async ({ page }) => {
    const rows = rejRows(4);
    await seed(page, { rejections: rows, xp: xpFor(rows) });
    await open(page, '/rejections');
    await expect(page.locator('.rj-stat').nth(0)).toContainText('4');
    await expect(page.locator('.rj-stat').nth(2)).toContainText('4.0');
    await expect(page.locator('.rj-stat-eta')).toHaveText('Log 5 to see');
    await page.getByLabel('What did you do to get it?').fill('fifth');
    await page.getByRole('button', { name: 'Log rejection' }).click();
    await expect(page.locator('.rj-stat-eta')).not.toHaveText('Log 5 to see');
    await expect(page.locator('.rj-stat-eta')).toHaveText(/\d/);
  });

  test('week and today counts only count their own days', async ({ page }) => {
    const a = rejRows(2, 0).map((r, i) => ({ ...r, id: `a${i}` }));
    const b = rejRows(3, 3).map((r, i) => ({ ...r, id: `b${i}`, createdAt: new Date(Date.UTC(2025, 5, 1, 0, 0, i)).toISOString() }));
    const c = rejRows(4, 7).map((r, i) => ({ ...r, id: `c${i}`, createdAt: new Date(Date.UTC(2025, 4, 1, 0, 0, i)).toISOString() }));
    await seed(page, { rejections: [...a, ...b, ...c], xp: [] });
    await open(page, '/rejections');
    await expect(page.locator('.rj-stat').nth(0).locator('.rj-stat-v')).toHaveText('2');
    await expect(page.locator('.rj-stat').nth(1).locator('.rj-stat-v')).toHaveText('5'); // today + 3 days ago, not 7 days ago
  });

  const meterCases: [number, string, string, string, string][] = [
    [0, '0 / 10 blocks', '0 / 100', '0 / 10', 'Block 1 of 10'],
    [99, '0 / 10 blocks', '99 / 100', '9 / 10', 'Block 1 of 10'],
    [100, '1 / 10 blocks', '0 / 100', '0 / 10', 'Block 2 of 10'],
    [101, '1 / 10 blocks', '1 / 100', '1 / 10', 'Block 2 of 10'],
    [999, '9 / 10 blocks', '99 / 100', '9 / 10', 'Block 10 of 10'],
    [1000, '10 / 10 blocks', '100 / 100', '10 / 10', 'All blocks complete'],
    [1003, '10 / 10 blocks', '100 / 100', '10 / 10', 'All blocks complete'],
  ];
  for (const [n, blocks, inBlock, run, label] of meterCases) {
    test(`meter at ${n} entries`, async ({ page }) => {
      await seed(page, { rejections: rejRows(n), xp: [] });
      await open(page, '/rejections');
      const counts = page.locator('.rm-count');
      await expect(counts.nth(0)).toHaveText(blocks);
      await expect(counts.nth(1)).toHaveText(inBlock);
      await expect(counts.nth(2)).toHaveText(run);
      await expect(page.locator('.rm-head .label').nth(1)).toHaveText(label);
      await expect(page.locator('.rj-big')).toHaveText(n.toLocaleString());
      await expect(page.locator('.rm-dot.on')).toHaveCount(Math.min(rejectionProgress(n).inRun, 10));
      if (n >= 1000) await expect(page.locator('.rj-of')).toContainText('complete');
      else await expect(page.locator('.rj-of')).toContainText(`${(1000 - n).toLocaleString()} to go`);
    });
  }

  for (const [before, bonusAndXp] of [[9, 40], [99, 160], [999, 1010]] as const) {
    test(`entry #${before + 1} gives ${bonusAndXp} XP and removing it reverts exactly those events`, async ({ page }) => {
      autoConfirm(page);
      const rows = rejRows(before);
      await seed(page, { rejections: rows, xp: xpFor(rows) });
      await open(page, '/rejections');
      const xpBefore = (await store(page)).xp;
      await page.getByLabel('What did you do to get it?').fill('the milestone one');
      await page.getByRole('button', { name: 'Log rejection' }).click();
      await expect(page.locator('.rj-flash')).toContainText(`+${bonusAndXp} XP`);
      let s = await store(page);
      expect(s.xp.length - xpBefore.length).toBe(2); // entry xp + milestone bonus
      const added = s.xp.slice(xpBefore.length).reduce((a: number, e: { amount: number }) => a + e.amount, 0);
      expect(added).toBe(bonusAndXp);
      // remove it again (it is the newest, first row of the open block)
      await page.getByRole('button', { name: `Remove rejection ${before + 1}` }).click();
      await expect(page.locator('.rj-big')).toHaveText(String(before));
      s = await store(page);
      expect(s.xp).toEqual(xpBefore);
      expect(s.rejections).toHaveLength(before);
    });
  }

  test('removing an old entry while a later milestone exists keeps xp consistent; cancel keeps entry', async ({ page }) => {
    const rows = rejRows(10);
    const xp = [...xpFor(rows), { id: 'm10', date: TODAY(), stat: 'discipline', amount: 30, reason: 'Run of 10', ref: 'rejmile:10' }];
    await seed(page, { rejections: rows, xp });
    await open(page, '/rejections');
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: 'Remove rejection 3' }).click();
    await expect(page.locator('.rj-big')).toHaveText('10');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Remove rejection 3' }).click();
    await expect(page.locator('.rj-big')).toHaveText('9');
    const s = await store(page);
    expect(s.xp.some((e: { ref?: string }) => e.ref === 'rejmile:10')).toBe(false); // 10th milestone no longer earned
    expect(s.xp.some((e: { ref?: string }) => e.ref === 'rej:r2')).toBe(false);
    expect(s.xp.filter((e: { ref?: string }) => e.ref?.startsWith('rej:'))).toHaveLength(9);
    // numbering closes up: no #10 left, entries 1..9
    await expect(page.locator('.rj-n').first()).toHaveText('#9');
    await expect(page.locator('.rj-item')).toHaveCount(9);
  });

  test('grouped log: 137 rows, only current block open, other block toggles', async ({ page }) => {
    await seed(page, { rejections: rejRows(137), xp: [] });
    await open(page, '/rejections');
    await expect(page.locator('.rj-block')).toHaveCount(2);
    await expect(page.locator('.rj-item')).toHaveCount(37);
    await expect(page.locator('.rj-block-head').first()).toContainText('Block 2');
    await expect(page.locator('.rj-block-head').nth(1)).toContainText('Complete');
    await page.locator('.rj-block-head').nth(1).click();
    await expect(page.locator('.rj-item')).toHaveCount(137);
    await expect(page.locator('.rj-block-head').nth(1)).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.rj-block-head').nth(1).click();
    await expect(page.locator('.rj-item')).toHaveCount(37);
  });

  test('very long text without spaces does not overflow', async ({ page }, info) => {
    const long = 'x'.repeat(400);
    const rows = [{ ...rejRows(1)[0], what: long, who: 'w'.repeat(200), note: 'n'.repeat(200) }];
    await seed(page, { rejections: rows, xp: [] });
    await open(page, '/rejections');
    expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), 'long rejection');
  });

  test('1,000 entries render quickly', async ({ page }) => {
    await seed(page, { rejections: rejRows(1000), xp: [] });
    const t0 = Date.now();
    await open(page, '/rejections');
    await expect(page.locator('.rj-block')).toHaveCount(10);
    expect(Date.now() - t0).toBeLessThan(8000);
  });

  test('1000th entry gives the +1000 bonus and 1001 shows overflow gracefully', async ({ page }) => {
    await seed(page, { rejections: rejRows(1000), xp: [] });
    await open(page, '/rejections');
    await page.getByLabel('What did you do to get it?').fill('beyond');
    await page.getByRole('button', { name: 'Log rejection' }).click();
    await expect(page.locator('.rj-big')).toHaveText('1,001');
    await expect(page.locator('.rm-count').first()).toHaveText('10 / 10 blocks');
    expect(await page.locator('.page').innerText()).not.toMatch(/NaN|Infinity|-\d+ to go/);
  });
});

// ---------- JOURNAL flows ----------
test.describe('journal flows', () => {
  test('daily autosave (debounced), saved indicator, survives reload', async ({ page }) => {
    await open(page, '/journal');
    const area = page.getByLabel('Journal entry');
    await area.fill('Today was calm.');
    await expect(page.locator('.saved').first()).toHaveText('Saved', { timeout: 4000 });
    await page.reload();
    await expect(page.getByLabel('Journal entry')).toHaveValue('Today was calm.');
    const s = await store(page);
    expect(s.journal.filter((e: { kind: string }) => e.kind === 'daily')).toHaveLength(1);
  });

  test('typing then navigating inside the app immediately does not lose text (flush on unmount)', async ({ page }) => {
    await open(page, '/journal');
    await page.getByLabel('Journal entry').fill('quick note before leaving');
    await spaGo(page, '/books');
    await expect(page.locator('.page-title')).toHaveText('Books');
    const s = await store(page);
    expect(s.journal[0]).toMatchObject({ body: 'quick note before leaving', kind: 'daily', date: TODAY() });
  });

  test('typing then reloading / closing the tab immediately does not lose text', async ({ page }) => {
    await open(page, '/journal');
    await page.getByLabel('Journal entry').fill('typed right before reload');
    await page.reload();
    await expect(page.getByLabel('Journal entry')).toHaveValue('typed right before reload');
  });

  test('switching Daily/Weekly keeps both entries and does not lose unsaved text', async ({ page }) => {
    await open(page, '/journal');
    await page.getByLabel('Journal entry').fill('daily text');
    await page.getByRole('tab', { name: 'Weekly review' }).click();
    await page.getByLabel('Wins').fill('a win');
    await page.getByRole('tab', { name: 'Daily' }).click();
    await expect(page.getByLabel('Journal entry')).toHaveValue('daily text');
    await page.getByRole('tab', { name: 'Weekly review' }).click();
    await expect(page.getByLabel('Wins')).toHaveValue('a win');
    const s = await store(page);
    expect(s.journal).toHaveLength(2);
  });

  test('mood and energy dots: set, change, persist, create entry without body', async ({ page }) => {
    await open(page, '/journal');
    await page.getByRole('button', { name: 'Mood 4' }).click();
    await page.getByRole('button', { name: 'Energy 2' }).click();
    await page.getByRole('button', { name: 'Mood 2' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Mood 2' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Energy 2' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.dots').first().locator('button.on')).toHaveCount(2);
    const s = await store(page);
    expect(s.journal).toHaveLength(1);
    expect(s.journal[0]).toMatchObject({ mood: 2, energy: 2 });
    // typing afterwards keeps mood
    await page.getByLabel('Journal entry').fill('after mood');
    await page.getByLabel('Journal entry').blur();
    const s2 = await store(page);
    expect(s2.journal).toHaveLength(1);
    expect(s2.journal[0]).toMatchObject({ mood: 2, body: 'after mood' });
  });

  test('mood dots are tappable by keyboard', async ({ page }) => {
    await open(page, '/journal');
    await page.getByRole('button', { name: 'Mood 3' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Mood 3' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('weekly review round-trips four sections and keeps multi-line text', async ({ page }) => {
    await open(page, '/journal');
    await page.getByRole('tab', { name: 'Weekly review' }).click();
    await page.getByLabel('Wins').fill('w1\nw2');
    await page.getByLabel('Lessons').fill('l1');
    await page.getByLabel("Next week's focus").fill('focus');
    await page.getByLabel("Next week's focus").blur();
    await page.reload();
    await page.getByRole('tab', { name: 'Weekly review' }).click();
    await expect(page.getByLabel('Wins')).toHaveValue('w1\nw2');
    await expect(page.getByLabel('Failures')).toHaveValue('');
    await expect(page.getByLabel('Lessons')).toHaveValue('l1');
    await expect(page.getByLabel("Next week's focus")).toHaveValue('focus');
  });

  test('archive: empty state, search, expand, empty weekly review is not listed', async ({ page }) => {
    await open(page, '/journal');
    await expect(page.locator('.j-empty')).toContainText('gather');
    // an untouched weekly review (blank sections) must not appear
    await page.getByRole('tab', { name: 'Weekly review' }).click();
    await page.getByLabel('Wins').fill('x');
    await page.getByLabel('Wins').fill('');
    await page.getByLabel('Wins').blur();
    await page.getByRole('tab', { name: 'Daily' }).click();
    await expect(page.locator('.arch')).toHaveCount(0);
    await page.getByLabel('Journal entry').fill('Found my keys and a good idea');
    await page.getByLabel('Journal entry').blur();
    await expect(page.locator('.arch')).toHaveCount(1);
    await page.getByLabel('Search entries').fill('zzz');
    await expect(page.locator('.j-empty')).toHaveText('No entries match.');
    await page.getByLabel('Search entries').fill('GOOD IDEA');
    await expect(page.locator('.arch')).toHaveCount(1);
    await page.locator('.arch button').click();
    await expect(page.locator('.arch-full')).toContainText('Found my keys');
  });

  test('long text with 20k chars stays inside the card', async ({ page }, info) => {
    await open(page, '/journal');
    const long = ('word '.repeat(50) + 'y'.repeat(300) + '\n').repeat(60);
    await page.getByLabel('Journal entry').fill(long);
    await page.getByLabel('Journal entry').blur();
    await page.reload();
    expect(await page.getByLabel('Journal entry').inputValue()).toBe(long);
    expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), 'long journal');
    await page.locator('.arch button').click();
    expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), 'long journal archive');
  });

  for (const n of [0, 1, 2]) {
    test(`sparkline with ${n} point(s)`, async ({ page }) => {
      const w = watch(page);
      const journal = Array.from({ length: n }, (_, i) => ({ id: `j${i}`, date: daysAgo(i), kind: 'daily', body: '', mood: 3 + i, energy: 2 }));
      await seed(page, { journal });
      await open(page, '/journal');
      await expect(page.locator('svg.spark circle')).toHaveCount(n * 2);
      expect(await page.locator('svg.spark').innerHTML()).not.toMatch(/NaN/);
      expect(w.errors).toEqual([]);
    });
  }

  test('legacy: two daily entries for the same date do not crash, archive shows both', async ({ page }) => {
    const w = watch(page);
    const journal = [{ id: 'a', date: TODAY(), kind: 'daily', body: 'first copy' }, { id: 'b', date: TODAY(), kind: 'daily', body: 'second copy' }];
    await seed(page, { journal });
    await open(page, '/journal');
    await expect(page.locator('.arch')).toHaveCount(2);
    await page.getByLabel('Journal entry').fill('edited');
    await page.getByLabel('Journal entry').blur();
    expect((await store(page)).journal).toHaveLength(2);
    expect(w.errors).toEqual([]);
  });

  test('an entry that arrives after mount (cloud sync) is edited, not duplicated', async ({ page }) => {
    await open(page, '/journal');
    await page.evaluate((d) => {
      // emulate a pull from the cloud adding today's entry with a different id while the page is open
      const raw = JSON.parse(localStorage.getItem('life-tracker-v1')!);
      raw.state.journal = [{ id: 'cloud', date: d, kind: 'daily', body: 'from phone' }];
      localStorage.setItem('life-tracker-v1', JSON.stringify(raw));
    }, TODAY());
    await page.reload();
    await page.getByLabel('Journal entry').fill('from phone, plus more');
    await page.getByLabel('Journal entry').blur();
    const s = await store(page);
    expect(s.journal.filter((e: { kind: string }) => e.kind === 'daily')).toHaveLength(1);
  });

  test('midnight: text saved at 23:59 belongs to that day, next day starts blank and the old entry is archived', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 2, 10, 23, 59, 30));
    await open(page, '/journal');
    await expect(page.locator('.j-date').first()).toContainText('10 March');
    await page.getByLabel('Journal entry').fill('late night thoughts');
    await page.getByLabel('Journal entry').blur();
    expect((await store(page)).journal[0].date).toBe('2026-03-10');
    await page.clock.setFixedTime(new Date(2026, 2, 11, 0, 0, 5));
    await page.reload();
    await expect(page.locator('.j-date').first()).toContainText('11 March');
    await expect(page.getByLabel('Journal entry')).toHaveValue('');
    await expect(page.locator('.arch')).toHaveCount(1);
  });

  test('week boundary: Sunday and Monday belong to different weekly reviews', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 2, 8, 12, 0, 0)); // Sunday 8 March 2026
    await open(page, '/journal');
    await page.getByRole('tab', { name: 'Weekly review' }).click();
    await expect(page.locator('.j-date').first()).toContainText('2 March');
    await page.getByLabel('Wins').fill('sunday win');
    await page.getByLabel('Wins').blur();
    await page.clock.setFixedTime(new Date(2026, 2, 9, 12, 0, 0)); // Monday
    await page.reload();
    await page.getByRole('tab', { name: 'Weekly review' }).click();
    await expect(page.locator('.j-date').first()).toContainText('9 March');
    await expect(page.getByLabel('Wins')).toHaveValue('');
  });

  test('conversations: validation, streak, same-day entries, recent list', async ({ page }) => {
    await seed(page, { conversations: [{ id: 'c1', date: daysAgo(1), who: 'Priya' }, { id: 'c2', date: daysAgo(2), who: 'Sam' }, { id: 'c3', date: daysAgo(4), who: 'Old' }] });
    await open(page, '/journal');
    await expect(page.locator('.streak b')).toHaveText('2'); // streak alive from yesterday
    await page.getByRole('button', { name: 'Log', exact: true }).click(); // empty: ignored
    await expect(page.locator('.conv .list-row')).toHaveCount(3);
    await page.getByLabel('Who').fill('   ');
    await page.getByLabel('Who').press('Enter');
    await expect(page.locator('.conv .list-row')).toHaveCount(3);
    await page.getByLabel('Who').fill('  Aman ');
    await page.getByLabel('Note').fill('met at the gym');
    await page.getByLabel('Note').press('Enter');
    await expect(page.locator('.streak b')).toHaveText('3');
    await expect(page.getByLabel('Who')).toHaveValue('');
    await page.getByLabel('Who').fill('Second today');
    await page.getByRole('button', { name: 'Log', exact: true }).click();
    await expect(page.locator('.streak b')).toHaveText('3'); // same day twice does not inflate
    await page.reload();
    await expect(page.locator('.conv .list-row').first()).toContainText(/Aman|Second today/);
    expect((await store(page)).conversations).toHaveLength(5);
  });

  test('conversations: empty account shows 0 streak and no rows', async ({ page }) => {
    await open(page, '/journal');
    await expect(page.locator('.streak b')).toHaveText('0');
    await expect(page.locator('.conv .list-row')).toHaveCount(0);
  });

  test('conversations: only the 6 most recent are listed and long names wrap', async ({ page }, info) => {
    const convs = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, date: daysAgo(i), who: i === 0 ? 'Z'.repeat(150) : `Person ${i}`, note: i === 0 ? 'N'.repeat(150) : undefined }));
    await seed(page, { conversations: convs });
    await open(page, '/journal');
    await expect(page.locator('.conv .list-row')).toHaveCount(6);
    expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), 'long conversation');
  });
});

// ---------- BOOKS flows ----------
test.describe('books flows', () => {
  const add = async (page: Page, title: string, author = '', pages = '', idx = 0) => {
    const f = page.locator('.bk-col').nth(idx).locator('.bk-add');
    await f.getByLabel('Book title').fill(title);
    if (author) await f.getByLabel('Author').fill(author);
    if (pages) await f.getByLabel('Pages').fill(pages);
    await f.getByRole('button', { name: 'Add' }).click();
  };
  const shelf = (page: Page, idx = 0) => page.locator('.bk-col').nth(idx).locator('.bk-shelf');

  test('empty account: empty states on both shelves', async ({ page }) => {
    await open(page, '/books');
    await expect(shelf(page, 0).locator('.bk-empty')).toHaveCount(2);
    await expect(shelf(page, 1).locator('.bk-empty')).toHaveCount(2);
    await expect(page.locator('.page .label').first()).toContainText('0 reading · 0 finished');
  });

  test('add validation: empty/whitespace title ignored, bad pages ignored', async ({ page }) => {
    await open(page, '/books');
    await add(page, '   ');
    expect((await store(page)).books ?? []).toEqual([]);
    await add(page, 'Deep Work', ' Cal Newport ', '-5');
    await add(page, 'Other', '', 'abc');
    const books = (await store(page)).books;
    expect(books).toHaveLength(2);
    expect(books[0]).toMatchObject({ title: 'Deep Work', author: 'Cal Newport', status: 'queued', kind: 'self' });
    expect(books[0].pages).toBeUndefined();
    expect(books[1].pages).toBeUndefined();
  });

  test('Enter in the title field adds, fields reset, double click adds once', async ({ page }) => {
    await open(page, '/books');
    const f = page.locator('.bk-col').nth(0).locator('.bk-add');
    await f.getByLabel('Book title').fill('One Book');
    await f.getByLabel('Book title').press('Enter');
    await expect(f.getByLabel('Book title')).toHaveValue('');
    await f.getByLabel('Book title').fill('Dbl');
    await f.getByRole('button', { name: 'Add' }).dblclick();
    expect((await store(page)).books).toHaveLength(2);
  });

  test('full lifecycle: add, start, progress clamps, finish, rate toggle, reread, remove', async ({ page }) => {
    await open(page, '/books');
    await add(page, 'Atomic Habits', 'James Clear', '300');
    await shelf(page).getByRole('button', { name: 'Start reading' }).click();
    const input = page.getByLabel('Current page of Atomic Habits').locator('visible=true');
    await expect(input).toHaveValue('0');
    await input.fill('120');
    await expect(input).toHaveValue('120');
    await input.fill('999');
    await expect(input).toHaveValue('300'); // clamped to pages
    await input.fill('-4');
    await expect(input).toHaveValue('0');
    await input.fill('');
    await expect(input).toHaveValue('0');
    await input.pressSequentially('abc-e'); // a number input rejects letters
    await expect(input).toHaveValue('0');
    await input.fill('150');
    await page.reload();
    await expect(page.getByLabel('Current page of Atomic Habits').locator('visible=true')).toHaveValue('150');
    await shelf(page).getByRole('button', { name: 'Finished', exact: true }).click();
    let b = (await store(page)).books[0];
    expect(b).toMatchObject({ status: 'done', page: 300, finishedAt: TODAY() });
    await expect(page.locator('.page .label').first()).toContainText('0 reading · 1 finished');
    // rating toggle
    await shelf(page).getByRole('button', { name: '4 stars' }).click();
    expect((await store(page)).books[0].rating).toBe(4);
    await shelf(page).getByRole('button', { name: '4 stars' }).click();
    expect((await store(page)).books[0].rating).toBeUndefined();
    await shelf(page).getByRole('button', { name: '5 stars' }).click();
    await expect(shelf(page).locator('.bk-stars button.on')).toHaveCount(5);
    // reread: back to the list, as a fresh read from page 0
    await shelf(page).getByRole('button', { name: 'Reread' }).click();
    b = (await store(page)).books[0];
    expect(b.status).toBe('queued');
    expect(b.finishedAt).toBeUndefined();
    await shelf(page).getByRole('button', { name: 'Start reading' }).click();
    await expect(page.getByLabel('Current page of Atomic Habits').locator('visible=true')).toHaveValue('0');
    // pause, then remove
    await shelf(page).getByRole('button', { name: 'Pause' }).click();
    await shelf(page).getByRole('button', { name: 'Remove Atomic Habits' }).click();
    expect((await store(page)).books).toEqual([]);
  });

  test('book without a page count: progress is unbounded but never negative, finish keeps page', async ({ page }) => {
    await open(page, '/books');
    await add(page, 'Mystery');
    await shelf(page).getByRole('button', { name: 'Start reading' }).click();
    const input = page.getByLabel('Current page of Mystery').locator('visible=true');
    await input.fill('12345678');
    await expect(input).toHaveValue('12345678');
    await shelf(page).getByRole('button', { name: 'Finished', exact: true }).click();
    expect((await store(page)).books[0]).toMatchObject({ status: 'done', page: 12345678 });
  });

  test('legacy book (no kind) is on Self-growth, not on Stories', async ({ page }) => {
    await seed(page, { books: [{ id: 'old', title: 'Legacy Title', status: 'queued' }] });
    await open(page, '/books');
    await expect(page.locator('.bk-col').nth(0)).toContainText('Legacy Title');
    await expect(page.locator('.bk-col').nth(1)).not.toContainText('Legacy Title');
  });

  test('shelves are independent; phone shows one at a time, desktop shows both', async ({ page }, info) => {
    await open(page, '/books');
    const phone = info.project.name !== 'desktop';
    await add(page, 'Self Book');
    if (phone) {
      await expect(page.locator('.bk-col').nth(1)).toBeHidden();
      await page.getByRole('tab', { name: 'Stories' }).click();
      await expect(page.getByRole('tab', { name: 'Stories' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.bk-col').nth(0)).toBeHidden();
    } else {
      await expect(page.locator('.bk-col').nth(0)).toBeVisible();
      await expect(page.locator('.bk-col').nth(1)).toBeVisible();
      await page.locator('.bk-col').nth(1).getByLabel('Book title').fill('Story Book');
      await page.locator('.bk-col').nth(1).getByRole('button', { name: 'Add' }).click();
    }
    if (phone) await add(page, 'Story Book', '', '', 1);
    const books = (await store(page)).books;
    expect(books.map((b: { title: string; kind: string }) => [b.title, b.kind])).toEqual([['Self Book', 'self'], ['Story Book', 'story']]);
    await expect(page.locator('.bk-col').nth(1)).toContainText('Story Book');
    await expect(page.locator('.bk-col').nth(1)).not.toContainText('Self Book');
  });

  test('finished list is newest first; kicker counts reading and finished across shelves', async ({ page }) => {
    const books = [
      { id: '1', title: 'Older', status: 'done', finishedAt: '2026-01-01', kind: 'self' },
      { id: '2', title: 'Newer', status: 'done', finishedAt: '2026-02-01', kind: 'self' },
      { id: '3', title: 'Nodate', status: 'done', kind: 'self' },
      { id: '4', title: 'NowStory', status: 'reading', kind: 'story', pages: 10, page: 3 },
    ];
    await seed(page, { books });
    await open(page, '/books');
    await expect(page.locator('.page .label').first()).toContainText('1 reading · 3 finished');
    const titles = await page.locator('.bk-col').nth(0).locator('.is-done .bk-title').allInnerTexts();
    expect(titles).toEqual(['Newer', 'Older', 'Nodate']);
  });

  test('very long titles and many books stay inside the layout', async ({ page }, info) => {
    const long = 'A'.repeat(180);
    const books = Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, title: i === 0 ? long : `Book ${i} with a fairly long and descriptive title`, author: i === 0 ? 'B'.repeat(120) : 'Some Author', status: (['queued', 'reading', 'done'] as const)[i % 3], kind: i % 2 ? 'story' : 'self', pages: 300, page: 20 }));
    await seed(page, { books });
    await open(page, '/books');
    expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), 'many books');
    if (info.project.name !== 'desktop') {
      await page.getByRole('tab', { name: 'Stories' }).click();
      expectCleanLayout(await layout(page, { touch: true }), 'many books stories');
    }
  });

  test('page progress input is bounded and does not exceed pages when pages shrink to zero', async ({ page }) => {
    await seed(page, { books: [{ id: 'z', title: 'Zero', status: 'reading', kind: 'self', pages: 0, page: 5 }] });
    const w = watch(page);
    await open(page, '/books');
    await expect(page.getByLabel('Current page of Zero').locator('visible=true')).toHaveValue('5');
    expect(await page.locator('.bk-col').nth(0).innerText()).not.toMatch(/NaN|Infinity/);
    expect(w.errors).toEqual([]);
  });
});
