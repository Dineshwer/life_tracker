/* Performance / scale regression guards for the sync engine and the persisted-store cost model.
   Budgets are deliberately generous (CI machines are slow); the console.table output is the real measurement. */
import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { USER, world } from '../engine/harness';
import { metaKey } from '../../../src/sync/meta';
import { canon } from '../../../src/sync/merge';
import type { Item } from '../../../src/sync/types';

const uuid = (i: number) => `${(i + 0x10000000).toString(16)}-1111-4111-8111-${(i * 7919 + 0x100000000000).toString(16).slice(0, 12)}`;
const iso = (d: number) => new Date(Date.UTC(2026, 0, 1) + d * 864e5).toISOString().slice(0, 10);

/** n items spread over realistic collections */
function dataset(n: number): Record<string, Item[]> {
  const out: Record<string, Item[]> = { habitLogs: [], xp: [], tasks: [], journal: [], kv: [], workouts: [] };
  for (let i = 0; i < n; i++) {
    const k = i % 20;
    if (k < 9) out.habitLogs.push({ id: uuid(i), habitId: uuid(i % 14), date: iso(i % 365), level: 'full' });
    else if (k < 14) out.xp.push({ id: uuid(i), date: iso(i % 365), stat: 'discipline', amount: 10, reason: 'Habit: Morning mobility', ref: `habit:${uuid(i % 14)}:${iso(i % 365)}` });
    else if (k < 16) out.tasks.push({ id: uuid(i), title: `Task number ${i} with a normal sentence length`, done: i % 2 === 0, notes: 'some notes here' });
    else if (k < 17) out.journal.push({ id: uuid(i), date: iso(i % 365), kind: 'daily', body: 'x'.repeat(1800) });
    else if (k < 19) out.kv.push({ id: `mobility:${iso(i % 365)}:${i}`, value: '1' });
    else out.workouts.push({ id: uuid(i), date: iso(i % 365), name: 'Push', sets: Array.from({ length: 20 }, (_, s) => ({ id: uuid(s), exercise: 'Bench press', reps: 8, weight: 60, unit: 'kg' })) });
  }
  return out;
}
const bytes = (s: string) => Buffer.byteLength(s);
const ms = async (f: () => unknown | Promise<unknown>) => { const t = performance.now(); await f(); return +(performance.now() - t).toFixed(1); };

describe('perf: sync engine at scale', () => {
  const rows: Record<string, unknown>[] = [];
  for (const [n, budget] of [[1000, 5000], [5000, 15000], [20000, 60000]] as const) {
    it(`${n} items: first sync, no-op cycle, 50 pending, canon cost, blobs`, async () => {
      const w = world(); const data = dataset(n);
      const a = w.make('A', { initial: data });
      const heap0 = process.memoryUsage().heapUsed;
      const first = await ms(() => a.boot()); await a.syncUntilClean();
      const noop = await ms(() => a.sync());
      const noop2 = await ms(() => a.sync());
      for (let i = 0; i < 50; i++) a.update('tasks', data.tasks[i].id as string, { title: `edited ${i}` });
      const pend = await ms(() => a.syncUntilClean());
      // pendingCount() is what the engine runs on EVERY store change (keystroke path): items unchanged hit the canon WeakMap cache
      const pc = await ms(() => { for (let i = 0; i < 20; i++) a.engine.info(); }) / 20;
      // cold canon (no WeakMap hit): what a hash-free "re-serialise everything" would cost
      const cold = await ms(() => { for (const l of Object.values(data)) for (const it of l) canon(JSON.parse(JSON.stringify(it))); });
      const storeBlob = JSON.stringify({ state: Object.fromEntries(Object.entries(a.store.data)), version: 1 });
      const metaBlob = a.storage.getItem(metaKey(USER))!;
      const stringifyStore = await ms(() => { for (let i = 0; i < 5; i++) JSON.stringify({ state: a.store.data }); }) / 5;
      const heapMB = +((process.memoryUsage().heapUsed - heap0) / 1e6).toFixed(1);
      rows.push({ n, firstSyncMs: first, noopMs: noop, noop2Ms: noop2, pending50Ms: pend, infoMs: +pc.toFixed(2), coldCanonMs: cold, storeKB: Math.round(bytes(storeBlob) / 1024), metaKB: Math.round(bytes(metaBlob) / 1024), storeStringifyMs: +stringifyStore.toFixed(1), heapMB });
      expect(a.engine.info().pending).toBe(0);
      expect(first).toBeLessThan(budget); expect(noop2).toBeLessThan(budget / 5);
      expect(pend).toBeLessThan(budget / 2);
      expect(pc, 'info()/pendingCount runs on every store change: must stay cheap').toBeLessThan(n <= 5000 ? 50 : 250);
      // the metadata keeps a full canonical copy of every item (base): it must stay within ~1.6x of the store blob (guard against growth)
      expect(bytes(metaBlob)).toBeLessThan(bytes(storeBlob) * 1.6);
    }, 120_000);
  }
  it('prints the table', () => { console.table(rows); expect(rows.length).toBeGreaterThan(0); });
});

describe('perf: localStorage quota model (owner usage)', () => {
  /** one month of the owner's realistic use, as items */
  function month(m: number): Item[][] {
    const habitLogs: Item[] = [], xp: Item[] = [], journal: Item[] = [], kv: Item[] = [], workouts: Item[] = [], tasks: Item[] = [];
    for (let d = 0; d < 30; d++) {
      const date = iso(m * 30 + d);
      for (let h = 0; h < 14; h++) habitLogs.push({ id: `hl-${m}-${d}-${h}-${uuid(h)}`, habitId: uuid(h), date, level: 'full' });
      for (let x = 0; x < 10; x++) xp.push({ id: `xp-${m}-${d}-${x}-${uuid(x)}`, date, stat: 'discipline', amount: 10, reason: 'Habit: Morning mobility', ref: `habit:${uuid(x)}:${date}` });
      journal.push({ id: uuid(m * 30 + d), date, kind: 'daily', body: 'y'.repeat(2500), mood: 4, energy: 3 });
      for (let k = 0; k < 4; k++) kv.push({ id: `mob:${date}:${k}`, value: 'done' });
      if (d % 2 === 0) workouts.push({ id: uuid(d + m * 100), date, name: 'Push', sets: Array.from({ length: 18 }, (_, s) => ({ id: uuid(s), exercise: 'Bench press', reps: 8, weight: 60, unit: 'kg' })) });
      if (d % 3 === 0) tasks.push({ id: uuid(d + m * 1000), title: 'A task title of normal length', done: true });
    }
    return [habitLogs, xp, journal, kv, workouts, tasks];
  }
  it('months until the ~5M-char localStorage quota is hit (store blob + sync meta, which holds a second copy)', () => {
    const lists = month(0); const monthStore = JSON.stringify(lists).length;
    // meta copy: every item is stored again as canonical JSON string (escaped quotes inside a JSON string add ~6%)
    const metaPerMonth = lists.flat().reduce((s, it) => s + canon(it).length + 30, 0) * 1.06;
    const QUOTA = 5_000_000, photo = 400_000; // chars; photo = body.photo data URL, stored in store AND in meta.base
    const perMonth = monthStore + metaPerMonth;
    const monthsNoPhotos = QUOTA / perMonth;
    const perMonthWithPhoto = perMonth + 2 * photo;           // one photo a month at the 400 KB cap (store + meta copy)
    const perMonthWith05 = perMonth + 2 * photo * 0.5;        // a photo every other month
    console.table([{ storeKBperMonth: Math.round(monthStore / 1024), metaKBperMonth: Math.round(metaPerMonth / 1024), monthsNoPhotos: +monthsNoPhotos.toFixed(1), monthsPhotoMonthly: +(QUOTA / perMonthWithPhoto).toFixed(1), monthsPhotoEvery2: +(QUOTA / perMonthWith05).toFixed(1), monthsIfMetaWereHashes: +(QUOTA / (monthStore + lists.flat().length * 60)).toFixed(1) }]);
    expect(monthsNoPhotos).toBeGreaterThan(1); // sanity only; the number is the finding
    // 5 months of usage at 5 MB: a single 400 KB photo is 16% of the quota when duplicated
    expect(2 * photo / QUOTA).toBeCloseTo(0.16, 2);
  });
});

describe('perf: persist write cost on every store change', () => {
  it('JSON.stringify of a ~5 MB store, and a debounced writer collapses N changes into 1 write', async () => {
    const data = dataset(20000); const big = { state: data, version: 1 };
    let s = ''; const t = performance.now(); for (let i = 0; i < 5; i++) s = JSON.stringify(big);
    const per = (performance.now() - t) / 5;
    console.table([{ blobMB: +(s.length / 1e6).toFixed(2), stringifyMsDesktop: +per.toFixed(1), note: 'phones are ~4-8x slower; x per habit tap / store change' }]);
    expect(per).toBeLessThan(400);
    // model of the recommended fix: a trailing-debounced setItem
    let writes = 0; let timer: ReturnType<typeof setTimeout> | undefined; let latest = '';
    const setItem = (v: string) => { latest = v; if (timer) clearTimeout(timer); timer = setTimeout(() => { writes++; void latest; }, 50); };
    for (let i = 0; i < 100; i++) setItem('v' + i);
    await new Promise((r) => setTimeout(r, 120));
    expect(writes).toBe(1);
  });
});
