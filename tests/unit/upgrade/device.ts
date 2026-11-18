/* A "new client" device for the upgrade tests: the REAL zustand store (src/store.ts, rehydrated from a localStorage dump through the real
   persist migrate/merge chain), the REAL storeAdapter, the REAL migrateLegacyPrefs, and the REAL sync engine over the PGlite-backed Remote.
   Each device gets its own module graph (vi.resetModules) and its own localStorage map. `globalThis.localStorage` is a switchboard to the
   ACTIVE device; every public method activates its device first, and the tests never run two devices concurrently. */
import { vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createSyncEngine, type SyncEngineExt } from '../../../src/sync/engine';
import { validateItem } from '../../../src/lib/validate';
import { PgliteRemote } from '../pgliteRemote';
import { TestClock, flushMicrotasks } from '../engine/harness';
import { asAdmin } from '../db/harness';

let active = new Map<string, string>();
const shim = {
  getItem: (k: string) => (active.has(k) ? active.get(k)! : null), setItem: (k: string, v: string) => { active.set(k, String(v)); }, removeItem: (k: string) => { active.delete(k); },
  key: (i: number) => [...active.keys()][i] ?? null, get length() { return active.size; }, clear: () => active.clear(),
};
Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true, writable: true });
if (!process.env.SYNC_VERBOSE) { const w0 = console.warn.bind(console); console.warn = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[sync]')) return; w0(...a); }; }

export interface Row { collection: string; id: string; data: any; deleted: boolean; version: number; seq: number }
export async function serverRows(db: PGlite, uid: string): Promise<Row[]> {
  const a = asAdmin(db);
  const has = (await a.query<any>(`select 1 from information_schema.columns where table_schema='public' and table_name='records' and column_name='seq'`)).length > 0;
  return a.query<any>(`select collection, id, data, deleted, ${has ? 'version::int' : '0'} as version, ${has ? 'seq::int' : '0'} as seq from public.records where user_id = $1 order by collection, id`, [uid]);
}
export const keyed = (rows: Row[]) => new Map(rows.map((r) => [`${r.collection}/${r.id}`, r]));

export class NewDevice {
  engine!: SyncEngineExt; store: any; adapter: any; synced: any; remote!: PgliteRemote;
  readonly metaStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
  constructor(readonly name: string, readonly ls: Map<string, string>, readonly db: PGlite, readonly uid: string, readonly clock: TestClock) {
    this.metaStorage = { getItem: (k) => (ls.has(k) ? ls.get(k)! : null), setItem: (k, v) => { ls.set(k, v); }, removeItem: (k) => { ls.delete(k); } };
  }
  activate() { active = this.ls; }
  /** "open the new app": import the store (rehydrate + migrate), run migrateLegacyPrefs like main.tsx, build the engine. Does not start it. */
  static async open(name: string, ls: Map<string, string>, db: PGlite, uid: string, clock: TestClock, opts: { remote?: PgliteRemote } = {}) {
    const d = new NewDevice(name, ls, db, uid, clock); d.activate(); vi.resetModules();
    const store = await import('../../../src/store'); const ad = await import('../../../src/lib/storeAdapter'); const sy = await import('../../../src/lib/synced');
    d.store = store.useStore; d.adapter = ad.zustandStoreAdapter(); d.synced = sy; sy.migrateLegacyPrefs();
    d.remote = opts.remote ?? new PgliteRemote(db, uid);
    d.engine = createSyncEngine({ remote: d.remote, store: d.adapter, storage: d.metaStorage, userId: uid, deviceId: name, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, validate: (c, it) => validateItem(c, it) });
    return d;
  }
  get state(): any { this.activate(); return this.store.getState(); }
  list(c: string): any[] { return this.state[c]; }
  kv(): Record<string, string> { return Object.fromEntries(this.state.kv.map((x: any) => [x.id, x.value])); }
  async boot() { this.activate(); this.engine.start(); await this.sync(); return this; }
  async sync() { this.activate(); await this.engine.syncNow().catch(() => {}); await flushMicrotasks(); }
  async syncUntilClean(max = 8) { for (let i = 0; i < max; i++) { await this.sync(); const inf = this.info(); if (inf.pending === 0 && inf.status !== 'error') return; await this.clock.advance(5 * 60_000); } }
  info() { this.activate(); return this.engine.info(); }
  stop() { this.activate(); this.engine.stop(); }
  set(patch: Record<string, unknown>) { this.activate(); this.store.setState(patch); }
  /** items by id per collection (wake by date) for comparisons */
  byId(c: string): Map<string, any> { return new Map(this.list(c).map((it: any) => [c === 'wake' ? `wake:${it.date}` : it.id, it])); }
}
