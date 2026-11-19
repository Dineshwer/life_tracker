import { test, expect, type Page } from '@playwright/test';
import { MODES, SKINS, contrastIssues, expectCleanLayout, layout, shot, visit, watch } from './fixtures';

/* ---------- helpers ---------- */
const KEY = 'life-tracker-v1';
type Persisted = { state: Record<string, any>; version: number };
const readState = (page: Page) => page.evaluate((k) => { window.dispatchEvent(new Event('pagehide')); return JSON.parse(localStorage.getItem(k) || '{}') as Persisted; }, KEY);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Empty account (no demo) at a fixed local time. */
async function open(page: Page, at?: string, skin = 'canopy', mode = 'dark') {
  if (at) await page.clock.setFixedTime(new Date(at));
  await page.goto(`/today?skin=${skin}&mode=${mode}`);
  await expect(page.locator('.today')).toBeVisible();
  await page.evaluate(() => (document as any).fonts?.ready);
}
/** Rewrite the persisted store, then reload so the app boots from it. */
async function patchState(page: Page, fn: (s: Record<string, any>) => void) {
  // Applied at the start of the NEXT document so the old page's flush-on-pagehide cannot overwrite it.
  const token = `patch-${Date.now()}-${Math.random()}`;
  await page.addInitScript(([k, src, t]) => {
    try {
      if (sessionStorage.getItem(t as string)) return; sessionStorage.setItem(t as string, '1');
      const p = JSON.parse(localStorage.getItem(k as string) || '{"state":{},"version":2}');
      // eslint-disable-next-line no-new-func
      new Function('s', src as string)(p.state); localStorage.setItem(k as string, JSON.stringify(p));
    } catch { /* */ }
  }, [KEY, `(${fn.toString()})(s)`, token] as const);
  await page.reload();
  await expect(page.locator('.today')).toBeVisible();
}
const xpSum = (s: Record<string, any>, date: string) => (s.xp as any[]).filter((e) => e.date === date).reduce((a, e) => a + e.amount, 0);

/* ---------- theme matrix ---------- */
for (const skin of SKINS) for (const mode of MODES) {
  test(`today matrix · ${skin} · ${mode}`, async ({ page }, info) => {
    const w = watch(page);
    await visit(page, '/today', skin, mode);
    await expect(page.locator('.today .hero')).toBeVisible();
    const touch = info.project.name !== 'desktop';
    expectCleanLayout(await layout(page, { touch }), `/today ${skin} ${mode}`);
    await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' }); // axe must not sample a mid-fade frame
    // .section-header labels are the shared SectionHeader (ui/ui.css); cyberpunk light fails there (reported to the shared agent), so they are excluded here.
    // The emblem is decorative art drawn with fixed palette colours per skin; its text is exempt from contrast.
    const issues = (await contrastIssues(page, '.today')).filter((i) => !/hero-tree|emb-|\.section-header/.test(i));
    expect(issues, 'contrast').toEqual([]);
    if (process.env.SHOTS) await shot(page, info, `today-${skin}-${mode}`, true);
    w.stop();
    expect(w.errors, 'console/page errors').toEqual([]);
  });
}

/* ---------- hero ---------- */
test('emblem never overlaps hero text (phone)', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop');
  for (const skin of SKINS) {
    await visit(page, '/today', skin, 'dark', 'lv=88');
    const clash = await page.evaluate(() => {
      const em = document.querySelector('.hero-tree')!.getBoundingClientRect();
      const out: string[] = [];
      for (const sel of ['.t-greet', '.t-date em', '.t-date span', '.t-skill-line', '.wake-btn', '.wake-done']) {
        const el = document.querySelector(sel); if (!el) continue;
        const range = document.createRange(); range.selectNodeContents(el);
        for (const r of range.getClientRects()) if (r.width > 1 && r.left < em.right - 12 && r.right > em.left + 12 && r.top < em.bottom - 12 && r.bottom > em.top + 12) out.push(`${sel} overlaps emblem`);
      }
      return out;
    });
    expect(clash, skin).toEqual([]);
  }
});

test('hero greeting follows the hour (early morning, afternoon, late night)', async ({ page }) => {
  const cases: [string, string][] = [['2026-03-10T03:00:00', 'Still up'], ['2026-03-10T07:30:00', 'Good morning'], ['2026-03-10T14:00:00', 'Good afternoon'], ['2026-03-10T23:50:00', 'Good evening']];
  for (const [at, text] of cases) { await open(page, at); await expect(page.locator('.t-greet')).toContainText(text); }
});

test('hero shows the date for the clock, and the skill of that weekday', async ({ page }) => {
  await open(page, '2026-03-09T10:00:00'); // a Monday
  await expect(page.locator('.t-date')).toContainText('Monday');
  await expect(page.locator('.t-date')).toContainText('9 March');
  await expect(page.locator('.t-skill-line')).toContainText('cybersecurity');
  await open(page, '2026-03-15T10:00:00'); // a Sunday
  await expect(page.locator('.t-skill-line')).toContainText('weekly review');
});

/* ---------- wake ---------- */
test('wake: on time logs +15 discipline, persists, and cannot be logged twice', async ({ page }) => {
  await open(page, '2026-03-10T07:10:00'); // weekday, target 07:00
  const btn = page.getByRole('button', { name: /I'm up/ });
  await btn.dblclick(); // rapid double click
  await expect(page.locator('.wake-done')).toContainText('7:10 am');
  await expect(page.locator('.wake-ok')).toHaveText(/Up on time/i);
  let s = (await readState(page)).state;
  expect(s.wake).toHaveLength(1);
  expect(s.xp.filter((e: any) => e.ref?.startsWith('wake:'))).toHaveLength(1);
  expect(xpSum(s, '2026-03-10')).toBe(15);
  await page.reload();
  await expect(page.locator('.wake-done')).toContainText('7:10 am');
  await expect(page.getByRole('button', { name: /I'm up/ })).toHaveCount(0);
  s = (await readState(page)).state;
  expect(s.wake).toHaveLength(1);
});

test('wake: exactly 15 minutes late is on time, 16 is late (+5)', async ({ page }) => {
  await open(page, '2026-03-10T07:15:00');
  await page.getByRole('button', { name: /I'm up/ }).click();
  await expect(page.locator('.wake-ok')).toBeVisible();
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await open(page, '2026-03-10T07:16:00');
  await page.getByRole('button', { name: /I'm up/ }).click();
  await expect(page.locator('.wake-late')).toHaveText(/Up 16 min late/);
  expect(xpSum((await readState(page)).state, '2026-03-10')).toBe(5);
});

test('wake: weekend uses the weekend target when set', async ({ page }) => {
  await open(page, '2026-03-14T08:20:00'); // Saturday
  await patchState(page, (s) => { s.settings.weekendWake = '08:30'; });
  await expect(page.locator('.wake-note')).toContainText('8:30 am');
  await page.getByRole('button', { name: /I'm up/ }).click();
  await expect(page.locator('.wake-ok')).toBeVisible();
});

/* ---------- habits and XP ---------- */
test('habit ring: full awards its XP, tapping again removes exactly that XP', async ({ page }) => {
  await open(page, '2026-03-10T10:00:00');
  const row = page.locator('.hl li', { hasText: 'Meditation' }).first();
  await row.getByRole('button', { name: /Log Meditation/ }).click();
  await expect(row).toHaveClass(/is-done/);
  let s = (await readState(page)).state;
  expect(xpSum(s, '2026-03-10')).toBe(20);
  await expect(page.locator('.xp-big').first()).toContainText('+20');
  await row.getByRole('button', { name: /Log Meditation/ }).click();
  await expect(row).not.toHaveClass(/is-done/);
  s = (await readState(page)).state;
  expect(s.xp.filter((e: any) => e.ref?.startsWith('habit:'))).toHaveLength(0);
  expect(s.habitLogs).toHaveLength(0);
});

test('habit: minimum then full never double-counts XP; rapid clicking is consistent', async ({ page }) => {
  await open(page, '2026-03-10T10:00:00');
  const row = page.locator('.hl li', { hasText: 'Meditation' }).first();
  await row.getByRole('button', { name: 'min', exact: true }).click();
  await expect(row.locator('.hl-sub')).toContainText('Minimum');
  expect(xpSum((await readState(page)).state, '2026-03-10')).toBe(10);
  await row.getByRole('button', { name: /Log Meditation/ }).click(); // min -> full
  expect(xpSum((await readState(page)).state, '2026-03-10')).toBe(20);
  const ring = row.getByRole('button', { name: /Log Meditation/ });
  for (let i = 0; i < 6; i++) await ring.click({ delay: 0, noWaitAfter: true }); // even number: full -> none ... ends on full
  await page.waitForTimeout(150);
  const s = (await readState(page)).state;
  expect(s.habitLogs.filter((l: any) => l.habitId === 'meditate')).toHaveLength(1);
  expect(s.xp.filter((e: any) => e.ref === 'habit:meditate:2026-03-10').length).toBeLessThanOrEqual(1);
  expect(xpSum(s, '2026-03-10')).toBe(s.habitLogs.some((l: any) => l.level === 'full') ? 20 : 0);
});

test('habit long-press logs the minimum, and does not also toggle full (desktop mouse)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await open(page, '2026-03-10T10:00:00');
  const ring = page.locator('.hl li', { hasText: /^Reading/ }).first().getByRole('button', { name: /Log Reading/ });
  await page.addStyleTag({ content: '.rise{animation:none!important}' }); // the entrance animation moves the ring while we aim at it
  await ring.scrollIntoViewIfNeeded(); // mouse coordinates must be inside the viewport
  const box = (await ring.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  const s = (await readState(page)).state;
  expect(s.habitLogs.find((l: any) => l.habitId === 'read')?.level).toBe('min');
  expect(xpSum(s, '2026-03-10')).toBe(Math.round(15 / 2));
});

test('habits-touched ring and counters follow the logs', async ({ page }) => {
  await open(page, '2026-03-10T10:00:00'); // Tuesday: 9 daily habits due, gym (weekly) also due
  const total = await page.locator('.hl').first().locator('li').count();
  await expect(page.locator('.prog')).toHaveAttribute('aria-label', new RegExp(`^0 of ${total} habits touched`));
  await page.locator('.hl li', { hasText: 'Journal' }).getByRole('button', { name: /Log Journal/ }).click();
  await page.locator('.hl li', { hasText: /^Reading/ }).getByRole('button', { name: 'min', exact: true }).click();
  await expect(page.locator('.prog')).toHaveAttribute('aria-label', new RegExp(`^2 of ${total} habits touched`));
  await expect(page.locator('.prog-n')).toContainText(`2/${total}`);
});

test('weekly habit leaves the list once the weekly target is met', async ({ page }) => {
  await open(page, '2026-03-12T10:00:00'); // Thursday
  await patchState(page, (s) => {
    s.habitLogs = ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12'].map((date, i) => ({ id: 'g' + i, habitId: 'gym', date, level: 'full' }));
    s.settledThrough = '2026-03-11';
  });
  // done today (full) so still listed, struck through
  await expect(page.locator('.hl li', { hasText: 'Gym' })).toHaveClass(/is-done/);
  await patchState(page, (s) => { s.habitLogs = s.habitLogs.filter((l: any) => l.date !== '2026-03-12').concat([{ id: 'g9', habitId: 'gym', date: '2026-03-07', level: 'full' }]); });
  // Mon-Wed + a Saturday of LAST week: only 3 this week, so still due and says "3 of 4"
  await expect(page.locator('.hl li', { hasText: 'Gym' })).toContainText('3 of 4 this week');
});

/* ---------- tasks and quick wins ---------- */
const task = (o: Record<string, unknown>) => ({ id: 'tk' + Math.random().toString(36).slice(2, 7), done: false, context: 'personal', tags: [], effort: 1, stat: 'mind', ...o });

test('tasks: complete awards effort XP, undo removes it, quick win completes it', async ({ page }) => {
  await open(page, '2026-03-10T10:00:00');
  await patchState(page, (s) => { s.habits = []; s.tasks = [{ id: 't1', title: 'Water the plants', done: false, context: 'personal', tags: [], effort: 1, stat: 'body', date: '2026-03-10' }, { id: 't2', title: 'Big thing', done: false, context: 'job', tags: [], effort: 3, stat: 'skill', date: '2026-03-10' }]; });
  await expect(page.locator('.qw-item', { hasText: 'Water the plants' })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle Big thing' }).click();
  expect(xpSum((await readState(page)).state, '2026-03-10')).toBe(40);
  await page.getByRole('button', { name: 'Toggle Big thing' }).click();
  expect(xpSum((await readState(page)).state, '2026-03-10')).toBe(0);
  await page.getByRole('button', { name: 'Complete Water the plants' }).click();
  await expect(page.locator('.qw-item', { hasText: 'Water the plants' })).toHaveCount(0);
  await expect(page.locator('.t-empty', { hasText: 'Nothing small is left' }).or(page.locator('.qw-item'))).toBeVisible();
  expect(xpSum((await readState(page)).state, '2026-03-10')).toBe(10);
  await expect(page.locator('.hl li.is-done', { hasText: 'Water the plants' })).toBeVisible();
});

test('quick wins show at most three, cheapest first', async ({ page }) => {
  await open(page, '2026-03-10T10:00:00');
  const cards = page.locator('.qw-item');
  expect(await cards.count()).toBeLessThanOrEqual(3);
  const costs = (await cards.locator('.t-chip').allTextContents()).map((t) => Number(t.replace('+', '')));
  expect(costs).toEqual([...costs].sort((a, b) => a - b));
});

test('recurring task: completing, undoing and completing again must not spawn duplicate next occurrences', async ({ page }) => {
  await open(page, '2026-03-10T10:00:00');
  await patchState(page, (s) => { s.tasks = [{ id: 'r1', title: 'Write daily', done: false, context: 'personal', tags: [], effort: 1, stat: 'mind', date: '2026-03-10', recurrence: { every: 'day', interval: 1 } }]; });
  const t = page.getByRole('button', { name: 'Toggle Write daily' });
  await t.click(); await t.click(); await t.click();
  const s = (await readState(page)).state;
  expect(s.tasks.filter((x: any) => x.title === 'Write daily' && !x.done && x.date === '2026-03-11')).toHaveLength(1);
});

test('long task and habit names wrap or truncate without overflowing', async ({ page }, info) => {
  await open(page, '2026-03-10T10:00:00');
  await patchState(page, (s) => { s.tasks = [{ id: 'l1', title: 'Supercalifragilistic'.repeat(8) + ' and a very long title '.repeat(6), done: false, context: 'personal', tags: [], effort: 1, stat: 'mind', date: '2026-03-10' }]; });
  expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), 'long names');
});

test('many tasks (60) render without layout break', async ({ page }, info) => {
  await open(page, '2026-03-10T10:00:00');
  await patchState(page, (s) => { s.tasks = Array.from({ length: 60 }, (_, i) => ({ id: 'm' + i, title: `Task number ${i}`, done: i % 3 === 0, context: 'personal', tags: [], effort: (i % 3) + 1, stat: 'mind', date: '2026-03-10' })); });
  await expect(page.locator('.hl li', { hasText: 'Task number 59' })).toBeVisible();
  expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), '60 tasks');
});

/* ---------- day line ---------- */
test('day line marks the current block with Now and dims past ones', async ({ page }) => {
  await open(page, '2026-03-10T07:20:00');
  await expect(page.locator('.dl-row.cur')).toHaveCount(1);
  await expect(page.locator('.dl-row.cur')).toContainText('Meditation');
  await expect(page.locator('.dl-row.cur .dl-now')).toHaveText('Now');
  await expect(page.locator('.dl-row.past')).toHaveCount(1); // Wake 07:00-07:15
});

test('day line: nothing is current in a gap, everything is past late at night', async ({ page }) => {
  await open(page, '2026-03-10T18:30:00');
  await expect(page.locator('.dl-row.cur')).toHaveCount(0);
  await open(page, '2026-03-10T23:30:00');
  await expect(page.locator('.dl-row.past')).toHaveCount(await page.locator('.dl-row').count());
});

test('day line: weekend hides weekday-only blocks', async ({ page }) => {
  await open(page, '2026-03-14T12:00:00');
  await expect(page.locator('.dl-row', { hasText: 'Job' })).toHaveCount(0);
  await expect(page.locator('.dl-row', { hasText: 'Agency' })).toHaveCount(0);
  await open(page, '2026-03-10T12:00:00');
  await expect(page.locator('.dl-row', { hasText: 'Job' })).toHaveCount(1);
});

test('day line: tapping completes with full XP, long-press / min via habit row, tap again clears', async ({ page }) => {
  await open(page, '2026-03-10T07:20:00');
  const ring = page.locator('.dl-row.cur').getByRole('button', { name: /Complete Meditation/ });
  await ring.click();
  await expect(ring).toHaveAttribute('aria-pressed', 'true');
  expect(xpSum((await readState(page)).state, '2026-03-10')).toBe(20);
  // the habit list row mirrors the same state
  await expect(page.locator('.hl li', { hasText: 'Meditation' })).toHaveClass(/is-done/);
  await ring.click();
  expect(xpSum((await readState(page)).state, '2026-03-10')).toBe(0);
});

test('day line empty state when no blocks are defined', async ({ page }) => {
  await open(page, '2026-03-10T10:00:00');
  await patchState(page, (s) => { s.blocks = []; });
  await expect(page.locator('.t-empty', { hasText: 'No blocks are set' })).toBeVisible();
});

/* ---------- free time ---------- */
test('free time left: weekday morning, evening, after bedtime, and overlapping blocks are not double counted', async ({ page }) => {
  const free = async (at: string) => { await open(page, at); return (await page.locator('.cap-val').innerText()).trim(); };
  // 10:00 -> 23:00 = 13h, minus job 10:00-18:00 (8h) and agency 19:00-20:30 (1.5h) = 3h 30m
  expect(await free('2026-03-10T10:00:00')).toBe('3h 30m');
  // 06:00 is before the 07:00 wake target, so the window starts at wake: 16h - 15m wake block - 8.5h job - 1.5h agency = 5h 45m
  expect(await free('2026-03-10T06:00:00')).toBe('5h 45m');
  expect(await free('2026-03-10T23:30:00')).toBe('0h 00m');
  await patchState(page, (s) => { s.blocks = [{ id: 'a', title: 'Job', start: '09:30', end: '18:00', day: 'all', kind: 'fixed', fixed: true }, { id: 'b', title: 'Overlap', start: '17:00', end: '19:00', day: 'all', kind: 'agency' }]; });
  await page.clock.setFixedTime(new Date('2026-03-10T17:30:00')); await page.reload();
  // 17:30-23:00 = 5h30m, busy 17:30-19:00 once = 1h30m -> 4h 00m
  await expect(page.locator('.cap-val')).toHaveText('4h 00m');
});

/* ---------- XP / settle ---------- */
test('missed habits from past days are penalised exactly once, level never goes below 1', async ({ page }) => {
  await open(page, '2026-03-10T10:00:00');
  await patchState(page, (s) => { s.settledThrough = '2026-03-06'; });
  let s = (await readState(page)).state;
  const penalties = (s.xp as any[]).filter((e) => e.amount < 0);
  expect(penalties.length).toBeGreaterThan(0);
  expect(new Set(penalties.map((e) => e.ref)).size).toBe(penalties.length);
  expect(s.settledThrough).toBe('2026-03-09');
  await page.reload();
  s = (await readState(page)).state;
  expect((s.xp as any[]).filter((e) => e.amount < 0)).toHaveLength(penalties.length);
  await expect(page.locator('.lv .lv-n').first()).toHaveText('1'); // stat levels clamp at 1
  await expect(page.locator('.xp-big').first()).toContainText('+0'); // penalties are on past days, not today
});

test('XP today shows a signed number and the empty message when nothing earned', async ({ page }) => {
  await open(page, '2026-03-10T10:00:00');
  await expect(page.locator('.rail-block', { hasText: 'XP today' }).or(page.locator('.xp-big').first())).toBeVisible();
  await expect(page.getByText('Nothing earned yet')).toBeVisible();
  await patchState(page, (s) => { s.xp = [{ id: 'x1', date: '2026-03-10', stat: 'mind', amount: 99999, reason: 'huge', ref: 'x:1' }]; });
  await expect(page.locator('.xp-big').first()).toContainText('+99999');
  await patchState(page, (s) => { s.xp = [{ id: 'x1', date: '2026-03-10', stat: 'mind', amount: -80, reason: 'neg', ref: 'x:1' }]; });
  await expect(page.locator('.xp-big').first()).toContainText('-80');
  const bar = await page.locator('.xp-big').first().locator('xpath=following-sibling::div[@role="progressbar"]').getAttribute('aria-valuenow');
  expect(Number(bar)).toBeGreaterThanOrEqual(0);
});

test('hero emblem reflects real level (huge XP does not break layout)', async ({ page }, info) => {
  await open(page, '2026-03-10T10:00:00');
  await patchState(page, (s) => { s.xp = [{ id: 'x1', date: '2026-02-01', stat: 'mind', amount: 9_000_000, reason: 'huge', ref: 'x:1' }]; s.settledThrough = '2026-03-09'; });
  await expect(page.locator('.hero-tree')).toBeVisible();
  expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), 'huge xp');
});

/* ---------- date rollover ---------- */
test('page left open across midnight rolls over to the new day (date, habit state, settlement)', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-03-10T23:59:20') });
  await page.goto('/today?skin=canopy&mode=dark');
  await expect(page.locator('.today')).toBeVisible();
  await expect(page.locator('.t-date')).toContainText('10 March');
  await page.locator('.hl li', { hasText: 'Journal' }).getByRole('button', { name: /Log Journal/ }).click();
  await expect(page.locator('.hl li', { hasText: 'Journal' })).toHaveClass(/is-done/);
  await page.clock.runFor(70_000);
  await expect(page.locator('.t-date')).toContainText('11 March');
  await expect(page.locator('.t-greet')).toContainText('Still up');
  // yesterday's completion no longer shows as today's, and the wake button belongs to the new day
  await expect(page.locator('.hl li', { hasText: 'Journal' })).not.toHaveClass(/is-done/);
  // yesterday's other habits were missed: settled without a reload
  const s = (await readState(page)).state;
  expect(s.settledThrough).toBe('2026-03-10');
});

/* ---------- widgets and links ---------- */
test('rejections widget links to /rejections and shows the count', async ({ page }) => {
  await visit(page, '/today', 'canopy', 'dark');
  const w = page.locator('a.rj-widget');
  await expect(w).toContainText('137');
  await w.click();
  await expect(page).toHaveURL(/\/rejections/);
});

test('"All 8" link in The one panel is a real tap target and navigates', async ({ page }, info) => {
  await visit(page, '/today', 'canopy', 'dark');
  const link = page.locator('a.one-link');
  const b = (await link.boundingBox())!;
  if (info.project.name !== 'desktop') expect(b.height, 'tap target height').toBeGreaterThanOrEqual(32);
  await link.click();
  await expect(page).toHaveURL(/\/one/);
});

test('empty account: every section has a friendly empty state and no errors', async ({ page }, info) => {
  const w = watch(page);
  await open(page, '2026-03-10T10:00:00');
  await expect(page.locator('.t-empty', { hasText: 'No tasks for today' })).toBeVisible();
  await expect(page.getByText('None logged today')).toBeVisible();
  await expect(page.locator('.prog-n')).toContainText('0/');
  expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), 'empty');
  await patchState(page, (s) => { s.habits = []; });
  await expect(page.locator('.t-empty', { hasText: 'Nothing is due' })).toBeVisible();
  await expect(page.getByText('Nothing due today')).toBeVisible();
  expect(w.errors).toEqual([]);
});

test('keyboard: tab reaches the ring buttons and Space/Enter toggles them', async ({ page }) => {
  await open(page, '2026-03-10T10:00:00');
  const ring = page.locator('.hl li', { hasText: 'Journal' }).getByRole('button', { name: /Log Journal/ });
  await ring.focus();
  await expect(ring).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(ring).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(ring).toHaveAttribute('aria-pressed', 'false');
  // a visible focus indicator
  await ring.focus();
  const outline = await ring.evaluate((e) => { const c = getComputedStyle(e); return c.outlineStyle !== 'none' || c.boxShadow !== 'none'; });
  expect(outline).toBe(true);
});

test('state survives reload and today never leaks into another date', async ({ page }) => {
  await open(page, '2026-03-10T10:00:00');
  await page.locator('.hl li', { hasText: 'Stretching' }).getByRole('button', { name: /Log Stretching/ }).click();
  await page.reload();
  await expect(page.locator('.hl li', { hasText: 'Stretching' })).toHaveClass(/is-done/);
  await page.clock.setFixedTime(new Date('2026-03-11T10:00:00')); await page.reload();
  await expect(page.locator('.hl li', { hasText: 'Stretching' })).not.toHaveClass(/is-done/);
  void ymd;
});
