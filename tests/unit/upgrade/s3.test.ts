import { describe, it, expect } from 'vitest';
import { oldWorld, applyAllSql, UID, serverRows } from './world';
import { NewDevice } from './device';
import { LISTS } from './fixtures';
import { canon } from '../../../src/sync/merge';

async function laptopAndEmptyPhone() {
  const w = await oldWorld(); await applyAllSql(w.db);
  const laptop = await NewDevice.open('laptop', w.laptop.localStorageDump(w.legacy), w.db, UID, w.clock); await laptop.boot(); await laptop.sync();
  const seqAfterLaptop = Math.max(...(await serverRows(w.db, UID)).map((r) => r.seq)); const rowsAfterLaptop = await serverRows(w.db, UID);
  const phone = await NewDevice.open('phone', new Map(), w.db, UID, w.clock);   // fresh install / cleared browser: seed state only
  await phone.boot(); await phone.sync();
  return { w, laptop, phone, seqAfterLaptop, rowsAfterLaptop };
}

describe('S3: a phone with an EMPTY cache joins the upgraded account', () => {
  it('receives everything the laptop has, once, with nothing written back except what is intended', async () => {
    const { w, laptop, phone, rowsAfterLaptop } = await laptopAndEmptyPhone();
    for (const c of LISTS) {
      const L = laptop.byId(c), P = phone.byId(c);
      expect([...P.keys()].sort(), `${c} ids`).toEqual([...L.keys()].sort());
      expect(phone.list(c).length, `${c} dupes`).toBe(P.size);
      for (const [k, v] of L) expect(canon(P.get(k)), `${c}/${k}`).toBe(canon(v));
    }
    expect(phone.list('habitLogs')).toHaveLength(296); expect(phone.list('rejections')).toHaveLength(136); expect(phone.list('xp')).toHaveLength(210);
    expect(phone.kv()).toEqual(laptop.kv());                         // gym plan etc. reach the phone through kv
    expect(Object.keys(phone.kv())).toHaveLength(6);
    expect(phone.info().conflicts).toEqual([]);
    // the phone's seed (same ids as the laptop's originals) did not write anything to the server
    const after = await serverRows(w.db, UID);
    const prev = new Map(rowsAfterLaptop.map((r) => [`${r.collection}/${r.id}`, r]));
    const touched = after.filter((r) => { const p = prev.get(`${r.collection}/${r.id}`); return !p || p.version !== r.version; }).map((r) => `${r.collection}/${r.id}`);
    // only meta/settings may change: the phone legitimately advances settledThrough to ITS yesterday (monotonic max). No item is rewritten.
    expect(touched.filter((k) => k !== 'meta/settings'), 'phone join rewrote server rows').toEqual([]);
    expect(phone.info().pending).toBe(0);
    expect(phone.state.settings).toMatchObject({ theme: 'dark', wakeTime: '06:30', weekendWake: '08:00', name: 'Dinesh' });   // adopted the owner's settings, not the seed defaults
  });
});
