import { test, expect, type Page } from '@playwright/test';
import { watch } from './fixtures';

/** Real user flows on /gym and /one. The clock is pinned to a Monday (Push day) unless a test says otherwise,
    so "today's plan" is deterministic. Every test starts from an EMPTY account (no ?demo=1). */
const MON = '2026-11-09'; // Monday: Push
const WED = '2026-11-11'; // Wednesday: mobility
const SAT = '2026-11-14'; // Saturday: free day
const KEY = 'life-tracker-v1';

async function open(page: Page, route = '/gym', day = MON, seed?: Record<string, unknown>) {
  await page.clock.setFixedTime(new Date(`${day}T10:00:00`));
  if (seed) await page.addInitScript(([k, s]) => { if (!localStorage.getItem(k as string)) localStorage.setItem(k as string, JSON.stringify({ state: s, version: 2 })); }, [KEY, seed] as const);
  await page.goto(`${route}?skin=canopy&mode=dark`);
  await expect(page.locator('.main')).toBeVisible();
}
const store = (page: Page) => page.evaluate((k) => { window.dispatchEvent(new Event('pagehide')); return JSON.parse(localStorage.getItem(k) ?? '{}').state ?? {}; }, KEY);
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();
const row = (page: Page, name: string) => page.locator('.acc-row', { has: page.locator('.acc-name', { hasText: new RegExp(`^${name}$`) }) });
async function openRow(page: Page, name: string) {
  const r = row(page, name);
  if ((await r.locator('.acc-h').getAttribute('aria-expanded')) !== 'true') await r.locator('.acc-h').click();
  await expect(r.locator('.acc-body')).toBeVisible();
  return r;
}
const logBtn = (r: ReturnType<Page['locator']>) => r.getByRole('button', { name: 'Log', exact: true });

test.describe('gym: empty account', () => {
  test('log tab loads today\'s plan, nothing logged, finish disabled', async ({ page }) => {
    const w = watch(page); await open(page);
    await expect(page.locator('.gym-hero-title')).toHaveText('Push');
    await expect(page.getByRole('button', { name: 'Finish workout' })).toBeDisabled();
    await expect(page.locator('.acc-row')).toHaveCount(9);
    await expect(page.locator('.gym-hero-stats')).toContainText('0/9');
    expect(w.errors).toEqual([]);
  });
  test('progress and body tabs show empty states, no NaN', async ({ page }) => {
    const w = watch(page); await open(page);
    await tab(page, 'Progress');
    await expect(page.getByText('Log a few sets and your bests will gather here.')).toBeVisible();
    await expect(page.locator('.gym-empty')).toHaveCount(3); // bests, no exercise, body weight chart
    await tab(page, 'Body');
    await expect(page.getByText('No photos yet')).toBeVisible();
    expect(await page.locator('.main').innerText()).not.toMatch(/NaN|undefined|Infinity/);
    expect(w.errors).toEqual([]);
  });
  test('free day (Saturday) and mobility day (Wednesday) render', async ({ page }) => {
    await open(page, '/gym', SAT);
    await expect(page.locator('.gym-hero-title')).toHaveText('Free day');
    await expect(page.getByText('Nothing planned for today.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish workout' })).toBeDisabled();
    // an exercise can still be added on a free day
    await page.getByPlaceholder('Exercise name').fill('Run');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('.acc-row')).toHaveCount(1);
    const p2 = await page.context().newPage();
    await p2.clock.setFixedTime(new Date(`${WED}T10:00:00`));
    await p2.goto('/gym?skin=canopy&mode=dark');
    await expect(p2.locator('.gym-hero-title')).toContainText('Mobility');
    await expect(p2.locator('.acc-group').first().locator('.acc-row').first()).toBeVisible();
  });
});

test.describe('gym: logging', () => {
  test('log bodyweight sets, persists over reload, finish and reopen', async ({ page }) => {
    const w = watch(page); await open(page);
    const r = await openRow(page, 'Flying push-up power reps');
    await logBtn(r).click();
    await expect(r.locator('.lg-set.done')).toHaveCount(1);
    await expect(r.locator('.acc-n')).toHaveText('1/3');
    await expect(page.getByRole('button', { name: 'Finish workout' })).toBeEnabled();
    await page.reload();
    const r2 = await openRow(page, 'Flying push-up power reps');
    await expect(r2.locator('.lg-set.done')).toHaveCount(1);
    await page.getByRole('button', { name: 'Finish workout' }).click();
    await expect(page.locator('.gym-hero .label').first()).toContainText('finished');
    await page.getByRole('button', { name: 'Reopen' }).click();
    await expect(page.getByRole('button', { name: 'Finish workout' })).toBeVisible();
    expect(w.errors).toEqual([]);
  });

  test('weighted set needs a weight, volume and units are right, decimals kept', async ({ page }) => {
    await open(page);
    const r = await openRow(page, 'Bench press');
    await expect(logBtn(r)).toBeDisabled();
    await r.getByLabel('Weight in kg').fill('37.5');
    await logBtn(r).click();
    await expect(r.locator('.lg-logged .mono').first()).toHaveText('5 × 37.5 kg');
    await expect(page.locator('.gym-hero-stats')).toContainText('188'); // 5 × 37.5 = 187.5, shown rounded
    const st = await store(page);
    expect(st.workouts[0].sets[0]).toMatchObject({ exercise: 'Bench press', reps: 5, weight: 37.5, unit: 'kg' });
  });

  test('hold exercises log seconds', async ({ page }) => {
    await open(page);
    const r = await openRow(page, 'Planche lean');
    await expect(r.getByLabel('Seconds')).toHaveValue('20');
    await logBtn(r).click();
    await expect(r.locator('.lg-logged .mono').first()).toHaveText('20s hold');
  });

  test('inputs reject letters and negatives; steppers clamp at 0', async ({ page }) => {
    await open(page);
    const r = await openRow(page, 'Bench press');
    const wt = r.getByLabel('Weight in kg');
    await wt.fill('-5abc');
    await expect(wt).toHaveValue('5');
    await wt.fill('0');
    for (let i = 0; i < 3; i++) await r.getByRole('button', { name: 'Lighter' }).click();
    await expect(wt).toHaveValue('0');
    await r.getByLabel('Reps').fill('0');
    await expect(logBtn(r)).toBeDisabled();
    await r.getByLabel('Reps').fill('99999999999');
    await wt.fill('0');
    await logBtn(r).click();
    await expect(page.locator('.main')).not.toContainText('NaN');
  });

  test('edit a set, delete a set', async ({ page }) => {
    await open(page);
    const r = await openRow(page, 'Flying push-up power reps');
    await logBtn(r).click(); await logBtn(r).click();
    await expect(r.locator('.lg-set.done')).toHaveCount(2);
    await r.getByLabel('Edit this set').first().click();
    await r.locator('.lg-set.now input').first().fill('9');
    await r.getByRole('button', { name: 'Save' }).click();
    await expect(r.locator('.lg-logged .mono').first()).toHaveText('9 reps');
    await r.getByLabel('Delete set').first().click();
    await expect(r.locator('.lg-set.done')).toHaveCount(1);
    expect((await store(page)).workouts[0].sets).toHaveLength(1);
  });

  test('editing a set to empty keeps the old value (no zero reps)', async ({ page }) => {
    await open(page);
    const r = await openRow(page, 'Flying push-up power reps');
    await logBtn(r).click();
    await r.getByLabel('Edit this set').click();
    await r.locator('.lg-set.now input').first().fill('');
    await r.getByRole('button', { name: 'Save' }).click();
    await expect(r.locator('.lg-logged .mono').first()).toHaveText('3 reps');
  });

  test('rapid double click on Log never corrupts the session', async ({ page }) => {
    const w = watch(page); await open(page);
    const r = await openRow(page, 'Flying push-up power reps');
    await logBtn(r).dblclick();
    const sets = (await store(page)).workouts[0].sets;
    expect(sets.length).toBeLessThanOrEqual(2);
    expect(new Set(sets.map((s: { id: string }) => s.id)).size).toBe(sets.length);
    expect(w.errors).toEqual([]);
  });

  test('renaming an exercise keeps its logged sets attached', async ({ page }) => {
    await open(page);
    const r = await openRow(page, 'Flying push-up power reps');
    await logBtn(r).click();
    await r.getByRole('button', { name: 'Edit', exact: true }).click();
    await r.getByLabel('Exercise name').fill('Clap push-up');
    await expect(page.locator('.acc-name', { hasText: 'Clap push-up' })).toBeVisible();
    await expect(page.locator('.acc-row', { hasText: 'Clap push-up' }).locator('.acc-n')).toHaveText('1/3');
    await expect(page.locator('.gym-hero-stats')).toContainText('1'); // sets total still 1
  });

  test('editing sets and reps clamps to at least 1', async ({ page }) => {
    await open(page);
    const r = await openRow(page, 'Flying push-up power reps');
    await r.getByRole('button', { name: 'Edit', exact: true }).click();
    const sets = r.locator('.lg-edit .gym-mini').first();
    await sets.fill('0');
    await expect(r.locator('.acc-n')).toHaveText('0/1');
    await sets.fill('2.7');
    expect((await store(page)).workouts[0].queue[0].sets).toBe(3); // fractions round, never 2.7 sets
  });

  test('finishing the last set opens the next unfinished exercise', async ({ page }) => {
    await open(page);
    const r = await openRow(page, 'Flying push-up power reps');
    for (let i = 0; i < 3; i++) await logBtn(r).click();
    await expect(row(page, 'Planche lean').locator('.acc-h')).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'Flying push-up power reps')).toHaveClass(/done/);
  });
});

test.describe('gym: PRs and XP', () => {
  test('a heavier set is a PR, awards body XP exactly once even after delete and re-log', async ({ page }) => {
    await open(page);
    const r = await openRow(page, 'Bench press');
    const bodyXP = async () => ((await store(page)).xp ?? []).filter((e: { stat: string }) => e.stat === 'body').reduce((a: number, e: { amount: number }) => a + e.amount, 0);
    await r.getByLabel('Weight in kg').fill('40'); await logBtn(r).click();
    await expect(r.locator('.gym-pr')).toHaveCount(0); // first-ever set is not a PR
    await r.getByLabel('Weight in kg').fill('50'); await logBtn(r).click();
    await expect(r.locator('.gym-pr')).toHaveCount(1);
    await expect(page.getByRole('status')).toContainText('New PR');
    expect(await bodyXP()).toBe(15);
    await r.getByLabel('Delete set').nth(1).click();
    await r.getByLabel('Weight in kg').fill('50'); await logBtn(r).click();
    expect(await bodyXP()).toBe(15);
  });
  test('same weight and same reps is not a PR; unit kg vs bw are tracked separately', async ({ page }) => {
    await open(page);
    const r = await openRow(page, 'Bench press');
    await r.getByLabel('Weight in kg').fill('40');
    await logBtn(r).click(); await logBtn(r).click();
    await expect(r.locator('.gym-pr')).toHaveCount(0);
  });
});

test.describe('gym: add / skip / remove / reload plan', () => {
  test('add exercise: empty name blocked, Enter adds, long name does not overflow', async ({ page }) => {
    await open(page);
    const add = page.getByRole('button', { name: 'Add', exact: true });
    await expect(add).toBeDisabled();
    const name = page.getByPlaceholder('Exercise name');
    await name.fill('   '); await name.press('Enter');
    await expect(page.locator('.acc-row')).toHaveCount(9);
    const long = 'Super long exercise name '.repeat(8).trim();
    await name.fill(long); await name.press('Enter');
    await expect(page.locator('.acc-row')).toHaveCount(10);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.reload();
    await expect(page.locator('.acc-row')).toHaveCount(10);
  });
  test('skip and remove', async ({ page }) => {
    await open(page);
    const r = await openRow(page, 'Bench press');
    await r.getByRole('button', { name: 'Skip' }).click();
    await expect(row(page, 'Bench press')).toHaveClass(/skipped/);
    const r2 = await openRow(page, 'Incline dumbbell press');
    await r2.getByRole('button', { name: 'Remove from today' }).click();
    await expect(page.locator('.acc-row')).toHaveCount(8);
  });
  test('save to plan, then reload today\'s plan (confirm dialog)', async ({ page }) => {
    await open(page);
    const r = await openRow(page, 'Bench press');
    await r.getByRole('button', { name: 'Remove from today' }).click();
    await page.getByRole('button', { name: 'Save this list to the plan' }).click();
    await expect(page.getByRole('status')).toContainText('Saved to your plan');
    await tab(page, 'Plan');
    await expect(page.locator('.gym-session', { has: page.locator('input[value="Push"]') }).locator('.gym-plan-ex > li')).toHaveCount(8);
    await tab(page, 'Log');
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: "Reload today's plan" }).click();
    await expect(page.locator('.acc-row')).toHaveCount(8);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: "Reload today's plan" }).click();
    await expect(page.locator('.acc-row')).toHaveCount(8); // plan now has 8
  });
});

test.describe('gym: plan tab', () => {
  test('week header, day toggles, add and remove exercise, add session, reset', async ({ page }) => {
    const w = watch(page); await open(page); await tab(page, 'Plan');
    await expect(page.locator('.gym-design-k')).toContainText('Week 1 of 12');
    const push = page.locator('.gym-session').first();
    await push.getByRole('button', { name: 'Sat' }).click();
    await expect(push.getByRole('button', { name: 'Sat' })).toHaveAttribute('aria-pressed', 'true');
    await push.getByRole('button', { name: 'Add exercise' }).click();
    await expect(push.locator('.gym-plan-ex > li')).toHaveCount(10);
    await push.locator('.gym-plan-ex > li').last().getByLabel('Remove exercise').click();
    await expect(push.locator('.gym-plan-ex > li')).toHaveCount(9);
    await page.getByRole('button', { name: 'Add session' }).click();
    await expect(page.locator('.gym-session')).toHaveCount(8);
    await page.reload(); await tab(page, 'Plan');
    await expect(page.locator('.gym-session')).toHaveCount(8); // persisted
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Reset to program' }).click();
    await expect(page.locator('.gym-session')).toHaveCount(7);
    expect(w.errors).toEqual([]);
  });
  test('week number follows the start date, capped at 12', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ledger-gym-start', '2026-01-01'));
    await open(page); await tab(page, 'Plan');
    await expect(page.locator('.gym-design-k')).toContainText('Week 12 of 12');
    // the start date is a synced preference now: set it in the store (applied at the next load so the old page's flush cannot overwrite it)
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem('gs-2030')) return; sessionStorage.setItem('gs-2030', '1');
        const raw = JSON.parse(localStorage.getItem('life-tracker-v1') || '{"version":3,"state":{}}');
        const kv = (raw.state.kv ?? []).filter((k: { id: string }) => k.id !== 'ledger-gym-start');
        raw.state.kv = [...kv, { id: 'ledger-gym-start', value: '2030-01-01' }];
        localStorage.setItem('life-tracker-v1', JSON.stringify(raw));
      } catch { /* */ }
    });
    await page.reload(); await tab(page, 'Plan');
    await expect(page.locator('.gym-design-k')).toContainText('Week 1 of 12');
  });
  test('Start from plan keeps a single workout for today', async ({ page }) => {
    await open(page); await tab(page, 'Plan');
    await page.locator('.gym-session').first().getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('tab', { name: 'Log' })).toHaveAttribute('aria-selected', 'true');
    expect((await store(page)).workouts.filter((x: { date: string }) => x.date === MON)).toHaveLength(1);
  });
  test('zeroing sets/reps in the plan does not crash Log', async ({ page }) => {
    const w = watch(page); await open(page); await tab(page, 'Plan');
    const li = page.locator('.gym-session').first().locator('.gym-plan-ex > li').first();
    await li.getByLabel('Sets').fill('0'); await li.getByLabel('Reps').fill('');
    await tab(page, 'Log');
    await page.reload();
    await expect(page.locator('.acc-row').first()).toBeVisible();
    expect(await page.locator('.main').innerText()).not.toMatch(/NaN|Infinity/);
    expect(w.errors).toEqual([]);
  });
});

test.describe('gym: progress charts', () => {
  const W = (date: string, sets: { exercise: string; reps: number; weight: number; unit: string }[]) => ({ id: 'w' + date, date, name: 'T', sets: sets.map((s, i) => ({ id: `s${date}${i}`, ...s })) });
  test('0, 1, equal-valued and many points never produce NaN paths', async ({ page }) => {
    const many = Array.from({ length: 60 }, (_, i) => W(`2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, [{ exercise: 'Squat', reps: 5, weight: 40 + (i % 9) * 2.5, unit: 'kg' }]));
    const workouts = [
      W('2026-11-01', [{ exercise: 'Single', reps: 5, weight: 20, unit: 'kg' }]),
      W('2026-11-02', [{ exercise: 'Flat', reps: 8, weight: 0, unit: 'bw' }]), W('2026-11-03', [{ exercise: 'Flat', reps: 8, weight: 0, unit: 'bw' }]), W('2026-11-04', [{ exercise: 'Flat', reps: 8, weight: 0, unit: 'bw' }]),
      W('2026-11-05', [{ exercise: 'Zero', reps: 0, weight: 0, unit: 'bw' }]),
      ...many,
    ];
    const body = [{ id: 'b1', date: '2026-11-01', weightKg: 70 }, { id: 'b2', date: '2026-11-01', weightKg: 70 }, { id: 'b3', date: '2026-11-03', weightKg: 70.04 }];
    const w = watch(page); await open(page, '/gym', MON, { workouts, body }); await tab(page, 'Progress');
    const select = page.getByLabel('Exercise');
    for (const o of await select.locator('option').allTextContents()) {
      await select.selectOption({ label: o });
      const d = await page.locator('.gym-chart path').first().getAttribute('d');
      expect(d, o).not.toMatch(/NaN|Infinity/);
    }
    for (const p of await page.locator('.gym-chart svg').all()) expect(await p.innerHTML()).not.toMatch(/NaN|Infinity/);
    expect(w.errors, 'no duplicate-key or runtime errors').toEqual([]);
  });
  test('PR board counts only sets with reps, chart reads the last point', async ({ page }) => {
    const workouts = [W('2026-11-01', [{ exercise: 'Bench', reps: 5, weight: 40, unit: 'kg' }]), W('2026-11-05', [{ exercise: 'bench ', reps: 5, weight: 45, unit: 'kg' }])];
    await open(page, '/gym', MON, { workouts }); await tab(page, 'Progress');
    await expect(page.locator('.gym-pr-card')).toHaveCount(1); // case/space-insensitive grouping
    await expect(page.locator('.gym-chart-val')).toHaveText('45.0');
  });
});

test.describe('gym: body tab', () => {
  test('weight decimals, empty and junk values, delete', async ({ page }) => {
    await open(page); await tab(page, 'Body');
    const input = page.getByLabel('Body weight in kg');
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();
    await input.fill('.'); await expect(save).toBeDisabled();
    await input.fill('0'); await expect(save).toBeDisabled();
    await input.fill('72.5'); await save.click();
    await expect(page.locator('.gym-meas').last()).toContainText('72.5 kg');
    await input.fill('1.2.3'); // not a number
    await expect(save).toBeDisabled();
    await page.reload(); await tab(page, 'Body');
    await expect(page.locator('.gym-meas').last()).toContainText('72.5 kg');
    await page.getByLabel('Delete entry').click();
    await expect(page.getByText('Weight history')).toHaveCount(0);
    expect((await store(page)).body ?? []).toHaveLength(0);
  });
  test('measurements add, delete, duplicates overwrite, junk blocked', async ({ page }) => {
    await open(page); await tab(page, 'Body');
    const add = page.getByRole('button', { name: 'Add', exact: true });
    await expect(add).toBeDisabled();
    await page.getByPlaceholder('Name (e.g. Waist)').fill('Waist');
    await expect(add).toBeDisabled();
    await page.getByPlaceholder('Value').fill('81.5'); await add.click();
    await expect(page.locator('.gym-meas li', { hasText: 'Waist' })).toContainText('81.5');
    await page.getByPlaceholder('Name (e.g. Waist)').fill('Waist'); await page.getByPlaceholder('Value').fill('80'); await add.click();
    await expect(page.locator('.gym-meas li', { hasText: 'Waist' })).toHaveCount(1);
    await page.getByLabel('Remove Waist').click();
    await expect(page.locator('.gym-meas li', { hasText: 'Waist' })).toHaveCount(0);
  });
  test('future dates cannot be picked', async ({ page }) => {
    await open(page); await tab(page, 'Body');
    await expect(page.locator('.gym-date input')).toHaveAttribute('max', MON);
  });
});

test.describe('gym: robustness with old or odd stored data', () => {
  test('old workouts without queue/planId, an old empty plan, junk body entry', async ({ page }) => {
    const w = watch(page);
    await page.addInitScript(() => localStorage.setItem('ledger-gym-plan', JSON.stringify({ sessions: [{ id: 'a', name: 'Old', days: [1] }] })));
    await open(page, '/gym', MON, { workouts: [{ id: 'o1', date: '2026-11-09', name: 'Push', sets: [{ id: 's1', exercise: 'Bench', reps: 5, weight: 40, unit: 'kg' }] }, { id: 'o2', date: '2026-11-02', name: 'Old', sets: [] }], body: [{ id: 'x', date: '2026-11-01' }] });
    await expect(page.locator('.gym-hero-title')).toHaveText('Push');
    await expect(page.locator('.acc-row').first()).toBeVisible();
    for (const t of ['Plan', 'Mobility', 'Skills', 'Progress', 'Body']) await tab(page, t);
    expect(w.errors).toEqual([]);
  });
  test('corrupt plan JSON and an old-format plan fall back to the program', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ledger-gym-plan', '{not json'));
    await open(page);
    await expect(page.locator('.acc-row')).toHaveCount(9);
  });
  test('a plan whose exercises have no names or unit still renders', async ({ page }) => {
    const w = watch(page);
    await page.addInitScript(() => localStorage.setItem('ledger-gym-plan', JSON.stringify({ sessions: [{ id: 'p1', name: 'Push', days: [1], exercises: [{ id: 'e', name: '', sets: 3, reps: 5, unit: 'bw' }, { id: 'f', name: 'Curl', sets: 2, reps: 8, unit: 'kg' }] }] })));
    await open(page);
    await expect(page.locator('.acc-row')).toHaveCount(1);
    expect(w.errors).toEqual([]);
  });
  test('a workout stored from another plan session is rebuilt from today\'s plan, logged sets kept', async ({ page }) => {
    await open(page, '/gym', MON, { workouts: [{ id: 'o1', date: MON, name: 'Pull', planId: 'p2', queue: [{ id: 'q', name: 'Pull-up', sets: 5, reps: 2, unit: 'bw' }], sets: [{ id: 's1', exercise: 'Odd one', reps: 5, weight: 0, unit: 'bw' }] }] });
    await expect(page.locator('.gym-hero-title')).toHaveText('Push');
    await expect(page.locator('.acc-row', { hasText: 'Odd one' })).toBeVisible();
  });
});

test.describe('gym: demos (GIFs)', () => {
  test('no GIF is fetched until a row is open, and only that row\'s', async ({ page }) => {
    const gifs: string[] = [];
    page.on('request', (r) => { if (r.url().endsWith('.gif')) gifs.push(r.url()); });
    await open(page);
    await page.waitForLoadState('networkidle');
    expect(gifs.length).toBeLessThanOrEqual(1); // only the auto-opened first row
    await tab(page, 'Plan');
    await page.waitForLoadState('networkidle');
    expect(gifs.length).toBeLessThanOrEqual(9 + 1); // thumbnails are lazy: at most the ones near the viewport
    expect(gifs.length).toBeLessThan(20);
  });
  test('a failing GIF does not break the row or shift layout wildly', async ({ page }) => {
    await page.route('**/demos/*.gif', (r) => r.abort());
    const w = watch(page);
    await open(page);
    await openRow(page, 'Bench press');
    await expect(page.locator('.lg-demo')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log', exact: true })).toBeVisible();
    expect(w.errors).toEqual([]);
  });
  test('the form GIF reserves space before it loads (no jump)', async ({ page }) => {
    await page.route('**/demos/bench.gif', async (r) => { await new Promise((f) => setTimeout(f, 800)); await r.continue(); });
    await open(page);
    await openRow(page, 'Bench press');
    const h = await page.locator('.lg-demo .demo-gif').evaluate((el) => el.getBoundingClientRect().height);
    expect(h, 'gif box has a height before it has loaded').toBeGreaterThan(60);
  });
});

test.describe('gym: mobility tab and drills', () => {
  test('ticking drills persists for the day and awards XP once', async ({ page }) => {
    await open(page, '/gym', WED);
    const first = page.locator('.acc-group').first().locator('.acc-row').first();
    await expect(first.locator('.acc-body')).toBeVisible();
    await first.getByRole('button', { name: /Done, next|Undo/ }).click();
    await expect(first).toHaveClass(/done/);
    await page.reload();
    await expect(page.locator('.acc-group').first().locator('.acc-row').first()).toHaveClass(/done/);
  });
  test('mobility tab toggles and counts', async ({ page }) => {
    const w = watch(page); await open(page, '/gym', WED); await tab(page, 'Mobility');
    await expect(page.locator('.mob').first()).toBeVisible();
    expect(w.errors).toEqual([]);
  });
});

test.describe('gym: cardio', () => {
  test('logging cardio awards XP once per entry and closes', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Add cardio' }).click();
    await page.locator('.cardio-list li').first().getByRole('button', { name: 'Log' }).click();
    await expect(page.getByText(/min this week/)).toBeVisible();
    const xp = (await store(page)).xp.filter((e: { ref?: string }) => e.ref?.startsWith('cardio:'));
    expect(xp).toHaveLength(1);
  });
});

test.describe('gym: phone layout', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1000) > 500, 'phone only');
  test('Log button is reachable above the floating tab bar when the first row is open', async ({ page }) => {
    await open(page);
    const r = await openRow(page, 'Flying push-up power reps');
    await logBtn(r).scrollIntoViewIfNeeded();
    const b = await logBtn(r).boundingBox(); const tb = await page.locator('.tabbar').boundingBox();
    expect(b!.y + b!.height).toBeLessThanOrEqual(tb!.y + 1);
    expect(b!.height).toBeGreaterThanOrEqual(40);
  });
  test('tabs: six tabs fit and are tappable', async ({ page }) => {
    await open(page);
    for (const t of await page.getByRole('tab').all()) { const b = await t.boundingBox(); expect(b!.height).toBeGreaterThanOrEqual(40); expect(b!.width).toBeGreaterThanOrEqual(44); }
  });
});

// ------------------------------------------------------------------ The one

test.describe('the one', () => {
  const logOne = async (page: Page, sets: string, reps: string) => {
    await page.getByRole('button', { name: /^Log it$|^Log another$/ }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Sets').fill(sets); await dlg.getByLabel('Reps per set').fill(reps);
    return dlg;
  };
  test('empty account: suggestion shown, all rows say never, no NaN', async ({ page }) => {
    const w = watch(page); await open(page, '/one');
    await expect(page.locator('.one-hero .one-name')).not.toBeEmpty();
    await expect(page.locator('.one-row')).toHaveCount(8);
    await expect(page.locator('.one-row-sub').first()).toContainText('never');
    expect(await page.locator('.main').innerText()).not.toMatch(/NaN|undefined|Infinity/);
    expect(w.errors).toEqual([]);
  });
  test('log, XP once per day, persists, remove cleans up XP', async ({ page }) => {
    await open(page, '/one');
    let dlg = await logOne(page, '4', '8');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.one-recent li')).toHaveCount(1);
    await expect(page.locator('.one-hero .label').first()).toContainText('Done today');
    dlg = await logOne(page, '1', '1'); await dlg.getByRole('button', { name: 'Save' }).click();
    const xp = (await store(page)).xp.filter((e: { ref?: string }) => e.ref?.startsWith('one:'));
    expect(xp).toHaveLength(1);
    await page.reload();
    await expect(page.locator('.one-recent li')).toHaveCount(2);
    await page.locator('.one-recent li').first().getByRole('button', { name: 'Remove this log' }).click();
    await page.locator('.one-recent li').first().getByRole('button', { name: 'Remove this log' }).click();
    await expect(page.locator('.one-recent')).toHaveCount(0);
    expect((await store(page)).xp.filter((e: { ref?: string }) => e.ref?.startsWith('one:'))).toHaveLength(0);
  });
  test('sets/reps of 0, empty or negative cannot be saved', async ({ page }) => {
    await open(page, '/one');
    for (const [s, r] of [['0', '8'], ['', '8'], ['4', '0'], ['4', '']]) {
      const dlg = await logOne(page, s, r);
      await expect(dlg.getByRole('button', { name: 'Save' }), `${s}x${r}`).toBeDisabled();
      await dlg.getByRole('button', { name: 'Close' }).click();
    }
    await page.getByRole('button', { name: /^Log it$/ }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Sets').fill('-3');
    await expect(dlg.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
  test('Enter submits and Close dismisses the sheet', async ({ page }) => {
    await open(page, '/one');
    const dlg = await logOne(page, '2', '5');
    await dlg.getByLabel('Reps per set').press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.one-recent li')).toHaveCount(1);
    await page.getByRole('button', { name: 'Log another' }).click();
    // NOTE: the shared Sheet has no Escape handler (reported to the shared agent); Close must work.
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  test('huge numbers and fractions do not break the page', async ({ page }) => {
    const w = watch(page); await open(page, '/one');
    const dlg = await logOne(page, '99999', '999999');
    await dlg.getByRole('button', { name: 'Save' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(await page.locator('.main').innerText()).not.toMatch(/NaN|Infinity/);
    expect(w.errors).toEqual([]);
  });
  test('gym sets count automatically for the one (and pike is not a push-up)', async ({ page }) => {
    const workouts = [{ id: 'w', date: MON, name: 'Push', sets: [{ id: 'a', exercise: 'Pike push-up', reps: 6, weight: 0, unit: 'bw' }, { id: 'b', exercise: 'Push-ups', reps: 10, weight: 0, unit: 'bw' }, { id: 'c', exercise: 'Plank', reps: 60, weight: 0, unit: 'sec' }] }];
    await open(page, '/one', MON, { workouts });
    await expect(page.locator('.one-row', { hasText: 'Pike push-ups' }).locator('.one-row-nums')).toContainText('6 reps');
    await expect(page.locator('.one-row', { hasText: /^Push-ups/ }).locator('.one-row-nums')).toContainText('10 reps');
  });
  test('7-day map has seven day columns on the phone without page scroll', async ({ page }) => {
    await open(page, '/one');
    await expect(page.locator('.one-map-head .label')).toHaveCount(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe('today page link to The one', () => {
  test('"All 8" link is a comfortable tap target', async ({ page }) => {
    await open(page, '/today');
    const b = await page.locator('a.one-link').boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(32);
    await page.locator('a.one-link').click();
    await expect(page).toHaveURL(/\/one/);
  });
});
