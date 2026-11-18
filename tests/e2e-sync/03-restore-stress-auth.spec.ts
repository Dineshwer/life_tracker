import { test, expect } from '@playwright/test';
import { AUTH_KEY, Device, dropRealtime, habit, habitLog, journal, newUser, resetMock, rpc, serverItems, setAuthFail, snapshot, task, tid, waitServer } from './fixtures';

test.beforeEach(async () => { await resetMock(); });

test('(b2) realtime gap: changes made by B while A\'s socket is down reach A promptly once it is back', async ({ browser }) => {
  const user = await newUser();
  const A = await Device.create(browser, user, 'A'); await A.settled();
  const B = await Device.create(browser, user, 'B'); await B.settled();
  await expect.poll(async () => (await A.info()).live, { timeout: 15_000 }).toBe(true);
  await dropRealtime(true);                                   // A and B lose their sockets and cannot reconnect
  await expect.poll(async () => (await A.info()).live, { timeout: 15_000 }).toBe(false);
  const h = habit(tid('gap'), 'made during the gap');
  await B.upsert('habits', h); await B.settled();
  await dropRealtime(false);                                  // sockets may come back
  await expect.poll(async () => (await A.info()).live, { timeout: 30_000 }).toBe(true);
  await A.waitFor('habits', h.id, () => true, 25_000);        // whether by catch-up pull or polling: well under the 5 min live-poll
  await A.close(); await B.close();
});

test('(h) tombstones + daily backup restore reaches every device', async ({ browser }) => {
  const user = await newUser();
  const A = await Device.create(browser, user, 'A'); await A.settled();
  const B = await Device.create(browser, user, 'B'); await B.settled();
  const keep = [habit(tid('k1'), 'keep one'), habit(tid('k2'), 'keep two')];
  const jr = journal(tid('jr'), 'precious entry');
  await A.upsertMany('habits', keep); await A.upsert('journal', jr); await A.upsert('habitLogs', habitLog(tid('hl'), keep[0].id, '2026-11-09'));
  await A.settled(); await B.waitFor('journal', jr.id);
  // snapshot through the real Settings UI on A
  await A.page.goto('/settings');
  await A.page.getByRole('button', { name: 'Back up now' }).click();
  await expect.poll(async () => (await rpc(user, 'list_backups')).length, { timeout: 15_000 }).toBeGreaterThan(0);
  // destroy things on A, B follows
  await A.remove('habits', keep[0].id); await A.remove('journal', jr.id);
  const late = task(tid('late'), 'created after the backup'); await A.upsert('tasks', late);
  await A.settled();
  await B.waitGone('habits', keep[0].id); await B.waitGone('journal', jr.id); await B.waitFor('tasks', late.id);
  const tomb = (await snapshot(user, true)).find((r) => r.id === jr.id)!;
  expect(tomb.deleted).toBe(true); expect(tomb.data).toEqual({});
  // restore from B's Settings page
  await B.page.goto('/settings');
  const restoreBtn = B.page.getByRole('button', { name: /^Restore backup from/ }).first();
  await expect(restoreBtn).toBeVisible({ timeout: 15_000 });
  await restoreBtn.click();
  await B.page.getByRole('button', { name: 'Restore this backup' }).click();
  await expect(B.page.getByText(/^Restored \d+ items?/)).toBeVisible({ timeout: 20_000 });
  for (const d of [A, B]) {
    await d.waitFor('journal', jr.id, (j) => j.body === 'precious entry', 15_000);
    await d.waitFor('habits', keep[0].id, () => true, 15_000);
    await d.waitGone('tasks', late.id, 15_000);
  }
  await A.settled(); await B.settled();
  expect((await serverItems(user, 'journal')).some((r) => r.id === jr.id && !r.deleted)).toBe(true);
  // the pre-restore state stays recoverable on the server
  const safety = await rpc(user, 'list_backups', { p_include_safety: true });
  expect(safety.some((b: any) => b.kind === 'pre-restore')).toBe(true);
  await A.close(); await B.close();
});

test('(j) stress: 300 changes made offline on A and 300 on B converge', async ({ browser }) => {
  test.setTimeout(240_000);
  const user = await newUser();
  const A = await Device.create(browser, user, 'A'); await A.settled();
  const B = await Device.create(browser, user, 'B'); await B.settled();
  const hs = await A.ids('habits'); // logs are unique per (habit, date): each device uses its own habit and 150 distinct dates
  const dayN = (i: number) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
  await A.ctx.setOffline(true); await B.ctx.setOffline(true);
  const mk = (p: string, hid: string) => ({
    logs: Array.from({ length: 150 }, (_, i) => habitLog(`${p}-hl-${i}`, hid, dayN(i))),
    tasks: Array.from({ length: 150 }, (_, i) => task(`${p}-t-${i}`, `${p} task ${i}`)),
  });
  const a = mk('A', hs[0]), b = mk('B', hs[1]);
  await A.upsertMany('habitLogs', a.logs); await A.upsertMany('tasks', a.tasks);
  await B.upsertMany('habitLogs', b.logs); await B.upsertMany('tasks', b.tasks);
  await A.ctx.setOffline(false); await B.ctx.setOffline(false);
  await A.settled(120_000); await B.settled(120_000);
  const total = (col: string) => serverItems(user, col).then((r) => r.length);
  await expect.poll(() => total('tasks'), { timeout: 60_000 }).toBe(300 + (await A.ids('tasks')).filter((i) => !i.startsWith('A-t-') && !i.startsWith('B-t-')).length);
  for (const d of [A, B]) {
    await expect.poll(async () => (await d.ids('tasks')).filter((i) => /^[AB]-t-/.test(i)).length, { timeout: 60_000, message: `${d.name} tasks` }).toBe(300);
    await expect.poll(async () => (await d.ids('habitLogs')).filter((i) => /^[AB]-hl-/.test(i)).length, { timeout: 60_000, message: `${d.name} logs` }).toBe(300);
  }
  expect((await A.ids('tasks')).sort()).toEqual((await B.ids('tasks')).sort());
  expect((await A.ids('habitLogs')).sort()).toEqual((await B.ids('habitLogs')).sort());
  expect((await serverItems(user, 'habitLogs')).length).toBe((await A.ids('habitLogs')).length);
  await A.close(); await B.close();
});

test('(k) session expiry: readable error, local data kept, recovers after a new session is injected', async ({ browser }) => {
  const user = await newUser();
  const A = await Device.create(browser, user, 'A'); await A.settled();
  await setAuthFail(true);
  const h = habit(tid('k'), 'edited while signed out');
  await A.upsert('habits', h);
  await expect.poll(async () => (await A.info()).status, { timeout: 45_000 }).toBe('error');
  const info = await A.info();
  expect(info.error, 'readable error').toMatch(/session|sign in|expired/i);
  expect(info.pending).toBeGreaterThan(0);
  expect(await A.ids('habits')).toContain(h.id);
  // reload with an EXPIRED session and a refresh that fails: the app must not throw the data away
  await A.page.evaluate(([k]) => { const s = JSON.parse(localStorage.getItem(k)!); s.expires_at = 1000; localStorage.setItem(k, JSON.stringify(s)); }, [AUTH_KEY]);
  await A.page.reload(); await A.page.waitForFunction(() => document.getElementById('root')?.children.length);
  const persisted = await A.page.evaluate(() => localStorage.getItem('life-tracker-v1') ?? '');
  expect(persisted).toContain(h.id);
  // server healthy again + new session injected (what signing in again does)
  await setAuthFail(false);
  const fresh = await fetch(`http://localhost:${new URL((await import('./fixtures')).MOCK).port}/__test/session?id=${user.id}&email=${encodeURIComponent(user.email)}`).then((r) => r.json());
  await A.page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, fresh] as const);
  await A.page.reload(); await A.page.waitForFunction(() => document.getElementById('root')?.children.length);
  await A.ready(); await A.settled(60_000);
  await waitServer(user, (r) => r.some((x) => x.id === h.id && !x.deleted));
  expect(await A.ids('habits')).toContain(h.id);
  await A.close();
});
