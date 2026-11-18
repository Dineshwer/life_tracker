/* Test harness for engine scenarios: in-memory store + storage, a controllable clock/timer scheduler, and "devices" sharing one FakeServer. */
import { expect } from 'vitest';
import { createSyncEngine } from '../../../src/sync/engine';
import { COLLECTIONS } from '../../../src/sync/types';
import type { ConflictEntry, Item, KeyValueStorage, StoreAdapter, SyncEngine } from '../../../src/sync/types';
import { FakeRemote, FakeServer } from '../fakeRemote';

/* the engine logs expected failures with console.warn('[sync] ...'): keep the test output readable (set SYNC_VERBOSE=1 to see them) */
if (!process.env.SYNC_VERBOSE) { const w0 = console.warn.bind(console); console.warn = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[sync]')) return; w0(...a); }; }
export const USER = '11111111-1111-4111-8111-111111111111';
export const flushMicrotasks = () => new Promise<void>(r => setImmediate(r));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Fake clock + timers shared by every device. Real promises still resolve normally; `advance` runs due timers in order. */
export class TestClock {
  t = Date.UTC(2026, 0, 1, 12, 0, 0);
  private timers: { id: number; at: number; fn: () => void }[] = []; private nextId = 1;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number): unknown => { const id = this.nextId++; this.timers.push({ id, at: this.t + Math.max(0, ms), fn }); return id; };
  clearTimeout = (h: unknown): void => { this.timers = this.timers.filter(x => x.id !== h); };
  pendingTimers() { return this.timers.length; }
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      await flushMicrotasks();
      const due = this.timers.filter(x => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter(x => x !== due); this.t = Math.max(this.t, due.at); due.fn();
    }
    this.t = end; await flushMicrotasks();
  }
}

export class MemStore implements StoreAdapter {
  data: Record<string, Item[]> = {}; private subs = new Set<() => void>();
  /* the engine's cache marker (src/sync/engine.ts MarkerCapable): lives next to the data, like the real store's persisted `syncCache` */
  private cacheMarker: { id: string; owner: string; gen: number; ready: boolean } | undefined;
  getMarker() { return this.cacheMarker; }
  setMarker(m: { id: string; owner: string; gen: number; ready: boolean } | undefined) { this.cacheMarker = m; }
  constructor(initial: Record<string, Item[]> = {}) { for (const c of COLLECTIONS) this.data[c] = []; for (const [c, v] of Object.entries(initial)) this.data[c] = clone(v); }
  /* like a zustand state: arrays are copied, items are shared and treated as immutable (the engine's canon() cache relies on identity) */
  read() { const o: Record<string, Item[]> = {}; for (const [c, v] of Object.entries(this.data)) o[c] = [...v]; return o; }
  write(patch: Record<string, Item[]>) { for (const [c, v] of Object.entries(patch)) this.data[c] = [...v]; this.notify(); }
  subscribe(cb: () => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  notify() { for (const s of [...this.subs]) s(); }
}
export class MemStorage implements KeyValueStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
/** a cross-tab mutex like navigator.locks */
export function makeMutex() {
  let tail: Promise<unknown> = Promise.resolve(); const stats = { calls: 0, active: 0, maxActive: 0 };
  const withLock = <T,>(_name: string, fn: () => Promise<T>): Promise<T> => {
    stats.calls++;
    const run = tail.then(async () => { stats.active++; stats.maxActive = Math.max(stats.maxActive, stats.active); try { return await fn(); } finally { stats.active--; } });
    tail = run.catch(() => {}); return run;
  };
  return { withLock, stats };
}

export interface DeviceOpts {
  server: FakeServer; clock: TestClock; name: string; user?: string; skewMs?: number;
  store?: MemStore; storage?: MemStorage; initial?: Record<string, Item[]>;
  validate?: (c: string, i: unknown) => boolean; withLock?: <T>(n: string, fn: () => Promise<T>) => Promise<T>;
}
export class Device {
  readonly remote: FakeRemote; readonly store: MemStore; readonly storage: MemStorage; readonly engine: SyncEngine;
  constructor(readonly o: DeviceOpts) {
    this.remote = new FakeRemote(o.server, o.user ?? USER, o.name);
    this.store = o.store ?? new MemStore(o.initial); this.storage = o.storage ?? new MemStorage();
    this.engine = createSyncEngine({
      remote: this.remote, store: this.store, storage: this.storage, userId: o.user ?? USER, deviceId: o.name,
      now: () => o.clock.now() + (o.skewMs ?? 0), setTimeout: o.clock.setTimeout, clearTimeout: o.clock.clearTimeout,
      withLock: o.withLock, validate: o.validate,
    });
  }
  get name() { return this.o.name; }
  /** start the engine and wait for its first sync */
  async boot() { this.engine.start(); await this.sync(); return this; }
  /** one full cycle; network errors are swallowed (they show up in info()) */
  async sync() { await this.engine.syncNow().catch(() => {}); await flushMicrotasks(); }
  /** sync repeatedly (advancing the clock over any backoff) until nothing is pending */
  async syncUntilClean(max = 12) { for (let i = 0; i < max; i++) { await this.sync(); if (this.engine.info().pending === 0 && this.engine.info().status !== 'error') return; await this.o.clock.advance(5 * 60_000); } }
  stop() { this.engine.stop(); }
  offline() { this.o.server.setOffline(this.name, true); }
  online() { this.o.server.setOffline(this.name, false); }
  /* local edits (what the UI does) */
  add(c: string, item: Item) { this.store.data[c] = [...this.store.data[c], clone(item)]; this.store.notify(); }
  addMany(c: string, items: Item[]) { this.store.data[c] = [...this.store.data[c], ...clone(items)]; this.store.notify(); }
  private idOf(c: string, it: Item) { return this.engine.idOf(c, it); }
  update(c: string, id: string, patch: Record<string, unknown>) {
    let hit = false; this.store.data[c] = this.store.data[c].map(it => { if (this.idOf(c, it) !== id) return it; hit = true; return { ...it, ...clone(patch) }; });
    if (!hit) throw new Error(`test bug: ${c}/${id} not in ${this.name}'s store`); this.store.notify();
  }
  remove(c: string, id: string) { this.store.data[c] = this.store.data[c].filter(it => this.idOf(c, it) !== id); this.store.notify(); }
  get(c: string, id: string): Item | undefined { return this.store.data[c].find(it => this.idOf(c, it) === id); }
  items(c: string) { return this.store.data[c]; }
  /** everything in the store as { collection: { id: item } } (empty collections omitted) */
  snapshot(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [c, list] of Object.entries(this.store.data)) for (const it of list) (out[c] ||= {})[this.idOf(c, it)] = it;
    return out;
  }
  conflicts(): ConflictEntry[] { return this.engine.info().conflicts; }
  /** a fresh device with the same identity but an EMPTY browser cache (new storage, new store) */
  wiped(): Device { return new Device({ ...this.o, store: undefined, storage: undefined, initial: undefined }); }
}

export function world(opts: { skew?: Record<string, number> } = {}) {
  const server = new FakeServer(); const clock = new TestClock(); server.clock = clock.now;
  const make = (name: string, o: Partial<DeviceOpts> = {}) => new Device({ server, clock, name, skewMs: opts.skew?.[name], ...o });
  return { server, clock, make, user: USER };
}

/** sync every device until the server and all devices stop changing */
export async function converge(devs: Device[], clock: TestClock, server: FakeServer, rounds = 15) {
  for (const d of devs) { d.online(); }
  server.restoreRealtime();
  let last = -1, stable = 0;
  for (let i = 0; i < rounds; i++) {
    for (const d of devs) await d.syncUntilClean();
    await clock.advance(60_000);
    if (server.seq === last) { if (++stable >= 2) break; } else { stable = 0; last = server.seq; }
  }
}
/** every device's data == the server's live data, no duplicate ids, nothing pending */
export function expectConverged(devs: Device[], server: FakeServer, user = USER, ctx = '') {
  const srv = server.liveData(user);
  for (const d of devs) {
    for (const c of Object.keys(d.store.data)) {
      const ids = d.store.data[c].map(it => d.engine.idOf(c, it));
      expect(new Set(ids).size, `${ctx} duplicate ids in ${d.name}/${c}`).toBe(ids.length);
    }
    const snap = d.snapshot();
    expect(snap, `${ctx} device ${d.name} differs from server`).toEqual(srv);
    expect(d.engine.info().pending, `${ctx} ${d.name} still has pending changes`).toBe(0);
  }
}
export const task = (id: string, extra: Record<string, unknown> = {}): Item => ({ id, title: `title ${id}`, done: false, ...extra });
