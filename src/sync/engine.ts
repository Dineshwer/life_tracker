import { COLLECTIONS, LIMITS } from './types';
import type { ConflictEntry, EngineDeps, Item, PushItem, PushResult, RemoteRow, StoreAdapter, SyncEngine, SyncInfo, SyncStatus } from './types';
import { coerceItem } from '../lib/validate';
import { canon, diffFields, mergeThreeWay, same } from './merge';
import type { Obj as ObjT } from './merge';
import type { Obj } from './merge';
import { loadLegacy, loadMeta, legacyKey, MAX_CONFLICTS, emptyMeta, metaKey, saveMeta, toBase, isHashBase } from './meta';
import type { MetaBlob, QuarantineEntry } from './meta';

/* The sync engine. See src/sync/README.md for the algorithm and invariants.
   Everything that reads the local store and mutates it happens inside ONE synchronous block (no await in between), so a user edit can
   never be overwritten by a stale snapshot. Network calls are the only awaits. */

const PAGE = 1000;
const OVERLAP = 50;               // re-pull this many seq values behind the cursor: concurrent transactions can commit out of seq order
const MAX_PUSH_ROUNDS = 5;        // push -> merge -> push again, bounded
const MAX_ROUNDS = 4;             // push+pull rounds per cycle
const DEBOUNCE_MS = 600;
const POLL_LIVE_MS = 60_000;     // safety net while realtime is live (realtime is at-most-once: no replay)
const FOLLOW_UP_MS = 2500;       // after pushing / recovering: pick up writes by other devices that landed during our window
const POLL_DOWN_MS = 20_000;
const BACKOFF_MIN = 1000;
const BACKOFF_MAX = 5 * 60_000;
const FLUSH_TIMEOUT_MS = 30_000;
const COLLECTION_SET: ReadonlySet<string> = new Set(COLLECTIONS);

const keyOf = (col: string, id: string) => `${col}/${id}`;
const splitKey = (k: string): [string, string] => { const i = k.indexOf('/'); return [k.slice(0, i), k.slice(i + 1)]; };
const DELETED = '\u0000deleted';
const bc = (x: unknown): string => toBase(canon(x));
const newId = (): string => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

export interface QuarantineView { invalidRows: QuarantineEntry[]; rejected: { key: string; reason: string; at: string }[] }
export interface SyncInfoExt extends SyncInfo { warning?: string; quarantined: number; pullMode?: 'rpc' | 'table' }
/** EngineDeps plus an optional `coerce`: cut oversized free text of rows coming from the server (old data valid for the old client) instead of quarantining them. */
export type EngineDepsExt = EngineDeps & { coerce?: (collection: string, item: Item) => Item };
export interface SyncEngineExt extends SyncEngine { quarantine(): QuarantineView; info(): SyncInfoExt }

/** The cache marker lives NEXT TO the persisted store (not in the synced data). It proves that the store content and the sync metadata belong together:
    id = epoch of the cache, owner = user id, gen = a counter bumped whenever the engine writes the store or is about to push (so a persisted store
    that lags behind the metadata is detected after a reload), ready = the first full pull finished. Stores that do not implement it simply skip the checks. */
export interface CacheMarker { id: string; owner: string; gen: number; ready: boolean }
export interface MarkerCapable { getMarker(): CacheMarker | undefined; setMarker(m: CacheMarker | undefined): void }
const MAX_CONFLICT_COPY = 8192;

/** Errors that mean "sign in again" (expired/invalid session). */
export function isAuthError(e: unknown): boolean {
  const o = e as { name?: string; status?: number; code?: string; message?: string } | null;
  if (!o) return false;
  return o.name === 'AuthError' || o.status === 401 || o.code === 'PGRST301' || /jwt|not authenticated|invalid token|refresh token/i.test(String(o.message ?? ''));
}
function describeError(e: unknown): string {
  if (isAuthError(e)) return 'Your session expired. Sign in again to keep syncing.';
  const m = (e as { message?: string } | null)?.message ?? String(e);
  if (/failed to fetch|networkerror|load failed|network request failed|fetch/i.test(m)) return 'Could not reach the server. Changes are kept on this device and will upload when it is reachable.';
  return m || 'Sync failed.';
}

/** The identity of an item inside its collection. */
export function idOf(collection: string, item: Item): string {
  if (collection === 'wake') return `wake:${item.date}`;
  if (collection === 'meta') return 'settings';
  return String(item.id);
}

type LocalMap = Map<string, Item>;
interface Pending { key: string; col: string; id: string; item: Item | null; v: number }

export function createSyncEngine(deps: EngineDepsExt): SyncEngineExt {
  const { remote, store, storage, userId, deviceId } = deps;
  const coerce = deps.coerce ?? coerceItem;
  const now = deps.now ?? (() => Date.now());
  const setT = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const withLock = deps.withLock ?? (<T,>(_n: string, fn: () => Promise<T>) => fn());
  const validate = deps.validate ?? ((_c: string, it: unknown) => !!it && typeof it === 'object' && !Array.isArray(it));

  let meta: MetaBlob = emptyMeta();
  let started = false;
  let status: SyncStatus = 'off';
  let live = false;
  let errorMsg: string | undefined;
  let failures = 0;
  let timer: unknown;       // next poll / retry
  let debounce: unknown;
  let unsubStore: (() => void) | undefined;
  let unsubRemote: (() => void) | undefined;
  let running: Promise<void> | null = null;
  let rerun = false;
  let followUpsLeft = 0;
  let lastPending = -1;
  let pushedInCycle = false;
  const listeners = new Set<(i: SyncInfo) => void>();

  const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
  const mk = store as StoreAdapter & Partial<MarkerCapable>;
  const hasMarker = typeof mk.getMarker === 'function' && typeof mk.setMarker === 'function';
  let trusted = false;      // the local store has been synced with before (marker ready): differing unconfirmed items are real edits, not seed data
  let storageFull = false;
  const inflight = new Map<string, string>(); // key -> bc(pushed item) | DELETED, for the push RPCs in flight (own-echo detection)
  const save = () => { storageFull = !saveMeta(storage, userId, meta); };

  /** Bump the store generation and stamp it into the marker (call AFTER the store writes it covers, BEFORE saving the meta). */
  function bumpGen(ready?: boolean) {
    if (!hasMarker) return;
    meta.storeGen += 1;
    const m = mk.getMarker!();
    mk.setMarker!({ id: meta.cacheId ?? m?.id ?? newId(), owner: userId, gen: meta.storeGen, ready: ready ?? m?.ready ?? meta.initialized });
  }
  function wipeStore() {
    const empty: Record<string, Item[]> = {};
    for (const col of COLLECTIONS) empty[col] = [];
    store.write(empty);
  }
  /** Start-up check that the store content and the sync metadata belong together (see CacheMarker). */
  function reconcileCache() {
    if (!hasMarker) return;
    let m = mk.getMarker!();
    if (m && m.owner !== userId) { console.warn('[sync] the local data belongs to another account: clearing it'); wipeStore(); mk.setMarker!(undefined); m = undefined; }
    trusted = !!m?.ready;
    const recover = (reason: string, forgetAll: boolean) => {
      console.warn('[sync] local cache does not match the sync metadata (' + reason + '): rebuilding from the server');
      const local = readLocal();
      for (const [key, it] of Object.entries(meta.items)) if (forgetAll || (it.base !== null && !local.has(key))) delete meta.items[key];
      meta.seq = 0; meta.initialized = false; meta.cacheId = newId();
      mk.setMarker!({ id: meta.cacheId, owner: userId, gen: meta.storeGen, ready: false });
    };
    if (!m) {
      if (meta.cacheId === undefined) { meta.cacheId = newId(); mk.setMarker!({ id: meta.cacheId, owner: userId, gen: meta.storeGen, ready: meta.initialized }); }
      else recover('the store lost its marker', false);
    } else if (meta.cacheId === undefined) { meta.cacheId = m.id; meta.storeGen = Math.max(meta.storeGen, m.gen); }
    else if (m.id !== meta.cacheId) recover('different cache epoch', false);
    else if (m.gen < meta.storeGen) recover('the persisted store is older than the metadata', true);
    else meta.storeGen = Math.max(meta.storeGen, m.gen);
    save();
  }

  /* ---------- local snapshot ---------- */
  function readLocal(): LocalMap {
    const all = store.read(); const out: LocalMap = new Map();
    for (const col of COLLECTIONS) for (const it of all[col] ?? []) {
      if (col !== 'wake' && col !== 'meta' && (it.id === undefined || it.id === null)) continue; // unaddressable: cannot sync
      if (col === 'wake' && !it.date) continue;
      out.set(keyOf(col, idOf(col, it)), it);
    }
    return out;
  }

  /** Pending = local item differs from its confirmed base, never-confirmed local items, and confirmed items that vanished locally. */
  function computePending(local: LocalMap = readLocal()): Pending[] {
    const out: Pending[] = [];
    for (const [key, item] of local) {
      const m = meta.items[key]; const [col, id] = splitKey(key);
      if (m && m.base !== null && bc(item) === m.base) continue;
      const rej = meta.rejected[key];
      if (rej) { if (rej.json === bc(item)) continue; delete meta.rejected[key]; }
      out.push({ key, col, id, item, v: m?.v ?? 0 });
    }
    for (const [key, m] of Object.entries(meta.items)) {
      if (m.base === null || local.has(key)) continue;
      const rej = meta.rejected[key];
      if (rej && rej.json === DELETED) continue;
      const [col, id] = splitKey(key);
      out.push({ key, col, id, item: null, v: m.v });
    }
    return out;
  }
  const pendingCount = () => computePending().length;

  /* ---------- info / status ---------- */
  function info(): SyncInfoExt {
    const i: SyncInfoExt = { status, live, lastSyncAt: meta.lastSyncAt, pending: started ? pendingCount() : 0, error: errorMsg, conflicts: meta.conflicts, deviceId, quarantined: Object.keys(meta.quarantine).length + Object.keys(meta.rejected).length };
    const pm = (remote as { pullMode?: () => 'rpc' | 'table' | undefined }).pullMode?.(); if (pm) i.pullMode = pm;
    if (storageFull) i.warning = 'Browser storage is full: sync bookkeeping could not be saved on this device. Free some space; your data is safe in the cloud.';
    return i;
  }
  function emit() { if (listeners.size) { const i = info(); lastPending = i.pending; listeners.forEach((l) => l(i)); } }
  function setStatus(s: SyncStatus, err?: string) { status = s; errorMsg = err; emit(); }
  /** Conflict entries keep the losing value so it can be restored; very large copies are cut (marked `_truncated`) to protect the storage quota. */
  const clip = (v: unknown): unknown => {
    if (v === undefined) return v;
    const c = canon(v);
    return c.length > MAX_CONFLICT_COPY ? { _truncated: true, bytes: c.length, preview: c.slice(0, 200) } : v;
  };
  function addConflict(e: Omit<ConflictEntry, 'at'>) {
    e = { ...e, local: clip(e.local), remote: clip(e.remote) };
    meta.conflicts = [{ at: new Date(now()).toISOString(), ...e }, ...meta.conflicts].slice(0, MAX_CONFLICTS);
  }
  function rejectedMessage(): string | undefined {
    const n = Object.keys(meta.rejected).length;
    if (!n) return undefined;
    const first = Object.values(meta.rejected)[0].reason;
    return `${n} item${n === 1 ? ' was' : 's were'} refused by the server and not synced: ${first}`;
  }

  /* ---------- applying server rows to the local store (synchronous, the heart of the merge) ---------- */
  interface ApplyCtx { src: 'pull' | 'push'; initial: boolean; legacy?: Map<string, string>; local: LocalMap; changes: Map<string, Item | null> }
  const setLocal = (c: ApplyCtx, key: string, item: Item | null) => { c.changes.set(key, item); if (item) c.local.set(key, item); else c.local.delete(key); };
  /** The old client stored settings WITHOUT an id: the id of the single settings item is fixed, so inject it. */
  const withMetaId = (col: string, data: unknown): unknown => (col === 'meta' && data && typeof data === 'object' && !Array.isArray(data) && (data as ObjT).id === undefined ? { ...(data as ObjT), id: 'settings' } : data);
  const coerceData = (col: string, data: unknown): unknown => (data && typeof data === 'object' && !Array.isArray(data) ? coerce(col, data as Item) : data);
  const baseOf = (c: ApplyCtx, key: string): string | null | undefined => {
    const m = meta.items[key];
    if (m) return m.base;
    if (c.initial && c.legacy?.has(key)) { try { return bc(withMetaId(key.slice(0, key.indexOf('/')), JSON.parse(c.legacy.get(key)!) as unknown)); } catch { return undefined; } }
    return undefined;
  };
  const confirm = (key: string, v: number, base: string | null, seq?: number) => { meta.items[key] = seq === undefined ? { v, base } : { v, base, s: seq }; };

  function applyRow(rawRow: RemoteRow, c: ApplyCtx): void {
    if (!COLLECTION_SET.has(rawRow.collection)) return;
    const row: RemoteRow = rawRow.deleted ? rawRow : { ...rawRow, data: coerceData(rawRow.collection, withMetaId(rawRow.collection, rawRow.data)) };
    const key = keyOf(row.collection, row.id);
    const known = meta.items[key];
    if (c.src === 'pull' && known && row.version <= known.v && !(known.s !== undefined && row.seq > known.s)) return; // already known (own echo, overlap re-pull, duplicate realtime)
    // the echo of a write that is still in flight: the server now holds EXACTLY what we pushed, so that is the new base (never a "remote change")
    const inf = inflight.get(key);
    if (c.src === 'pull' && inf !== undefined && (row.deleted ? inf === DELETED : inf === bc(row.data))) {
      confirm(key, row.version, row.deleted ? null : inf, row.seq); return;
    }
    const cur = c.local.get(key);
    const base = baseOf(c, key);

    if (row.deleted) {
      if (row.collection === 'meta') return; // settings are never deleted
      if (!cur) { if (known) confirm(key, row.version, null, row.seq); delete meta.quarantine[key]; return; }
      if (typeof base !== 'string') {
        // a local item the server never confirmed
        if (known) { confirm(key, row.version, null, row.seq); return; }   // we re-created it after a delete: keep, it is pushed next
        if (c.src === 'push') { confirm(key, row.version, null, row.seq); return; } // intentional re-create of a deleted id: push it again on top of the tombstone
        setLocal(c, key, null); return;                            // pull: tombstone wins over a seed/cache copy
      }
      setLocal(c, key, null); confirm(key, row.version, null, row.seq);
      if (bc(cur) !== base) addConflict({ collection: row.collection, id: row.id, kind: 'deleted-remotely', local: cur });
      return;
    }

    // live row: validate first. Invalid rows are quarantined and never applied.
    const bad = !validate(row.collection, row.data) || idOf(row.collection, row.data as Item) !== row.id ? 'failed validation' : undefined;
    if (bad) {
      meta.quarantine[key] = { key, version: row.version, reason: bad, at: new Date(now()).toISOString() };
      if (c.src === 'push' && known) known.v = row.version; // the server copy is unusable: let our next push overwrite it
      console.warn('[sync] skipped invalid row', key, bad);
      return;
    }
    delete meta.quarantine[key];
    const data = row.data as Item; const rb = bc(data);

    if (!cur) {
      if (typeof base === 'string') {
        if (rb === base) { confirm(key, row.version, base, row.seq); return; }  // unchanged on the server: our deletion stays pending
        setLocal(c, key, data); confirm(key, row.version, rb, row.seq);          // edited remotely while deleted locally: the edit wins
        addConflict({ collection: row.collection, id: row.id, kind: 'deleted-locally', remote: data });
        return;
      }
      setLocal(c, key, data); confirm(key, row.version, rb, row.seq); return;
    }
    const lb = bc(cur);
    if (lb === rb) { confirm(key, row.version, rb, row.seq); return; }
    if (typeof base !== 'string') {
      // never confirmed: the server copy wins (seed data must not overwrite real data). On a store that was never synced the local copy is
      // just seed/cache and this is silent; on a store that was synced before (or later in the session) it is a real edit: keep it in the log.
      if (trusted || !c.initial || row.collection === 'kv') addConflict({ collection: row.collection, id: row.id, kind: 'server-won', fields: diffFields(cur, data), local: cur, remote: data });
      else console.debug('[sync] adopted the server copy over an unconfirmed local item', key, diffFields(cur, data));
      setLocal(c, key, data); confirm(key, row.version, rb, row.seq);
      return;
    }
    if (lb === base) { setLocal(c, key, data); confirm(key, row.version, rb, row.seq); return; } // no local change: take the server copy
    if (isHashBase(base)) {
      // big item: only a hash of the base is kept, so merge at item level: both sides changed, the server copy wins, the local copy stays recoverable
      setLocal(c, key, data); confirm(key, row.version, rb, row.seq);
      addConflict({ collection: row.collection, id: row.id, kind: 'server-won', fields: diffFields(cur, data), local: cur, remote: data });
      return;
    }
    const m = mergeThreeWay(JSON.parse(base) as unknown, cur, data);
    const mergedItem = m.merged as Item;
    if (bc(mergedItem) !== lb) setLocal(c, key, mergedItem);
    confirm(key, row.version, rb, row.seq); // base = server copy; the merged item differs from it, so it is pending and pushed next
    if (m.conflicts.length) addConflict({ collection: row.collection, id: row.id, kind: 'server-won', fields: m.conflicts, local: cur, remote: data });
  }

  /** Write the accumulated changes to the store as whole-collection replacements. Call in the same tick as readLocal. */
  function flushChanges(c: ApplyCtx) {
    if (!c.changes.size) return;
    const all = store.read(); const patch: Record<string, Item[]> = {};
    const byCol = new Map<string, Map<string, Item | null>>();
    for (const [key, item] of c.changes) { const [col, id] = splitKey(key); if (!byCol.has(col)) byCol.set(col, new Map()); byCol.get(col)!.set(id, item); }
    for (const [col, ch] of byCol) {
      const out: Item[] = []; const seen = new Set<string>();
      for (const it of all[col] ?? []) {
        const id = idOf(col, it); seen.add(id);
        if (ch.has(id)) { const n = ch.get(id); if (n) out.push(n); } else out.push(it);
      }
      for (const [id, n] of ch) if (!seen.has(id) && n) out.push(n);
      patch[col] = out;
    }
    store.write(patch);
    bumpGen();
  }

  function applyRows(rows: RemoteRow[], src: 'pull' | 'push', initial = false, legacy?: Map<string, string>) {
    const c: ApplyCtx = { src, initial, legacy, local: readLocal(), changes: new Map() };
    for (const r of rows) applyRow(r, c);
    flushChanges(c);
  }

  /* ---------- pull ---------- */
  async function pullAll(initial: boolean) {
    const legacy = initial ? loadLegacy(storage, userId) : undefined;
    let since = Math.max(0, meta.seq - OVERLAP);
    for (;;) {
      const rows = await remote.pull(since, PAGE);
      applyRows(rows, 'pull', initial, legacy);
      const maxSeq = rows.reduce((m, r) => Math.max(m, r.seq), 0);
      meta.seq = Math.max(meta.seq, maxSeq); // advance only after applying
      save();
      if (rows.length < PAGE) break;
      since = maxSeq;
    }
    if (initial) {
      meta.initialized = true; try { storage.removeItem(legacyKey(userId)); } catch { /* ignore */ }
      if (hasMarker) { const m = mk.getMarker!(); if (m && !m.ready) mk.setMarker!({ ...m, ready: true }); }
      trusted = true; save();
    }
  }

  /* ---------- push ---------- */
  const toPushItem = (p: Pending): PushItem => p.item
    ? { collection: p.col, id: p.id, data: p.item, deleted: false, base_version: p.v }
    : { collection: p.col, id: p.id, data: {}, deleted: true, base_version: p.v };

  function handleResults(batch: Pending[], results: PushResult[]): boolean {
    const byKey = new Map(results.map((r) => [keyOf(r.collection, r.id), r]));
    const c: ApplyCtx = { src: 'push', initial: false, local: readLocal(), changes: new Map() };
    let conflicts = false;
    for (const p of batch) {
      const r = byKey.get(p.key);
      if (!r) throw new Error('The server returned an incomplete push result.');
      switch (r.status) {
        case 'ok': {
          if (!r.row) throw new Error('The server accepted a change without returning its row.');
          const m = meta.items[p.key];
          if (!m || r.row.version >= m.v) confirm(p.key, r.row.version, p.item ? bc(p.item) : null, r.row.seq);
          delete meta.rejected[p.key];
          break;
        }
        case 'conflict': {
          const row = r.row; if (!row) throw new Error('The server reported a conflict without returning its row.');
          // idempotent retry: the "conflict" is our own earlier write if the server row already has our data
          if (p.item && !row.deleted && same(row.data, p.item)) { confirm(p.key, row.version, bc(p.item), row.seq); break; }
          if (!p.item && row.deleted) { confirm(p.key, row.version, null, row.seq); break; }
          conflicts = true;
          {
            // no-progress guard: a conflict that changes neither the local item nor what we know about the server would loop forever
            applyRow(row, c);
            const m = meta.items[p.key];
            if ((m?.v ?? 0) === p.v && bc(c.local.get(p.key) ?? null) === bc(p.item ?? null)) {
              meta.rejected[p.key] = { json: p.item ? bc(p.item) : DELETED, reason: 'could not be reconciled with the server copy', at: new Date(now()).toISOString() };
            }
          }
          break;
        }
        case 'gone': {
          // the server no longer has the item (its tombstone was purged). An edited item is re-created (pushed as new); an unedited one is dropped.
          const cur = c.local.get(p.key); delete meta.rejected[p.key];
          if (cur && p.item) {
            addConflict({ collection: p.col, id: p.id, kind: 'deleted-remotely', local: cur });
            meta.items[p.key] = { v: 0, base: null };
          } else {
            if (cur) { setLocal(c, p.key, null); addConflict({ collection: p.col, id: p.id, kind: 'deleted-remotely', local: cur }); }
            delete meta.items[p.key];
          }
          break;
        }
        case 'rejected':
          meta.rejected[p.key] = { json: p.item ? bc(p.item) : DELETED, reason: r.reason ?? 'rejected', at: new Date(now()).toISOString() };
          console.warn('[sync] server rejected', p.key, r.reason);
          break;
      }
    }
    flushChanges(c);
    return conflicts;
  }

  async function pushPending() {
    for (let round = 0; round < MAX_PUSH_ROUNDS; round++) {
      // stamp a new store generation BEFORE the snapshot: a persisted store older than this stamp is detected after a reload (never read as "deleted")
      if (hasMarker && computePending().length) bumpGen();
      const pend = computePending(readLocal());
      if (!pend.length) return;
      let anyConflict = false; pushedInCycle = true;
      for (let i = 0; i < pend.length; i += LIMITS.maxBatch) {
        const batch = pend.slice(i, i + LIMITS.maxBatch);
        save(); // the generation stamp is durable before the write happens
        for (const p of batch) inflight.set(p.key, p.item ? bc(p.item) : DELETED);
        try {
          const results = await remote.push(batch.map(toPushItem), deviceId);
          if (handleResults(batch, results)) anyConflict = true;
        } finally { for (const p of batch) inflight.delete(p.key); }
        save();
      }
      if (!anyConflict && !computePending().length) return;
    }
  }

  /* ---------- cycle ---------- */
  async function cycle(): Promise<boolean> {
    if (!started) return true;
    if (isOffline()) { setStatus('offline'); schedulePoll(); return true; }
    const recovered = failures > 0 || status === 'error' || status === 'offline';
    pushedInCycle = false;
    setStatus('syncing');
    try {
      await withLock(`ledger-sync-${userId}`, async () => {
        // another tab may have advanced the metadata
        // (only when OUR store is in step with that metadata: same cache epoch and generation; otherwise our in-memory metadata matches our store better)
        try {
          const raw = storage.getItem(metaKey(userId));
          if (raw) {
            const stored = JSON.parse(raw) as MetaBlob; const m = hasMarker ? mk.getMarker!() : undefined;
            if (stored.rev > meta.rev && (!hasMarker || (m && m.id === stored.cacheId && m.gen === stored.storeGen))) meta = loadMeta(storage, userId);
          }
        } catch { /* ignore */ }
        if (!meta.initialized) await pullAll(true);
        for (let round = 0; round < MAX_ROUNDS; round++) {
          await pushPending();
          await pullAll(false);
          if (!pendingCount()) break;
        }
      });
      failures = 0;
      meta.lastSyncAt = new Date(now()).toISOString(); save();
      const rej = rejectedMessage();
      setStatus(rej ? 'error' : 'synced', rej);
      if (pendingCount() > 0 && !rej) scheduleRetry(5000);
      else if ((recovered || pushedInCycle) && followUpsLeft > 0) { followUpsLeft--; scheduleRetry(FOLLOW_UP_MS); }
      else schedulePoll();
      return true;
    } catch (e) {
      failures++;
      const delay = Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** (failures - 1)) * (0.5 + Math.random() * 0.5);
      if (isOffline()) setStatus('offline'); else setStatus('error', describeError(e));
      if (!isAuthError(e)) console.warn('[sync] cycle failed', e);
      scheduleRetry(delay);
      return false;
    }
  }

  function clearTimer() { if (timer !== undefined) { clearT(timer); timer = undefined; } }
  function scheduleRetry(ms: number) { clearTimer(); if (started) timer = setT(() => { timer = undefined; void run(); }, ms); }
  function schedulePoll() { scheduleRetry(live ? POLL_LIVE_MS : POLL_DOWN_MS); }

  function run(): Promise<void> {
    if (running) { rerun = true; return running; }
    running = (async () => {
      try { let ok = true; do { rerun = false; ok = await cycle(); } while (rerun && started && ok); }
      finally { running = null; }
    })();
    return running;
  }

  /* ---------- public API ---------- */
  function onLocalChange() {
    if (!started) return;
    if (listeners.size) { const p = pendingCount(); if (p !== lastPending) emit(); } // keep subscribers' pending count current
    if (debounce !== undefined) clearT(debounce);
    debounce = setT(() => {
      debounce = undefined;
      if (!started) return;
      if (pendingCount() > 0) { followUpsLeft = 2; void run(); }
    }, DEBOUNCE_MS);
  }

  const engine: SyncEngineExt = {
    start() {
      if (started) return;
      started = true; meta = loadMeta(storage, userId); reconcileCache(); setStatus('syncing');
      unsubStore = store.subscribe(onLocalChange);
      unsubRemote = remote.subscribe(
        (row) => {
          if (!started || !meta.initialized) return; // the initial pull covers it
          applyRows([row], 'pull'); save(); emit();
          if (pendingCount() > 0) onLocalChange();
        },
        (s) => {
          const was = live; live = s === 'live';
          if (was === live) return;
          emit();
          // realtime has no replay: whenever it comes (back) up, catch up with a full pull right away
          if (live && started && meta.initialized) { followUpsLeft = 1; if (!running) clearTimer(); void run(); }
          else if (!running && started) schedulePoll();
        },
      );
      void run();
    },
    stop() {
      started = false; clearTimer();
      if (debounce !== undefined) { clearT(debounce); debounce = undefined; }
      unsubStore?.(); unsubRemote?.(); unsubStore = unsubRemote = undefined;
      live = false; setStatus('off');
    },
    syncNow() { failures = 0; followUpsLeft = 2; if (started) clearTimer(); return run(); },
    async flush() {
      const attempt = async () => {
        for (let i = 0; i < MAX_ROUNDS; i++) {
          await engine.syncNow();
          if (pendingCount() === 0) return;
          if (status === 'offline' || status === 'error') throw new Error(errorMsg ?? 'Not connected: changes are saved on this device.');
        }
        throw new Error('Some changes could not be uploaded yet.');
      };
      let t: unknown;
      const timeout = new Promise<never>((_, rej) => { t = setT(() => rej(new Error('Timed out waiting for the upload.')), FLUSH_TIMEOUT_MS); });
      try { await Promise.race([attempt(), timeout]); } finally { clearT(t); }
    },
    info,
    subscribe(cb) { listeners.add(cb); cb(info()); return () => { listeners.delete(cb); }; },
    async resetLocalCache() {
      if (!started) throw new Error('Sync is not running.');
      await engine.flush().catch((e: unknown) => { throw new Error(`Not reset, because some changes have not reached the server yet. ${(e as Error).message}`); });
      await withLock(`ledger-sync-${userId}`, async () => {
        try { storage.removeItem(metaKey(userId)); storage.removeItem(legacyKey(userId)); } catch { /* ignore */ }
        meta = { ...emptyMeta(), conflicts: [] };
        wipeStore();
        if (hasMarker) { meta.cacheId = newId(); mk.setMarker!({ id: meta.cacheId, owner: userId, gen: 0, ready: false }); }
        trusted = false;
        await pullAll(true);
        meta.lastSyncAt = new Date(now()).toISOString(); save();
      });
      setStatus('synced');
      void run();
    },
    restoreConflict(e) {
      const all = store.read(); const list = [...(all[e.collection] ?? [])];
      const idx = list.findIndex((it) => idOf(e.collection, it) === e.id);
      const local = e.local as Item | undefined;
      if (local && (local as ObjT)._truncated === true) return; // too large to keep a copy: nothing to restore
      if (e.kind === 'deleted-remotely' && local) { if (idx >= 0) list[idx] = local; else list.push(local); }
      else if (e.kind === 'deleted-locally') { if (idx >= 0) list.splice(idx, 1); }
      else if ((e.kind === 'server-won' || e.kind === 'merged') && local && e.fields && idx >= 0) {
        const next: Obj = { ...list[idx] };
        for (const f of e.fields) { const v = (local as Obj)[f]; if (v === undefined) delete next[f]; else next[f] = v; }
        list[idx] = next as Item;
      } else if ((e.kind === 'server-won' || e.kind === 'merged') && local && idx < 0) list.push(local);
      else return;
      store.write({ [e.collection]: list });
      meta.conflicts = meta.conflicts.filter((x) => !(x.at === e.at && x.collection === e.collection && x.id === e.id)); save(); emit();
    },
    idOf,
    quarantine() {
      return { invalidRows: Object.values(meta.quarantine), rejected: Object.entries(meta.rejected).map(([key, r]) => ({ key, reason: r.reason, at: r.at })) };
    },
  };
  return engine;
}
