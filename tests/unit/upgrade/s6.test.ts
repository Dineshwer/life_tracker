import { describe, it, expect } from 'vitest';
import { oldWorld, applyAllSql, UID, serverRows } from './world';
import { NewDevice, keyed } from './device';
import { OldClient, pgOldDb } from './oldClient';
import { legacyKeys, clone } from './fixtures';
import { asUser } from '../db/harness';

/* The laptop's installed PWA tab is still running the OLD bundle when the SQL is applied (service worker updates on next load).
   Meanwhile the phone already runs the NEW client and writes. */
async function staleTabWorld() {
  const w = await oldWorld();
  const tabOld = new OldClient(UID, pgOldDb(w.db, UID), clone(w.laptop.state), JSON.parse(w.laptop.snapshotBlob()));   // the stale tab == laptop cache
  await applyAllSql(w.db);
  const phone = await NewDevice.open('phone', new OldClient(UID, pgOldDb(w.db, UID), clone(w.laptop.state), JSON.parse(w.laptop.snapshotBlob())).localStorageDump(legacyKeys('phone')), w.db, UID, w.clock);
  await phone.boot(); await phone.sync();
  const S = tabOld.state;
  const tPhone = phone.list('tasks')[12].id; const tOther = phone.list('tasks')[13].id;
  phone.set({ tasks: [...phone.list('tasks').filter((t: any) => t.id !== tPhone), { id: 'phone-task', title: 'from phone', done: false, context: 'job', tags: [], effort: 1, stat: 'skill' }].map((t: any) => (t.id === tOther ? { ...t, title: 'phone edit' } : t)) });
  await phone.sync();
  return { w, tabOld, phone, S, tPhone, tOther };
}

describe('S6: a stale OLD client tab keeps running after the SQL upgrade', () => {
  it('reads still work, writes are REFUSED with a permission error, nothing is lost locally, the server is untouched by it', async () => {
    const { w, tabOld, phone, S, tPhone, tOther } = await staleTabWorld();
    // the user keeps working in the stale tab
    S.tasks.push({ id: 'stale-task', title: 'made in the stale tab', done: false, context: 'job', tags: [], effort: 1, stat: 'skill' });
    S.habits[0].name = 'Meditation (stale edit)'; S.habitLogs.push({ id: 'stale-log', habitId: S.habits[1].id, date: '2026-11-18', level: 'full' });
    S.tasks.find((t: any) => t.id === tOther)!.done = !S.tasks.find((t: any) => t.id === tOther)!.done;                       // the same task the phone edited (different field)
    const before = await serverRows(w.db, UID);
    await tabOld.cycle();
    // what the user sees: the old banner goes to "error" with the Postgres message, and the unsynced counter stays > 0
    expect(tabOld.status).toBe('error'); expect(tabOld.lastError).toMatch(/permission denied for table records/);
    expect(tabOld.pending()).toBe(4);
    // reading still works: the stale tab pulled the phone's changes (new task appears, deleted task disappears) and kept its own edits
    expect(tabOld.state.tasks.map((t: any) => t.id)).toEqual(expect.arrayContaining(['phone-task', 'stale-task']));
    expect(tabOld.state.tasks.map((t: any) => t.id)).not.toContain(tPhone);
    expect(tabOld.state.habits[0].name).toBe('Meditation (stale edit)'); expect(tabOld.state.habitLogs.map((l: any) => l.id)).toContain('stale-log');
    expect(tabOld.state.tasks.find((t: any) => t.id === tOther)).toBeTruthy();
    // nothing reached the server from the stale tab (no partial write either)
    const after = await serverRows(w.db, UID); expect(after).toEqual(before);
    // the direct upsert the old client issues is exactly what is refused (PostgREST would answer 401/403 with this message)
    await expect(asUser(w.db, UID).query(`insert into public.records (user_id, collection, id, data) values ($1,'tasks','x','{}') on conflict (user_id,collection,id) do update set data = excluded.data`, [UID])).rejects.toThrow(/permission denied/);
    // retrying does not help and does not corrupt anything
    await tabOld.cycle(); expect(tabOld.status).toBe('error'); expect(tabOld.pending()).toBe(4);
  });

  it('when the stale tab finally reloads into the NEW client, its offline edits are uploaded and merged with the phone\'s: zero loss', async () => {
    const { w, tabOld, phone, S, tOther } = await staleTabWorld();
    S.tasks.push({ id: 'stale-task', title: 'made in the stale tab', done: false, context: 'job', tags: [], effort: 1, stat: 'skill' });
    const was = S.tasks.find((t: any) => t.id === tOther)!.done;
    S.habits[0].name = 'Meditation (stale edit)'; S.tasks.find((t: any) => t.id === tOther)!.done = !was;
    await tabOld.cycle(); await tabOld.cycle();
    const lap = await NewDevice.open('laptop', tabOld.localStorageDump(legacyKeys('laptop')), w.db, UID, w.clock); await lap.boot(); await lap.sync(); await phone.sync();
    const rows = keyed(await serverRows(w.db, UID));
    expect(rows.get('tasks/stale-task')!.deleted).toBe(false); expect(rows.get('habits/' + S.habits[0].id)!.data.name).toBe('Meditation (stale edit)');
    expect(rows.get('tasks/phone-task')!.deleted).toBe(false);
    expect(rows.get('tasks/' + tOther)!.data).toMatchObject({ done: !was, title: 'phone edit' });   // phone's title + stale tab's done, merged
    expect(lap.info().pending).toBe(0); expect(phone.info().pending).toBe(0); expect(lap.info().conflicts.filter((c) => c.collection !== 'kv'), 'only never-confirmed kv prefs that lost to the cloud are logged (recoverable)').toEqual([]);
    expect(lap.list('tasks').length).toBe(phone.list('tasks').length);
    expect(new Set(lap.list('tasks').map((t: any) => t.id)).size).toBe(lap.list('tasks').length);
  });

  it('settings written by the new client (with id + settledThrough) are readable by the old client and do not break it', async () => {
    const { tabOld, phone } = await staleTabWorld();
    phone.set({ settings: { ...phone.state.settings, theme: 'light', wakeTime: '05:45' } }); await phone.sync();
    await tabOld.cycle();
    expect(tabOld.state.settings).toMatchObject({ theme: 'light', wakeTime: '05:45' });
    expect(tabOld.state.settings).toHaveProperty('settledThrough');     // extra fields ride along in the old client's settings object (harmless: it never reads them)
  });
});
