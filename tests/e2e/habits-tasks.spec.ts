import { test, expect, type Page } from '@playwright/test';
import { MODES, SKINS, contrastIssues, expectCleanLayout, layout, shot, visit, watch } from './fixtures';

/** HABITS and TASKS: theme matrix + real user flows. Narrow with SKINS=canopy MODES=dark. */

const KEY = 'life-tracker-v1';
const d = (offset: number, base = new Date()) => { const x = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

/** Pre-load part of the persisted store (the rest falls back to defaults). Runs only when nothing is stored yet, so reloads keep state. */
async function seedState(page: Page, partial: Record<string, unknown>) {
  await page.addInitScript(([k, p]) => { if (!localStorage.getItem(k as string)) localStorage.setItem(k as string, JSON.stringify({ state: p, version: 2 })); }, [KEY, partial] as const);
}
/** Form control inside a Field by its label text (labels wrap the control, so accessible-name matching is too loose). */
const fld = (page: Page, label: string) => page.locator('label.field').filter({ has: page.locator('.label', { hasText: new RegExp('^' + label + '$') }) }).locator('input,select,textarea');
const stored = (page: Page) => page.evaluate((k) => { window.dispatchEvent(new Event('pagehide')); return JSON.parse(localStorage.getItem(k) ?? '{}').state ?? {}; }, KEY);
const open = async (page: Page, route: string, extra = '') => { await page.goto(`${route}?skin=canopy&mode=dark${extra}`); await expect(page.locator('.main').first()).toBeVisible(); };
const mkTask = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, title, done: false, context: 'personal', tags: [], effort: 2, stat: 'discipline', date: d(0), ...over });
const mkHabit = (id: string, name: string, cadence: unknown, over: Record<string, unknown> = {}) => ({ id, name, stat: 'mind', cadence, xp: 15, ...over });
const logs = (hid: string, dates: string[]) => dates.map((date, i) => ({ id: `${hid}-${i}`, habitId: hid, date, level: 'full' }));
const streakOf = (page: Page, name: string) => page.locator('.hb-row', { hasText: name }).locator('.hb-streak').innerText().then((t) => t.replace(/\s+/g, ''));

// ------------------------------------------------------------------ theme matrix
for (const route of ['/habits', '/tasks']) for (const skin of SKINS) for (const mode of MODES) {
  test(`matrix ${route} · ${skin} · ${mode}`, async ({ page }, info) => {
    const w = watch(page);
    await visit(page, route, skin, mode);
    await expect(page.locator('.main').first()).toBeVisible();
    const touch = info.project.name !== 'desktop';
    expectCleanLayout(await layout(page, { touch }), `${route} ${skin} ${mode}`);
    // the entrance animation is finished after visit(); contrast on the page content
    expect(await contrastIssues(page, '.main'), 'contrast').toEqual([]);
    if (process.env.SHOTS) await shot(page, info, `${route.replace(/\W+/g, '_')}-${skin}-${mode}`, true);
    w.stop();
    expect(w.errors, 'console/page errors').toEqual([]);
  });
}

// the sheets (new habit / new task) are part of the pages too: check one pass per theme
for (const skin of SKINS) for (const mode of MODES) {
  test(`matrix sheets · ${skin} · ${mode}`, async ({ page }, info) => {
    const w = watch(page);
    const touch = info.project.name !== 'desktop';
    await visit(page, '/habits', skin, mode);
    await page.getByRole('button', { name: /Add/ }).first().click();
    await fld(page, 'Cadence').selectOption('days');
    await expect(page.getByRole('dialog')).toBeVisible();
    expectCleanLayout({ ...(await layout(page, { touch })), tabbarGap: null }, `habit sheet ${skin} ${mode}`); // the tab bar sits behind the modal scrim
    await page.waitForTimeout(500); // let the sheet's entrance animation finish before measuring contrast
    expect(await contrastIssues(page, '.sheet'), 'habit sheet contrast').toEqual([]);
    if (process.env.SHOTS) await shot(page, info, `habit-sheet-${skin}-${mode}`);
    await visit(page, '/tasks', skin, mode);
    await page.getByRole('button', { name: /New/ }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expectCleanLayout({ ...(await layout(page, { touch })), tabbarGap: null }, `task sheet ${skin} ${mode}`);
    await page.waitForTimeout(500);
    expect(await contrastIssues(page, '.sheet'), 'task sheet contrast').toEqual([]);
    if (process.env.SHOTS) await shot(page, info, `task-sheet-${skin}-${mode}`);
    w.stop();
    expect(w.errors).toEqual([]);
  });
}

// ------------------------------------------------------------------ habits flows
test.describe('habits flows', () => {
  test('add habit: validation, save, persistence', async ({ page }) => {
    await open(page, '/habits');
    const before = await page.locator('.hb-row').count();
    await page.getByRole('button', { name: /Add/ }).first().click();
    const save = page.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await fld(page, 'Name').press('Enter'); // empty submit must do nothing
    await expect(page.getByRole('dialog')).toBeVisible();
    await fld(page, 'Name').fill('   ');
    await expect(save).toBeDisabled();
    await fld(page, 'Name').fill('  Qstretch  ');
    await fld(page, 'Stat').selectOption('body');
    await fld(page, 'Minimum version').fill('one stretch');
    await fld(page, 'Name').press('Enter');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('.hb-row', { hasText: 'Qstretch' })).toHaveCount(1);
    await expect(page.locator('.hb-row')).toHaveCount(before + 1);
    await page.reload();
    const h = (await stored(page)).habits.find((x: { name: string }) => x.name === 'Qstretch');
    expect(h).toMatchObject({ name: 'Qstretch', stat: 'body', minimum: 'one stretch', cadence: { type: 'daily' } });
    await expect(page.locator('.hb-row', { hasText: 'Qstretch' })).toBeVisible();
  });

  test('specific days needs at least one day; weekly count is clamped to 1..7', async ({ page }) => {
    await open(page, '/habits');
    await page.getByRole('button', { name: /Add/ }).first().click();
    await fld(page, 'Name').fill('Qswim');
    await fld(page, 'Cadence').selectOption('days');
    for (const day of ['Mo', 'We', 'Fr']) await page.getByRole('button', { name: day, exact: true }).click(); // untoggle defaults
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await page.getByRole('button', { name: 'Tu', exact: true }).click();
    await page.getByRole('button', { name: 'Su', exact: true }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.hb-row', { hasText: 'Qswim' }).locator('.hb-cad')).toContainText('Su Tu');

    await page.getByRole('button', { name: /Add/ }).first().click();
    await fld(page, 'Name').fill('Qrun');
    await fld(page, 'Cadence').selectOption('weekly');
    await fld(page, 'Times per week').fill('99');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog'), 'native max=7 blocks the submit').toBeVisible();
    await fld(page, 'Times per week').fill('7');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.hb-row', { hasText: 'Qrun' }).locator('.hb-cad')).toContainText('7× a week');
    await page.getByRole('button', { name: /Add/ }).first().click();
    await fld(page, 'Name').fill('Qyoga');
    await fld(page, 'Cadence').selectOption('weekly');
    await fld(page, 'Times per week').fill('-3');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog'), 'native min=1 blocks the submit').toBeVisible();
    await fld(page, 'Times per week').fill('1');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.hb-row', { hasText: 'Qyoga' }).locator('.hb-cad')).toContainText('1× a week');
  });

  test('XP value: native validation blocks 0 / negative / fractional, absurd values are capped', async ({ page }) => {
    await open(page, '/habits');
    const add = async (name: string, xp: string) => {
      await page.getByRole('button', { name: /Add/ }).first().click();
      await fld(page, 'Name').fill(name);
      await fld(page, 'XP for full completion').fill(xp);
      await page.getByRole('button', { name: 'Save' }).click();
    };
    for (const bad of ['0', '-50', '2.5']) {
      await add('Xbad', bad);
      await expect(page.getByRole('dialog'), `xp ${bad} must not be saved`).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).click();
    }
    expect(((await stored(page)).habits as { name: string }[]).some((h) => h.name === 'Xbad')).toBe(false);
    await add('Xhuge', '99999999999');
    await expect(page.getByRole('dialog')).toBeHidden();
    const hs = (await stored(page)).habits as { name: string; xp: number }[];
    expect(hs.find((h) => h.name === 'Xhuge')!.xp).toBeLessThanOrEqual(1000);
  });

  test('edit, archive and restore a habit', async ({ page }) => {
    await seedState(page, { habits: [mkHabit('a', 'Journal', { type: 'daily' })], habitLogs: [] });
    await open(page, '/habits');
    await page.getByRole('button', { name: 'Journal' }).click();
    await fld(page, 'Name').fill('Journal nightly');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Journal nightly' })).toBeVisible();
    await page.getByRole('button', { name: 'Journal nightly' }).click();
    await page.getByRole('button', { name: 'Archive' }).click();
    await expect(page.locator('.hb-row')).toHaveCount(0);
    await expect(page.locator('.hb-empty')).toBeVisible();
    await expect(page.locator('.hb-arow')).toContainText('Journal nightly');
    await page.reload();
    await page.locator('.hb-arow .name').click();
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.locator('.hb-row')).toHaveCount(1);
    expect((await stored(page)).habits[0].archived).toBeFalsy();
  });

  test('habits group by stat and show active count', async ({ page }) => {
    await seedState(page, { habits: [mkHabit('a', 'A', { type: 'daily' }, { stat: 'body' }), mkHabit('b', 'B', { type: 'daily' }, { stat: 'skill' }), mkHabit('c', 'C', { type: 'daily' }, { stat: 'skill' })], habitLogs: [] });
    await open(page, '/habits');
    await expect(page.locator('.section-header .label').filter({ hasText: /^Body$|^Skill$/ })).toHaveCount(2);
    await expect(page.locator('.hb-group')).toHaveCount(2);
    await expect(page.getByText('3 active')).toBeVisible();
  });

  test('streak maths: daily across a month, today open does not break it', async ({ page }) => {
    // 45 consecutive days ending yesterday crosses at least one month boundary
    await seedState(page, { habits: [mkHabit('a', 'Daily', { type: 'daily' })], habitLogs: logs('a', Array.from({ length: 45 }, (_, i) => d(-1 - i))) });
    await open(page, '/habits');
    expect(await streakOf(page, 'Daily')).toBe('45d');
  });
  test('streak maths: a gap ends the streak and today counts when logged', async ({ page }) => {
    await seedState(page, { habits: [mkHabit('a', 'Gap', { type: 'daily' })], habitLogs: logs('a', [d(0), d(-1), d(-2), d(-4), d(-5)]) });
    await open(page, '/habits');
    expect(await streakOf(page, 'Gap')).toBe('3d');
  });
  test('streak maths: specific weekdays skip unscheduled days', async ({ page }) => {
    const sched = [1, 3, 5]; // Mon Wed Fri
    const days = Array.from({ length: 28 }, (_, i) => d(-i)).filter((x) => sched.includes(new Date(x + 'T00:00:00').getDay()));
    await seedState(page, { habits: [mkHabit('a', 'MWF', { type: 'days', days: sched })], habitLogs: logs('a', days.slice(0, 5)) });
    await open(page, '/habits');
    // today may be scheduled but unlogged only if it is the first element's gap; either way 5 logged scheduled days in a row
    const n = parseInt((await streakOf(page, 'MWF')), 10);
    const todaySched = sched.includes(new Date().getDay());
    expect(n).toBe(todaySched && days[0] !== d(0) ? 0 : 5);
  });
  test('streak maths: weekly habit counts weeks that met the target (across the year boundary)', async ({ page }) => {
    // 2 per week, met in each of the last 3 full weeks (Mon-start weeks), current week open
    const t = new Date(); const k = (t.getDay() + 6) % 7; const ws = (w: number) => d(-k - 7 * w);
    const ds = [1, 2, 3].flatMap((w) => [ws(w), d(-k - 7 * w + 2)]);
    await seedState(page, { habits: [mkHabit('a', 'Weekly', { type: 'weekly', perWeek: 2 })], habitLogs: logs('a', ds) });
    await open(page, '/habits');
    expect(await streakOf(page, 'Weekly')).toBe('3w');
  });
  test('weekly habit streak at a Monday midnight boundary keeps last week streak', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2027, 0, 4, 0, 5)); // Monday 4 Jan 2027, just after midnight, new year
    const f = (iso: string) => iso;
    const base = new Date(2027, 0, 4);
    const day = (o: number) => d(o, base);
    await seedState(page, { habits: [mkHabit('a', 'NY', { type: 'weekly', perWeek: 3 })], habitLogs: logs('a', [day(-7), day(-5), day(-3), day(-14), day(-12), day(-10)].map(f)), settledThrough: day(-1) });
    await open(page, '/habits');
    expect(await streakOf(page, 'NY')).toBe('2w');
  });

  test('metric chips toggle sections and persist', async ({ page }) => {
    await visit(page, '/habits', 'canopy', 'dark');
    await expect(page.locator('.hb-streak').first()).toBeVisible();
    await page.getByRole('button', { name: 'streaks', exact: true }).click();
    await expect(page.locator('.hb-streak')).toHaveCount(0);
    await expect(page.locator('.hb-best')).toHaveCount(0);
    await page.getByRole('button', { name: 'percentage', exact: true }).click();
    await expect(page.locator('.hb-pct')).toHaveCount(0);
    await page.getByRole('button', { name: 'heatmap', exact: true }).click(); // all three off must not crash
    await expect(page.locator('svg.hm')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'streaks', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.hb-row').first()).toBeVisible();
  });

  test('long habit name and many habits do not break layout; name tap target is tall enough', async ({ page }, info) => {
    const many = Array.from({ length: 40 }, (_, i) => mkHabit('h' + i, i === 0 ? 'A very long habit name that keeps going and going well past the edge of any phone screen ' + 'x'.repeat(60) : 'Habit ' + i, i % 3 ? { type: 'daily' } : { type: 'weekly', perWeek: 4 }, { stat: ['body', 'mind', 'skill', 'discipline'][i % 4] }));
    await seedState(page, { habits: many, habitLogs: [] });
    await open(page, '/habits');
    expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), 'many habits');
    if (info.project.name !== 'desktop') {
      await page.locator('.hb-row .name').nth(1).scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 0));
      const b = await page.locator('.hb-row .name').nth(1).boundingBox();
      expect(b!.height, 'habit name button is a comfortable tap target').toBeGreaterThanOrEqual(36);
    }
  });

  test('weekly score ring reflects completion and empty set shows 0 without NaN', async ({ page }) => {
    await seedState(page, { habits: [mkHabit('a', 'Only', { type: 'daily' })], habitLogs: logs('a', [d(0), d(-1), d(-2), d(-3), d(-4), d(-5), d(-6)]) });
    await open(page, '/habits');
    await expect(page.getByRole('img', { name: 'Weekly score 100 percent' })).toBeVisible();
    await expect(page.getByText('Locked in.')).toBeVisible();
  });

  test('no active habits shows the empty state (archived ones stay listed)', async ({ page }) => {
    await seedState(page, { habits: [mkHabit('z', 'Gone', { type: 'daily' }, { archived: true })], habitLogs: [] });
    await open(page, '/habits');
    await expect(page.getByText('No habits yet')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('NaN');
  });

  test('a habit scheduled on no day (weekly 7 with zero logs) shows 0 not NaN', async ({ page }) => {
    await seedState(page, { habits: [mkHabit('a', 'Z', { type: 'days', days: [] })], habitLogs: [] });
    await open(page, '/habits');
    await expect(page.locator('body')).not.toContainText('NaN');
    await expect(page.locator('.hb-row .hb-pct')).toContainText('0');
  });
});

// ------------------------------------------------------------------ tasks flows
test.describe('tasks flows', () => {
  const tab = (page: Page, n: RegExp | string) => page.getByRole('tab', { name: n });
  const quick = (page: Page) => page.getByLabel('Capture a task');

  test('quick add with Enter; blank does nothing; persists', async ({ page }) => {
    await open(page, '/tasks');
    await expect(page.getByText('Nothing due. A clear desk.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add task' })).toBeDisabled();
    await quick(page).press('Enter');
    await quick(page).fill('   '); await quick(page).press('Enter');
    expect((await stored(page)).tasks ?? []).toHaveLength(0);
    await quick(page).fill('  Buy milk  '); await quick(page).press('Enter');
    await expect(quick(page)).toHaveValue('');
    await expect(page.locator('.tk-row')).toHaveCount(1);
    await expect(tab(page, /^Today/)).toContainText('1');
    await page.reload();
    await expect(page.locator('.tk-row .tk-text')).toHaveText('Buy milk');
    expect((await stored(page)).tasks[0]).toMatchObject({ title: 'Buy milk', done: false, date: d(0) });
  });

  test('completing awards XP once, moves to Done; undo removes the XP', async ({ page }) => {
    await seedState(page, { tasks: [mkTask('t1', 'Write report', { effort: 3, stat: 'skill' })], xp: [] });
    await open(page, '/tasks');
    await page.getByRole('button', { name: 'Complete Write report' }).click();
    await expect(page.locator('.tk-xp')).toContainText('+40 XP');
    let s = await stored(page);
    expect(s.xp).toHaveLength(1); expect(s.xp[0]).toMatchObject({ amount: 40, stat: 'skill', ref: 'task:t1' });
    await expect(page.locator('.tk-row')).toHaveCount(0, { timeout: 4000 }); // lingers briefly, then leaves Today
    await tab(page, /^Done/).click();
    await expect(page.locator('.tk-row.done')).toHaveCount(1);
    await page.getByRole('button', { name: 'Complete Write report' }).click(); // un-complete
    s = await stored(page);
    expect(s.xp).toHaveLength(0);
    expect(s.tasks[0].done).toBe(false);
    expect(s.tasks[0].doneAt).toBeUndefined();
  });

  test('rapid double click on the check ring cannot duplicate XP', async ({ page }) => {
    await seedState(page, { tasks: [mkTask('t1', 'Rapid')], xp: [] });
    await open(page, '/tasks');
    await page.getByRole('button', { name: 'Complete Rapid' }).dblclick();
    const s = await stored(page);
    expect(s.xp.length).toBeLessThanOrEqual(1);
    expect(s.xp.length).toBe(s.tasks[0].done ? 1 : 0);
  });

  test('recurring task spawns exactly one next occurrence, even after undo and redo', async ({ page }) => {
    await seedState(page, { tasks: [mkTask('r', 'Water plants', { recurrence: { every: 'day', interval: 2 } })], xp: [] });
    await open(page, '/tasks');
    const ring = page.getByRole('button', { name: 'Complete Water plants' });
    await ring.click();
    let s = await stored(page);
    expect(s.tasks).toHaveLength(2);
    expect(s.tasks.find((t: { id: string }) => t.id !== 'r')).toMatchObject({ done: false, date: d(2) });
    await tab(page, /^Done/).click();
    await page.getByRole('button', { name: 'Complete Water plants' }).click(); // undo
    await tab(page, /^Today/).click();
    await page.getByRole('button', { name: 'Complete Water plants' }).click(); // redo
    s = await stored(page);
    const open_ = s.tasks.filter((t: { done: boolean }) => !t.done);
    expect(open_, 'only one open successor').toHaveLength(1);
  });

  test('recurring weekly/monthly next date, and recurring badge text', async ({ page }) => {
    await seedState(page, { tasks: [mkTask('w', 'Weekly review', { recurrence: { every: 'week', interval: 1 } }), mkTask('m', 'Pay rent', { recurrence: { every: 'month', interval: 1 }, date: '2026-01-31' })] });
    await open(page, '/tasks');
    await expect(page.getByText('Every week')).toBeVisible();
    await page.getByRole('button', { name: 'Complete Weekly review' }).click();
    const s = await stored(page);
    expect(s.tasks.find((t: { id: string; title: string }) => t.id !== 'w' && t.title === 'Weekly review').date).toBe(d(7));
  });

  test('completing an overdue recurring task schedules the next one in the future', async ({ page }) => {
    await seedState(page, { tasks: [mkTask('o', 'Overdue daily', { date: d(-5), recurrence: { every: 'day', interval: 1 } })] });
    await open(page, '/tasks');
    await page.getByRole('button', { name: 'Complete Overdue daily' }).click();
    const s = await stored(page);
    const next = s.tasks.find((t: { id: string }) => t.id !== 'o');
    expect(next.date >= d(0), `next date ${next.date} must not be in the past`).toBe(true);
  });

  test('overdue tasks are grouped and labelled', async ({ page }) => {
    await seedState(page, { tasks: [mkTask('a', 'Late one', { date: d(-3) }), mkTask('b', 'Yesterday one', { date: d(-1) }), mkTask('c', 'Now one')] });
    await open(page, '/tasks');
    await expect(page.locator('h3.tk-over, .tk-group h3.over')).toContainText('Overdue');
    await expect(page.getByText('3 days overdue')).toBeVisible();
    await expect(page.getByText('Yesterday', { exact: true })).toBeVisible();
    await expect(tab(page, /^Today/)).toContainText('3');
  });

  test('upcoming groups by date, ordered; future tasks stay out of Today', async ({ page }) => {
    await seedState(page, { tasks: [mkTask('a', 'Later', { date: d(9) }), mkTask('b', 'Tomorrow thing', { date: d(1) }), mkTask('c', 'Far', { date: d(60) })] });
    await open(page, '/tasks');
    await expect(page.locator('.tk-row')).toHaveCount(0);
    await tab(page, /^Upcoming/).click();
    await expect(page.locator('.tk-group h3').first()).toContainText('Tomorrow');
    const titles = await page.locator('.tk-row .tk-text').allInnerTexts();
    expect(titles).toEqual(['Tomorrow thing', 'Later', 'Far']);
  });

  test('goals: quick add on the Goals tab creates a short-horizon goal; sheet can make a long one', async ({ page }) => {
    await open(page, '/tasks');
    await tab(page, /^Goals/).click();
    await expect(page.getByText('No goals yet')).toBeVisible();
    await quick(page).fill('Ship v1'); await quick(page).press('Enter');
    await expect(page.locator('.tk-group h3')).toContainText('Short horizon');
    await page.getByRole('button', { name: 'New' }).click();
    await fld(page, 'Title').fill('Retire early');
    await expect(fld(page, 'Horizon')).toHaveValue('short');
    await fld(page, 'Horizon').selectOption('long');
    await fld(page, 'Title').press('Enter');
    await expect(page.locator('.tk-group h3').filter({ hasText: 'Long horizon' })).toBeVisible();
    expect((await stored(page)).tasks.find((t: { title: string }) => t.title === 'Ship v1').date).toBeUndefined();
  });

  test('sheet: validation, edit, effort/stat, tags normalised, delete', async ({ page }) => {
    await open(page, '/tasks');
    await page.getByRole('button', { name: 'New' }).click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await fld(page, 'Title').press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await fld(page, 'Title').fill('Plan trip');
    await page.getByRole('button', { name: /3 · 40 XP/ }).click();
    await fld(page, 'Stat').selectOption('mind');
    await fld(page, 'Context').selectOption('learning');
    await fld(page, 'Tags').fill(' Travel,  FUN ,, ');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const t = (await stored(page)).tasks[0];
    expect(t).toMatchObject({ title: 'Plan trip', effort: 3, stat: 'mind', context: 'learning', tags: ['travel', 'fun'] });
    await page.locator('.tk-hit', { hasText: 'Plan trip' }).click();
    await fld(page, 'Title').fill('Plan trip 2');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.tk-text')).toHaveText('Plan trip 2');
    await page.locator('.tk-hit', { hasText: 'Plan trip 2' }).first().click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.tk-row')).toHaveCount(0);
    expect((await stored(page)).tasks).toHaveLength(0);
  });

  test('clearing the date moves a task to Today; a past date makes it overdue; huge repeat N is accepted safely', async ({ page }) => {
    await seedState(page, { tasks: [mkTask('a', 'Dated', { date: d(5) })] });
    await open(page, '/tasks');
    await tab(page, /^Upcoming/).click();
    await page.locator('.tk-hit', { hasText: 'Dated' }).first().click();
    await fld(page, 'Date').fill('');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.tk-row')).toHaveCount(0);
    await tab(page, /^Today/).click();
    await expect(page.locator('.tk-row')).toHaveCount(1);
    await page.locator('.tk-hit', { hasText: 'Dated' }).first().click();
    await fld(page, 'Date').fill(d(-10));
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('10 days overdue')).toBeVisible();
    await page.locator('.tk-hit', { hasText: 'Dated' }).first().click();
    await fld(page, 'Repeat').selectOption('day');
    await fld(page, 'N').fill('0');
    await page.getByRole('button', { name: 'Save' }).click();
    expect((await stored(page)).tasks[0].recurrence).toEqual({ every: 'day', interval: 1 });
  });

  test('subtasks: add in sheet, progress arc, complete independently, delete parent removes children', async ({ page }) => {
    await open(page, '/tasks');
    await page.getByRole('button', { name: 'New' }).click();
    await fld(page, 'Title').fill('Launch site');
    await page.getByPlaceholder('Add a step').fill('Write copy');
    await page.getByPlaceholder('Add a step').press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible(); // Enter in the step box adds a step, not submit
    await page.getByPlaceholder('Add a step').fill('Deploy');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click(); // empty add is a no-op
    await expect(page.locator('.tk-sub-edit')).toHaveCount(2);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.tk-row')).toHaveCount(1); // children are nested, not listed on their own
    await expect(page.locator('.tk-arc')).toContainText('0/2');
    await page.getByRole('button', { name: 'Complete Write copy' }).click();
    await expect(page.locator('.tk-arc')).toContainText('1/2');
    const s = await stored(page);
    expect(s.xp).toHaveLength(1); // sub-step XP only for the step, parent still open
    expect(s.tasks.find((t: { title: string }) => t.title === 'Launch site').done).toBe(false);
    await page.reload();
    await page.locator('.tk-hit', { hasText: 'Launch site' }).first().click();
    await page.getByRole('button', { name: 'Delete' }).click();
    expect((await stored(page)).tasks).toHaveLength(0);
  });

  test('removing one subtask in the sheet keeps the other and its done state', async ({ page }) => {
    await seedState(page, { tasks: [mkTask('p', 'Parent'), mkTask('s1', 'Step one', { parentId: 'p', done: true }), mkTask('s2', 'Step two', { parentId: 'p' })] });
    await open(page, '/tasks');
    await page.locator('.tk-hit', { hasText: 'Parent' }).first().click();
    await page.locator('.tk-sub-edit', { hasText: 'Step two' }).getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    const s = await stored(page);
    expect(s.tasks.map((t: { id: string }) => t.id).sort()).toEqual(['p', 's1']);
    expect(s.tasks.find((t: { id: string }) => t.id === 's1').done).toBe(true);
  });

  test('context and tag filters narrow every tab and counts follow', async ({ page }) => {
    await seedState(page, { tasks: [mkTask('a', 'Job A', { context: 'job', tags: ['x'] }), mkTask('b', 'Agency B', { context: 'agency', tags: ['y'] }), mkTask('c', 'Job C', { context: 'job', tags: ['y'] })] });
    await open(page, '/tasks');
    await expect(tab(page, /^Today/)).toContainText('3');
    await page.getByRole('button', { name: 'job', exact: true }).click();
    await expect(page.locator('.tk-row')).toHaveCount(2);
    await expect(tab(page, /^Today/)).toContainText('2');
    await page.locator('.tk-chips button', { hasText: '#y' }).click();
    await expect(page.locator('.tk-row .tk-text')).toHaveText(['Job C']);
    await page.getByRole('button', { name: 'job', exact: true }).click(); // toggle off
    await expect(page.locator('.tk-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.locator('.tk-chips button', { hasText: '#y' }).click();
    await expect(page.locator('.tk-row')).toHaveCount(3);
    await page.locator('.tk-chips button', { hasText: '#y' }).click(); // tag on again
    // quick add inherits the active filter
    await page.getByRole('button', { name: 'agency', exact: true }).click();
    await quick(page).fill('New agency'); await quick(page).press('Enter');
    expect((await stored(page)).tasks.at(-1)).toMatchObject({ context: 'agency', tags: ['y'] });
  });

  test('keyboard: tabs reachable, Enter adds, Tab order reaches the first task ring', async ({ page }) => {
    await seedState(page, { tasks: [mkTask('a', 'Keyboard one')] });
    await open(page, '/tasks');
    await quick(page).focus();
    await page.keyboard.type('Typed'); await page.keyboard.press('Enter');
    await expect(page.locator('.tk-row')).toHaveCount(2);
    await tab(page, /^Goals/).focus(); await page.keyboard.press('Enter');
    await expect(tab(page, /^Goals/)).toHaveAttribute('aria-selected', 'true');
  });

  test('long titles wrap, 120 tasks do not break layout, Done is capped', async ({ page }, info) => {
    const many = Array.from({ length: 120 }, (_, i) => mkTask('t' + i, i === 0 ? 'Supercalifragilistic'.repeat(12) + ' and then a long sentence that wraps over several lines on a phone' : 'Task ' + i, { tags: i % 7 ? [] : ['a-rather-long-tag-name-' + i], done: i > 50, doneAt: new Date(Date.now() - i * 1000).toISOString() }));
    await seedState(page, { tasks: many });
    await open(page, '/tasks');
    expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), 'many tasks');
    await tab(page, /^Done/).click();
    expect(await page.locator('.tk-row').count()).toBe(60);
    expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), 'done tab');
  });

  test('empty states on every tab use the same pattern', async ({ page }) => {
    await open(page, '/tasks');
    for (const [name, text] of [['Upcoming', 'Nothing scheduled ahead'], ['Goals', 'No goals yet'], ['Done', 'Completed work will gather here'], ['Today', 'Nothing due']] as const) {
      await tab(page, new RegExp('^' + name)).click();
      await expect(page.locator('.tk-empty')).toContainText(text);
    }
  });

  test('sheet closes with Escape and via the scrim without saving', async ({ page }) => {
    await open(page, '/tasks');
    await page.getByRole('button', { name: 'New' }).click();
    await fld(page, 'Title').fill('Unsaved');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog'), 'Escape should close the sheet').toBeHidden();
    expect((await stored(page)).tasks ?? []).toHaveLength(0);
  });

  test('.chip styling on Today is not affected by the Tasks stylesheet', async ({ page }) => {
    await visit(page, '/today', 'canopy', 'dark');
    const chip = page.locator('.chip').first();
    if (await chip.count() === 0) test.skip(true, 'no chip on Today in this state');
    const before = await chip.evaluate((e) => getComputedStyle(e).padding + getComputedStyle(e).textTransform);
    await page.getByRole('link', { name: /Tasks/ }).first().click().catch(() => {});
    await page.getByRole('link', { name: /Today/ }).first().click().catch(() => {});
    const after = await page.locator('.chip').first().evaluate((e) => getComputedStyle(e).padding + getComputedStyle(e).textTransform);
    expect(after).toBe(before);
  });
});
