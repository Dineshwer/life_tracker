import { test, expect } from '@playwright/test';
import { Device, habit, journal, newUser, resetMock, serverItems, setOffline, snapshot, task, tid, waitServer } from './fixtures';

test.beforeEach(async () => { await resetMock(); });
const RECOVER = 60_000; // engine backoff after an outage

test('(c1) browser offline on A and B: edits made offline converge, nothing lost', async ({ browser }) => {
  const user = await newUser();
  const A = await Device.create(browser, user, 'A'); await A.settled();
  const B = await Device.create(browser, user, 'B'); await B.settled();
  const base = task(tid('base'), 'shared task');
  await A.upsert('tasks', base); await B.waitFor('tasks', base.id);
  await A.ctx.setOffline(true); await B.ctx.setOffline(true);
  const a1 = habit(tid('ha'), 'from A'), b1 = habit(tid('hb'), 'from B');
  await A.upsert('habits', a1); await A.upsert('journal', journal(tid('ja'), 'A offline note'));
  await B.upsert('habits', b1); await B.upsert('journal', journal(tid('jb'), 'B offline note'));
  await A.upsert('tasks', { ...base, title: 'A edit' });                 // A edits title
  await B.upsert('tasks', { ...base, context: 'job', effort: 3 });         // B edits other fields: merge
  await expect.poll(async () => (await A.info()).pending).toBeGreaterThan(0);
  await A.ctx.setOffline(false); await B.ctx.setOffline(false);
  await A.settled(RECOVER); await B.settled(RECOVER);
  await expect.poll(async () => JSON.stringify(((await A.ids('habits')).sort())) === JSON.stringify((await B.ids('habits')).sort()), { timeout: 20_000 }).toBe(true);
  for (const d of [A, B]) {
    expect(await d.ids('habits')).toEqual(expect.arrayContaining([a1.id, b1.id]));
    expect((await d.list('journal')).map((j: any) => j.body)).toEqual(expect.arrayContaining(['A offline note', 'B offline note']));
    await expect.poll(async () => (await d.get('tasks', base.id)), { timeout: 20_000 }).toMatchObject({ title: 'A edit', context: 'job', effort: 3 });
  }
  expect((await serverItems(user, 'tasks')).find((r) => r.id === base.id)!.data).toMatchObject({ title: 'A edit', context: 'job', effort: 3 });
  await A.close(); await B.close();
});

test('(c2) server outage: edits on both devices survive and upload when the server returns', async ({ browser }) => {
  const user = await newUser();
  const A = await Device.create(browser, user, 'A'); await A.settled();
  const B = await Device.create(browser, user, 'B'); await B.settled();
  await setOffline(true);
  const a = habit(tid('ha'), 'A in outage'), b = habit(tid('hb'), 'B in outage');
  await A.upsert('habits', a); await B.upsert('habits', b);
  await expect.poll(async () => (await A.info()).pending, { timeout: 10_000 }).toBeGreaterThan(0);
  await setOffline(false);
  await A.settled(RECOVER); await B.settled(RECOVER);
  await A.waitFor('habits', b.id, () => true, 30_000); await B.waitFor('habits', a.id, () => true, 30_000);
  const ids = (await serverItems(user, 'habits')).map((r) => r.id);
  expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
  await A.close(); await B.close();
});

test('(d) same-field conflict: server (first writer) wins deterministically, is listed; different fields merge', async ({ browser }) => {
  const user = await newUser();
  const A = await Device.create(browser, user, 'A'); await A.settled();
  const B = await Device.create(browser, user, 'B'); await B.settled();
  const t = task(tid('t'), 'original');
  await A.upsert('tasks', t); await B.waitFor('tasks', t.id); await A.settled(); await B.settled();
  await A.ctx.setOffline(true); await B.ctx.setOffline(true);
  await A.upsert('tasks', { ...t, title: 'title from A', effort: 2 });
  await B.upsert('tasks', { ...t, title: 'title from B', context: 'job' });
  // A reconnects first and wins the title
  await A.ctx.setOffline(false); await A.settled(RECOVER);
  await waitServer(user, (r) => r.find((x) => x.id === t.id)?.data.title === 'title from A');
  await B.ctx.setOffline(false); await B.settled(RECOVER);
  await A.waitFor('tasks', t.id, (x) => x.context === 'job', 20_000);
  const finalB = await B.get('tasks', t.id);
  expect(finalB).toMatchObject({ title: 'title from A', effort: 2, context: 'job' });
  expect(await A.get('tasks', t.id)).toMatchObject({ title: 'title from A', effort: 2, context: 'job' });
  expect((await serverItems(user, 'tasks')).find((r) => r.id === t.id)!.data).toMatchObject({ title: 'title from A', effort: 2, context: 'job' });
  // B's conflict list says it
  const conf = (await B.info()).conflicts as any[];
  const entry = conf.find((c) => c.collection === 'tasks' && c.id === t.id);
  expect(entry, JSON.stringify(conf)).toBeTruthy();
  expect(entry.fields).toContain('title');
  expect(['server-won', 'merged']).toContain(entry.kind);
  // and Settings shows it
  await B.page.goto('/settings');
  await expect(B.page.getByText('Recent changes merged from other devices')).toBeVisible();
  await expect(B.page.getByText(/title from|replaced by a newer edit|combined into one/).first()).toBeVisible();
  await A.close(); await B.close();
});

test('(d2) edit on one device vs delete on another: deletion kept, listed', async ({ browser }) => {
  const user = await newUser();
  const A = await Device.create(browser, user, 'A'); await A.settled();
  const B = await Device.create(browser, user, 'B'); await B.settled();
  const t = task(tid('t'), 'doomed');
  await A.upsert('tasks', t); await B.waitFor('tasks', t.id); await A.settled(); await B.settled();
  await A.ctx.setOffline(true); await B.ctx.setOffline(true);
  await A.remove('tasks', t.id);
  await B.upsert('tasks', { ...t, title: 'edited while deleted elsewhere' });
  await A.ctx.setOffline(false); await A.settled(RECOVER);
  await B.ctx.setOffline(false); await B.settled(RECOVER);
  await expect.poll(async () => (await B.ids('tasks')).includes(t.id), { timeout: 20_000 }).toBe(false);
  expect((await B.info()).conflicts.some((c: any) => c.id === t.id)).toBe(true);
  expect((await snapshot(user, true)).find((r) => r.id === t.id)!.deleted).toBe(true);
  await A.close(); await B.close();
});

test('(e) wiping a device (localStorage + IndexedDB): everything returns from the server, no duplicates, nothing pending', async ({ browser }) => {
  const user = await newUser();
  const A = await Device.create(browser, user, 'A'); await A.settled();
  const mine = Array.from({ length: 12 }, (_, i) => habit(tid(`h${i}`), `h${i}`));
  await A.upsertMany('habits', mine);
  await A.upsertMany('tasks', [task(tid('t1')), task(tid('t2'))]);
  await A.setKV('ledger-gym-start', '2026-09-01');
  await A.settled();
  const before = { habits: (await A.ids('habits')).sort(), tasks: (await A.ids('tasks')).sort(), kv: (await A.ids('kv')).sort(), xp: (await A.ids('xp')).sort() };
  const serverBefore = (await snapshot(user)).length;
  await A.wipe();
  await A.reload(); await A.ready(); await A.settled();
  expect({ habits: (await A.ids('habits')).sort(), tasks: (await A.ids('tasks')).sort(), kv: (await A.ids('kv')).sort(), xp: (await A.ids('xp')).sort() }).toEqual(before);
  expect(new Set(await A.ids('habits')).size).toBe((await A.ids('habits')).length);
  expect((await A.info()).pending).toBe(0);
  const snap = await snapshot(user);
  expect(snap.length).toBe(serverBefore);               // nothing duplicated / resurrected server-side
  expect(snap.every((r) => r.version === 1 || r.version >= 1)).toBe(true);
  await A.close();
});

test('(f) server dies mid-edit: red banner with the pending count, edits survive offline reload, upload after the server returns', async ({ browser }) => {
  const user = await newUser();
  const A = await Device.create(browser, user, 'A'); await A.settled();
  await setOffline(true);
  const ids = [tid('o1'), tid('o2'), tid('o3')];
  for (const id of ids) await A.upsert('habits', habit(id, id));
  const banner = A.page.getByTestId('sync-banner');
  await expect(banner).toBeVisible({ timeout: 45_000 });
  await expect(banner).toContainText(/3 changes|3 change/);
  await A.page.screenshot({ path: '../../test-results/e2e-sync/banner.png' }).catch(() => {});
  // survives a reload while the server is still down
  await A.page.reload().catch(() => {}); await A.page.waitForFunction(() => document.getElementById('root')?.children.length);
  expect(await A.ids('habits')).toEqual(expect.arrayContaining(ids));
  await expect.poll(async () => (await A.info()).pending, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  await setOffline(false);
  await A.settled(RECOVER);
  await waitServer(user, (r) => ids.every((id) => r.some((x) => x.collection === 'habits' && x.id === id)));
  await expect(banner).toBeHidden({ timeout: 15_000 });
  await A.close();
});

test('(g) two tabs of one device editing quickly: no duplicates, server consistent', async ({ browser }) => {
  const user = await newUser();
  const A = await Device.create(browser, user, 'A'); await A.settled();
  const tab2 = await A.newTab();
  await expect.poll(async () => (await A.info(tab2)).status, { timeout: 20_000 }).not.toBe('off');
  const N = 15;
  const mk = (p: string) => Array.from({ length: N }, (_, i) => task(tid(`${p}${i}`), `${p}${i}`));
  const t1 = mk('tab1-'), t2 = mk('tab2-');
  await Promise.all([A.upsertMany('tasks', t1), A.run(({ store }, items) => { const s = store.getState(); for (const it of items as object[]) s.upsert('tasks', it); }, t2, tab2)]);
  // both tabs also edit the same item
  const shared = task(tid('shared'), 'shared');
  await A.upsert('tasks', shared);
  await A.settled(); 
  await Promise.all([A.upsert('tasks', { ...shared, title: 'tab1 title' }), A.run(({ store }, s0) => store.getState().upsert('tasks', { ...(s0 as object), context: 'job' }), shared, tab2)]);
  await expect.poll(async () => (await serverItems(user, 'tasks')).length, { timeout: 30_000 }).toBe(2 * N + 1);
  await A.settled(); await expect.poll(async () => (await A.info(tab2)).pending, { timeout: 30_000 }).toBe(0);
  const srv = (await serverItems(user, 'tasks')).map((r) => r.id);
  expect(new Set(srv).size).toBe(srv.length);
  for (const page of [A.page, tab2]) {
    const ids: string[] = await A.run(({ store }) => store.getState().tasks.map((t: any) => t.id), undefined, page);
    expect(new Set(ids).size).toBe(ids.length);
    await expect.poll(async () => (await A.run(({ store }) => store.getState().tasks.length, undefined, page)), { timeout: 15_000 }).toBe(2 * N + 1);
  }
  await A.close();
});
