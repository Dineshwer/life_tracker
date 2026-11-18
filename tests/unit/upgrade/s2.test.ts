import { describe, it, expect } from 'vitest';
import { oldWorld, applyAllSql, UID, serverRows } from './world';
import { NewDevice, keyed } from './device';
import { LISTS, clone } from './fixtures';
import { canon } from '../../../src/sync/merge';
import { validateItem } from '../../../src/lib/validate';

/** the laptop after the owner ran apply-all.sql and opened the NEW app with its OLD browser cache */
async function laptopUpgrade() {
  const w = await oldWorld(); await applyAllSql(w.db);
  const before = await serverRows(w.db, UID);
  const ls = w.laptop.localStorageDump(w.legacy);
  const d = await NewDevice.open('laptop', ls, w.db, UID, w.clock); await d.boot();
  return { w, d, ls, before };
}
const sameItems = (d: NewDevice, expected: any) => {
  for (const c of LISTS) {
    const exp = new Map<string, any>(expected[c].map((x: any) => [c === 'wake' ? 'wake:' + x.date : x.id, x])); const got = d.byId(c);
    expect([...got.keys()].sort(), `${c} ids`).toEqual([...exp.keys()].sort());
    expect(d.list(c).length, `${c} duplicates`).toBe(got.size);
    for (const [k, v] of exp) expect(canon(got.get(k)), `${c}/${k}`).toBe(canon(v));
  }
};

// no SQL backfill of the legacy settings row is needed: the engine injects the fixed id (src/sync/engine.ts withMetaId)
describe('S2: laptop, old cache + old snapshot, NEW engine on the upgraded DB', () => {
  it('zero loss, zero duplicates, zero conflicts; server unchanged except kv + meta', async () => {
    const { w, d, ls, before } = await laptopUpgrade();
    await d.sync();                                                  // a second cycle must be a no-op
    sameItems(d, w.laptop.state);                                    // every item of the old cache is still there, byte-equal, once
    expect(d.info().conflicts, 'spurious conflicts').toEqual([]);
    expect(d.info().status).toBe('synced'); expect(d.info().error).toBeUndefined();
    expect(d.engine.quarantine().rejected).toEqual([]);
    const after = await serverRows(w.db, UID); const b = keyed(before), a = keyed(after);
    for (const [k, r] of b) { const x = a.get(k)!; expect(x, `${k} missing after`).toBeTruthy(); expect(x.deleted).toBe(r.deleted); if (!k.startsWith('meta/')) { expect(x.version, `${k} version bumped`).toBe(r.version); expect(x.data, k).toEqual(r.data); } }
    const added = [...a.keys()].filter((k) => !b.has(k)).sort();
    expect(added.every((k) => k.startsWith('kv/'))).toBe(true);
    expect(added).toEqual(Object.keys(w.legacy).map((k) => `kv/${k}`).sort());   // exactly the six legacy browser keys, nothing else
    // the old snapshot is consumed, new metadata written
    expect(ls.has(`ledger-sync-${UID}`)).toBe(false); expect(ls.has(`ledger-sync-v2-${UID}`)).toBe(true);
    const seq1 = Math.max(...after.map((r) => r.seq)); await d.sync(); expect(Math.max(...(await serverRows(w.db, UID)).map((r) => r.seq)), 'idle cycle wrote something').toBe(seq1);
    {
      expect(d.info().pending, 'pending after first cycle').toBe(0);
      expect(a.get('meta/settings')!.data).toMatchObject({ id: 'settings', theme: 'dark', wakeTime: '06:30', weekendWake: '08:00', name: 'Dinesh', settledThrough: '2026-11-16' });
    }
  });

  it('a second boot of the same cache (app restart) is idempotent', async () => {
    const { w, d, ls } = await laptopUpgrade(); d.stop();
    const before = await serverRows(w.db, UID);
    const d2 = await NewDevice.open('laptop', ls, w.db, UID, w.clock); await d2.boot();
    expect(await serverRows(w.db, UID)).toEqual(before); sameItems(d2, w.laptop.state); expect(d2.info().conflicts).toEqual([]);
  });
});

describe('S2 regression DEFECT-A (found by this suite, fixed in the engine meanwhile): the legacy meta/settings row has no `id` in data', () => {
  it('settings round-trip works for an upgraded user: pending reaches 0 and a theme change reaches the server', async () => {
    const { w, d } = await laptopUpgrade(); await d.sync();
    expect(d.info().pending).toBe(0); expect(d.engine.quarantine().invalidRows).toEqual([]);
    d.set({ settings: { ...d.state.settings, theme: 'light' } }); await d.sync(); await d.sync();
    expect((await serverRows(w.db, UID)).find((r) => r.collection === 'meta')!.data.theme).toBe('light');
  });
});

describe('S2: legacy items the NEW validator rejects (old client accepted anything)', () => {
  it('xp duplicates (same ref from two devices) collapse deterministically and the loser becomes a tombstone; nothing else changes', async () => {
    const w = await oldWorld(); const dup = clone(w.laptop.state.xp.slice(0, 6)).map((e: any, i: number) => ({ ...e, id: 'zzdup' + i }));  // larger id loses
    w.laptop.state.xp.push(...dup); await w.laptop.cycle(); await applyAllSql(w.db);
    const d = await NewDevice.open('laptop', w.laptop.localStorageDump(w.legacy), w.db, UID, w.clock); await d.boot(); await d.sync();
    expect(d.list('xp').length).toBe(210);
    const rows = keyed(await serverRows(w.db, UID));
    for (let i = 0; i < 6; i++) { expect(rows.get(`xp/zzdup${i}`)!.deleted).toBe(true); expect(rows.get(`xp/${w.laptop.state.xp[i].id}`)!.deleted).toBe(false); }
    expect(d.info().pending).toBe(0);
  });

  it('FIXED FINDING-B: items valid for the old client but over the new caps are truncated on pull, visible in the app, not quarantined', async () => {
    const w = await oldWorld(); const s = w.laptop.state;
    s.tasks.push({ id: 'longtitle', title: 'T'.repeat(1500), done: false, context: 'job', tags: [], effort: 1, stat: 'skill' });   // title cap 1000
    s.body.push({ id: 'bigphoto', date: '2026-11-01', weightKg: 77, photo: 'p'.repeat(450_000) });                                  // photo cap 400k
    s.rejections.push({ id: 'longwho', date: '2026-11-01', createdAt: '2026-11-01T10:00:00.000Z', what: 'x', who: 'w'.repeat(900) });  // who cap 500
    await w.laptop.cycle(); expect(w.laptop.status).toBe('synced');
    await applyAllSql(w.db);
    const bad = ['tasks/longtitle', 'body/bigphoto', 'rejections/longwho'];
    for (const k of bad) { const [c] = k.split('/'); expect(validateItem(c, s[c].find((x: any) => `${c}/${x.id}` === k))).toBe(false); }
    const d = await NewDevice.open('laptop', w.laptop.localStorageDump(w.legacy), w.db, UID, w.clock); await d.boot(); await d.sync();
    const rows = keyed(await serverRows(w.db, UID));
    for (const k of bad) { expect(rows.get(k)!.deleted, `${k} must NOT be tombstoned`).toBe(false); expect(rows.get(k)!.version).toBe(1); }
    const visible = bad.filter((k) => { const [c, id] = k.split('/'); return d.byId(c).has(id); });
    console.log('legacy items still visible in the app:', visible, '| quarantined:', d.engine.quarantine().invalidRows.map((x) => x.key));
    expect(visible).toEqual(bad); expect(d.engine.quarantine().invalidRows).toEqual([]);
    expect((d.byId('tasks').get('longtitle') as { title: string }).title).toHaveLength(1000);
  });
});
