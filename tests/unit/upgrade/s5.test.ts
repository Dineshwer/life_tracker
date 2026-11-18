import { describe, it, expect } from 'vitest';
import { oldWorld, applyAllSql, UID, serverRows } from './world';
import { NewDevice, keyed } from './device';
import { OldClient, pgOldDb } from './oldClient';
import { legacyKeys, clone, TODAY } from './fixtures';

/* The legacy browser-only keys (never synced by the old client) now live in the synced `kv` collection (id = the localStorage key, value = the raw string).
   Both devices hold DIFFERENT values for the same keys (laptop vs phone), plus each has a mobility day the other lacks. */
async function bothDevices(order: 'laptop-first' | 'phone-first') {
  const w = await oldWorld(); await applyAllSql(w.db);
  const lapLS = { ...legacyKeys('laptop'), 'ledger-mobility-2026-11-10': '{"done":["only-laptop"]}' };
  const phLS = { ...legacyKeys('phone'), 'ledger-mobility-2026-11-12': '{"done":["only-phone"]}', 'lt-journal-serif': '"1"' };
  const phoneOld = new OldClient(UID, pgOldDb(w.db, UID), clone(w.laptop.state), JSON.parse(w.laptop.snapshotBlob()));
  const lapMap = w.laptop.localStorageDump(lapLS), phMap = phoneOld.localStorageDump(phLS);
  const laptop = await NewDevice.open('laptop', lapMap, w.db, UID, w.clock); const phone = await NewDevice.open('phone', phMap, w.db, UID, w.clock);
  const first = order === 'laptop-first' ? laptop : phone, second = order === 'laptop-first' ? phone : laptop;
  const afterOpen = { laptop: laptop.kv(), phone: phone.kv(), lapMap, phMap };
  await first.boot(); await first.sync(); await second.boot(); await second.sync(); await first.sync(); await second.sync();
  return { w, laptop, phone, lapLS, phLS, afterOpen };
}

describe('S5: legacy browser-only keys on BOTH devices, with different values', () => {
  it('startup migration (migrateLegacyPrefs): every legacy key moves into kv on its own device; the browser original is archived (ledger-legacy-*) until the first sync', async () => {
    const { afterOpen, lapLS, phLS } = await bothDevices('laptop-first');
    expect(afterOpen.laptop).toEqual(lapLS); expect(afterOpen.phone).toEqual(phLS);                      // verbatim values
    for (const m of [afterOpen.lapMap, afterOpen.phMap]) expect([...m.keys()].filter((k) => k.startsWith('ledger-') && !k.startsWith('ledger-sync') && !k.startsWith('ledger-legacy-'))).toEqual([]);   // originals dropped: the store copy is now the ONLY copy until synced
  });

  it('RULE (current): first device to sync wins every key both devices have; keys only one device has are all kept; both devices end identical to the server', async () => {
    const { w, laptop, phone, lapLS, phLS } = await bothDevices('laptop-first');
    const rows = keyed(await serverRows(w.db, UID)); const srvKv = Object.fromEntries([...rows].filter(([k, r]) => k.startsWith('kv/') && !r.deleted).map(([k, r]) => [k.slice(3), r.data.value]));
    expect(srvKv).toEqual({ ...phLS, ...lapLS });                      // union of keys; for shared keys the LAPTOP (first) value
    expect(laptop.kv()).toEqual(srvKv); expect(phone.kv()).toEqual(srvKv);
    expect(laptop.info().pending).toBe(0); expect(phone.info().pending).toBe(0);
    for (const k of ['ledger-gym-plan', 'ledger-gym-start', 'ledger-gym-skills', 'ledger-cardio', 'ledger-habit-view', `ledger-mobility-${TODAY}`]) expect(srvKv[k], k).toBe(lapLS[k]);
    expect(srvKv['ledger-mobility-2026-11-10']).toBe('{"done":["only-laptop"]}'); expect(srvKv['ledger-mobility-2026-11-12']).toBe('{"done":["only-phone"]}'); expect(srvKv['lt-journal-serif']).toBe('"1"');
    expect(rows.get('kv/ledger-gym-plan')!.version).toBe(1);           // written once, never overwritten
  });

  it('the rule depends on who syncs first (phone-first: the phone\'s values win), i.e. it is deterministic per arrival order, not per content', async () => {
    const { w, laptop, phone, phLS } = await bothDevices('phone-first');
    const rows = keyed(await serverRows(w.db, UID));
    expect(rows.get('kv/ledger-gym-plan')!.data.value).toBe(phLS['ledger-gym-plan']); expect(laptop.kv()['ledger-gym-plan']).toBe(phLS['ledger-gym-plan']);
    expect(phone.kv()).toEqual(laptop.kv());
  });

  it('FIXED FINDING-C: the losing device\'s value for a shared key is kept as a conflict entry', async () => {
    const { laptop, phone, w, phLS } = await bothDevices('laptop-first');
    const lost = phLS['ledger-gym-plan'];
    const everywhere = JSON.stringify([phone.info().conflicts, laptop.info().conflicts, (await serverRows(w.db, UID)).map((r) => r.data), [...phone.ls.values()]]);
    expect(everywhere).toContain('Push phone');                // recoverable from the conflict entry
    expect(phone.info().conflicts.filter((c) => c.collection === 'kv').length).toBeGreaterThan(0);
    void lost;
  });
  it('DESIRED: no key a user wrote on any device is lost (loser kept as a conflict entry or merged)', async () => {
    const { laptop, phone, w } = await bothDevices('laptop-first');
    const everywhere = JSON.stringify([phone.info().conflicts, laptop.info().conflicts, (await serverRows(w.db, UID)).map((r) => r.data)]);
    expect(everywhere).toContain('Push phone');
  });
});
