import { describe, it, expect } from 'vitest';
import { oldWorld, applyAllSql, UID, serverRows } from './world';
import { NewDevice, keyed } from './device';
import { OldClient, pgOldDb } from './oldClient';
import { legacyKeys, clone } from './fixtures';
import { LISTS } from './fixtures';
import { canon } from '../../../src/sync/merge';

/** laptop + phone both start from the same cloud state S0. The phone then goes offline for days under the OLD client; the laptop keeps syncing (old client). */
async function twoOldDevices() {
  const w = await oldWorld();
  const S0 = clone(w.laptop.state); const snap0 = JSON.parse(w.laptop.snapshotBlob());
  const phoneOld = new OldClient(UID, pgOldDb(w.db, UID), S0, snap0);               // the phone's cache = state at its last sync
  const L = w.laptop.state; const P = phoneOld.state;
  const task = (s: any, i: number) => s.tasks[i];
  const tA = task(S0, 8).id, tDel = task(S0, 9).id, tEdit = task(S0, 10).id, hCold = S0.habits[10].id, j1 = S0.journal[0].id;
  const logHabit = S0.habits[0].id; const logDate = '2026-11-18'; const ref = 'task:shared-completion';
  // ---- laptop, synced to the table by the old client ----
  L.habits.find((h: any) => h.id === hCold).name = 'Cold shower 2min';
  L.tasks.find((t: any) => t.id === tA).done = true;
  L.tasks.push({ id: 'lap-new', title: 'Laptop new', done: false, context: 'job', tags: [], effort: 1, stat: 'skill' });
  L.habitLogs.push({ id: 'LLL-log', habitId: logHabit, date: logDate, level: 'full' });
  L.xp.push({ id: 'LLL-xp', date: logDate, stat: 'mind', amount: 20, reason: 'habit', ref: `habit:${logHabit}:${logDate}` }, { id: 'LLL-xp2', date: logDate, stat: 'skill', amount: 20, reason: 'Done', ref });
  L.journal.find((j: any) => j.id === j1).body = 'laptop body';
  L.tasks.find((t: any) => t.id === tEdit).title = 'edited on laptop';
  L.settings = { ...L.settings, wakeTime: '06:15' };
  await w.laptop.cycle(); expect(w.laptop.status).toBe('synced');
  // ---- phone, OFFLINE, days of edits (never synced) ----
  P.habits.find((h: any) => h.id === hCold).name = 'Ice bath';
  P.tasks.find((t: any) => t.id === tA).title = 'renamed on phone';
  P.tasks.push({ id: 'ph-new', title: 'Phone new', done: false, context: 'personal', tags: [], effort: 2, stat: 'body' });
  P.habitLogs.push({ id: 'PPP-log', habitId: logHabit, date: logDate, level: 'min', note: 'phone note' });
  P.xp.push({ id: 'PPP-xp', date: logDate, stat: 'mind', amount: 10, reason: 'habit (minimum)', ref: `habit:${logHabit}:${logDate}` }, { id: 'PPP-xp2', date: logDate, stat: 'skill', amount: 20, reason: 'Done', ref });
  const jp = P.journal.find((j: any) => j.id === j1); jp.body = 'phone body'; jp.mood = 5;
  P.tasks = P.tasks.filter((t: any) => t.id !== tDel && t.id !== tEdit);
  for (let i = 0; i < 5; i++) P.rejections.push({ id: `ph-rej${i}`, date: '2026-11-18', createdAt: '2026-11-18T09:00:00.000Z', what: `phone ask ${i}` });
  P.wake.push({ date: '2026-11-18', time: '06:50' });
  P.settings = { ...P.settings, theme: 'light' };
  return { w, phoneOld, ids: { tA, tDel, tEdit, hCold, j1, logHabit, logDate } };
}

describe('S4: phone with its own stale OLD cache (days offline) joins after the laptop upgraded', () => {
  it('nothing lost on either side, conflicts logged, devices converge', async () => {
    const { w, phoneOld, ids } = await twoOldDevices();
    await applyAllSql(w.db);
    const laptop = await NewDevice.open('laptop', w.laptop.localStorageDump(w.legacy), w.db, UID, w.clock); await laptop.boot(); await laptop.sync();
    const phone = await NewDevice.open('phone', phoneOld.localStorageDump(legacyKeys('phone')), w.db, UID, w.clock); await phone.boot(); await phone.sync(); await phone.sync();
    await laptop.sync(); await laptop.sync(); await phone.sync();
    const rows = keyed(await serverRows(w.db, UID)); const live = (c: string) => [...rows].filter(([k, r]) => k.startsWith(c + '/') && !r.deleted).map(([k]) => k.slice(c.length + 1));
    // convergence: both devices equal the server
    for (const d of [laptop, phone]) for (const c of LISTS) { expect([...d.byId(c).keys()].sort(), `${d.name} ${c}`).toEqual(live(c).sort()); expect(d.list(c).length).toBe(d.byId(c).size); }
    const get = (c: string, id: string) => rows.get(`${c}/${id}`)!.data;
    // field merges: both sides' non-conflicting edits survive
    expect(get('tasks', ids.tA)).toMatchObject({ done: true, title: 'renamed on phone' });
    expect(get('journal', ids.j1)).toMatchObject({ mood: 5 });                              // phone-only field kept
    // same-field edits: server (laptop, which synced first) wins, the phone's value is recoverable from the conflict log
    expect(get('habits', ids.hCold).name).toBe('Cold shower 2min');
    expect(get('journal', ids.j1).body).toBe('laptop body');
    const pc = phone.info().conflicts; const mk = (c: any) => `${c.kind}:${c.collection}/${c.id}:${(c.fields ?? []).join('+')}`;
    console.log('phone conflicts', pc.map(mk), '\nlaptop conflicts', laptop.info().conflicts.map(mk));
    const lost = pc.find((c) => c.collection === 'habits' && c.id === ids.hCold)!; expect(lost.kind).toBe('server-won'); expect((lost.local as any).name).toBe('Ice bath');
    expect(pc.some((c) => c.collection === 'journal' && c.id === ids.j1 && c.fields?.includes('body') && (c.local as any).body === 'phone body')).toBe(true);
    // new items from both sides exist exactly once
    expect(rows.get('tasks/lap-new')!.deleted).toBe(false); expect(rows.get('tasks/ph-new')!.deleted).toBe(false);
    expect(live('rejections').filter((i) => i.startsWith('ph-rej'))).toHaveLength(5); expect(live('rejections')).toHaveLength(136 + 5);
    expect(live('wake')).toContain('wake:2026-11-18');
    // phone deleted a task nobody touched: the NEW engine honours it (the old client would have resurrected it); a delete vs a laptop edit: the edit wins
    expect(rows.get(`tasks/${ids.tDel}`)!.deleted).toBe(true);
    expect(rows.get(`tasks/${ids.tEdit}`)!.deleted).toBe(false); expect(get('tasks', ids.tEdit).title).toBe('edited on laptop');
    expect(pc.some((c) => c.kind === 'deleted-locally' && c.id === ids.tEdit)).toBe(true);
    // same habit logged on the same day from both devices: ONE log and ONE xp event survive (smallest id), the other is tombstoned
    const logs = live('habitLogs').filter((id) => get('habitLogs', id).habitId === ids.logHabit && get('habitLogs', id).date === ids.logDate); expect(logs).toEqual(['LLL-log']);
    expect(live('xp').filter((id) => get('xp', id).ref === `habit:${ids.logHabit}:${ids.logDate}`)).toEqual(['LLL-xp']);
    expect(live('xp').filter((id) => get('xp', id).ref === 'task:shared-completion')).toEqual(['LLL-xp2']);
    expect(phone.info().pending).toBe(0); expect(laptop.info().pending).toBe(0);
    expect(get('meta', 'settings')).toMatchObject({ wakeTime: '06:15', theme: 'light' });   // laptop's wakeTime + phone's theme merged
    expect(phone.state.settings).toMatchObject({ wakeTime: '06:15', theme: 'light' }); expect(laptop.state.settings).toMatchObject({ wakeTime: '06:15', theme: 'light' });
    // every kv value: see s5
  });
});
