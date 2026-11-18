import { test, expect } from '@playwright/test';
import { Device, habit, habitLog, journal, newUser, resetMock, serverItems, snapshot, task, tid, waitServer, REALTIME_MS } from './fixtures';

test.beforeEach(async () => { await resetMock(); });

test('(a) first run on a new device uploads local data; a second device sees it', async ({ browser }) => {
  const user = await newUser();
  const A = await Device.create(browser, user, 'A');
  await A.settled();
  const h = tid('h');
  await A.upsert('habits', habit(h, 'Cold shower'));
  await A.settled();
  const localIds = await A.ids('habits');
  const srv = await serverItems(user, 'habits');
  expect(srv.map((r) => r.id).sort()).toEqual([...localIds].sort());
  expect((await snapshot(user)).length).toBeGreaterThan(5); // seed + custom data all uploaded
  const B = await Device.create(browser, user, 'B');
  await B.settled();
  expect((await B.ids('habits')).sort()).toEqual([...localIds].sort());
  expect((await B.get('habits', h)).name).toBe('Cold shower');
  expect((await B.info()).pending).toBe(0);
  await A.close(); await B.close();
});

test('(b) create / edit / delete on A reaches B without reload (realtime) and after reload', async ({ browser }) => {
  const user = await newUser();
  const A = await Device.create(browser, user, 'A'); await A.settled();
  const B = await Device.create(browser, user, 'B'); await B.settled();
  await expect.poll(async () => (await B.info()).live, { timeout: 10_000, message: 'B realtime live' }).toBe(true);

  const items = {
    habits: habit(tid('h'), 'Stretch more'),
    tasks: task(tid('t'), 'File taxes'),
    journal: journal(tid('j'), 'dear diary'),
    rejections: { id: tid('r'), date: '2026-11-10', createdAt: '2026-11-10T10:00:00.000Z', what: 'asked for a discount' },
    workouts: { id: tid('w'), date: '2026-11-10', name: 'Pull day', sets: [{ id: 's1', exercise: 'Pullup', reps: 8, weight: 0, unit: 'bw' }] },
    habitLogs: habitLog(tid('hl'), 'meditate', '2026-11-10'),
  } as const;
  for (const [col, it] of Object.entries(items)) await A.upsert(col, it);
  for (const [col, it] of Object.entries(items)) await B.waitFor(col, (it as any).id, () => true, REALTIME_MS);

  // edit
  await A.upsert('tasks', { ...items.tasks, title: 'File taxes (edited)', done: true });
  await B.waitFor('tasks', items.tasks.id, (t) => t.title === 'File taxes (edited)' && t.done === true, REALTIME_MS);
  await A.upsert('journal', { ...items.journal, body: 'dear diary, edited' });
  await B.waitFor('journal', items.journal.id, (j) => j.body.endsWith('edited'), REALTIME_MS);

  // delete
  await A.remove('habits', items.habits.id);
  await B.waitGone('habits', items.habits.id, REALTIME_MS);
  await A.remove('rejections', items.rejections.id);
  await B.waitGone('rejections', items.rejections.id, REALTIME_MS);
  await A.settled();

  // via reload: B reloads and still agrees; a third device that opens now agrees too
  await B.reload(); await B.settled();
  expect(await B.ids('habits')).not.toContain(items.habits.id);
  const C = await Device.create(browser, user, 'C'); await C.settled();
  for (const col of ['habits', 'tasks', 'journal', 'rejections', 'workouts', 'habitLogs']) expect((await C.ids(col)).sort()).toEqual((await A.ids(col)).sort());
  expect((await C.get('tasks', items.tasks.id)).title).toBe('File taxes (edited)');
  await A.close(); await B.close(); await C.close();
});

test('(i) kv preferences sync across devices', async ({ browser }) => {
  const user = await newUser();
  const A = await Device.create(browser, user, 'A'); await A.settled();
  const B = await Device.create(browser, user, 'B'); await B.settled();
  await A.setKV('ledger-gym-start', '2026-10-05');
  await A.setKV('ledger-mobility-2026-11-10', JSON.stringify({ hips: true, spine: true }));
  await A.setKV('ledger-ht-topics', JSON.stringify(['sec', 'code']));
  await B.waitFor('kv', 'ledger-gym-start', (k) => k.value === '2026-10-05', REALTIME_MS);
  await B.waitFor('kv', 'ledger-mobility-2026-11-10', (k) => JSON.parse(k.value).spine === true, REALTIME_MS);
  await B.waitFor('kv', 'ledger-ht-topics', (k) => JSON.parse(k.value).includes('code'), REALTIME_MS);
  // and back
  await B.setKV('ledger-gym-start', '2026-11-01');
  await A.waitFor('kv', 'ledger-gym-start', (k) => k.value === '2026-11-01', REALTIME_MS);
  // settings (theme) is meta
  await A.patchSettings({ name: 'Dinesh Test' });
  await expect.poll(async () => (await B.run(({ store }) => store.getState().settings.name)), { timeout: REALTIME_MS }).toBe('Dinesh Test');
  await waitServer(user, (r) => r.some((x) => x.collection === 'kv' && x.id === 'ledger-gym-start' && x.data.value === '2026-11-01'));
  await A.close(); await B.close();
});
