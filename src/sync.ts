import { supabase } from './lib/supabase';
import { zustandStoreAdapter } from './lib/storeAdapter';
import { useStore } from './store';
import { seed } from './seed';
import { validateItem, coerceItem } from './lib/validate';
import { purgeLegacyArchive } from './lib/synced';
import { createSyncEngine } from './sync/engine';
import { createSupabaseRemote } from './sync/remote';
import { addInfoListener, clearRuntime, getDeviceId, getEngine, setRuntime } from './sync/runtime';
import type { StoreAdapter, SyncStatus } from './sync/types';

/* Facade over the sync engine (src/sync/*): wires the real store, Supabase client and browser events.
   The database is the source of truth; the persisted store plus the sync metadata in localStorage are a disposable cache. */

export type { SyncStatus };

const storeAdapter: StoreAdapter = zustandStoreAdapter();

const withLock = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks) return fn();
  return locks.request(name, fn) as Promise<T>;
};

let userId: string | null = null;
let unwire: (() => void) | undefined;

export function startSync(uid: string) {
  stopSync();
  if (!supabase) return;
  userId = uid;
  // the persisted data belongs to ANOTHER account (sign-out / sign-in as someone else): never upload it to this account, start from the seed
  const owner = useStore.getState().syncCache?.owner;
  if (owner && owner !== uid) useStore.setState({ ...seed(), syncCache: undefined } as never);
  // until this device completed its first cloud sync the local dates are provisional: do not settle days yet (the cloud knows how far they were settled)
  if (!useStore.getState().syncCache?.ready) useStore.setState({ holdSettle: true });
  const offHold = useStore.subscribe((s, prev) => { if (prev.holdSettle && !s.holdSettle) s.settle(); });
  const remote = createSupabaseRemote(supabase, uid);
  const engine = createSyncEngine({ remote, store: storeAdapter, storage: localStorage, userId: uid, deviceId: getDeviceId(), withLock, validate: (c, it) => validateItem(c, it), coerce: (c, it) => coerceItem(c, it) });
  setRuntime(engine, remote);
  const wake = () => { void engine.syncNow(); };
  const visible = wake; // visible: pull; hidden: flush right away
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('online', wake); window.addEventListener('offline', wake); window.addEventListener('pagehide', wake);
  unwire = () => { offHold(); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', wake); window.removeEventListener('offline', wake); window.removeEventListener('pagehide', wake); };
  const offArchive = engine.subscribe((i) => { if (i.status === 'synced' && i.pending === 0) purgeLegacyArchive(); }); // browser originals of migrated prefs are kept until the first successful sync
  const prevUnwire = unwire; unwire = () => { offArchive(); prevUnwire?.(); };
  engine.start();
}

export function stopSync() {
  unwire?.(); unwire = undefined;
  if (useStore.getState().holdSettle) useStore.setState({ holdSettle: false });
  getEngine()?.stop();
  clearRuntime();
  userId = null;
}

export const syncNow = () => { void getEngine()?.syncNow(); };
/** How many items changed on this device but are not in the cloud yet. */
let pendingMemo = { at: 0, n: 0 };
addInfoListener(() => { pendingMemo.at = 0; }); // any sync status change invalidates the memo
export function pendingCount(): number {
  if (!userId) return 0;
  // the sync banner asks on every store change: recompute at most every 300 ms (cheap debounce)
  const t = Date.now();
  if (t - pendingMemo.at > 300) pendingMemo = { at: t, n: getEngine()?.info().pending ?? 0 };
  return pendingMemo.n;
}

/** Compatibility: (status, lastSyncAt, error) listener used by the sync banner. */
export function onSyncStatus(l: (s: SyncStatus, at?: Date, err?: string) => void): () => void {
  return addInfoListener((i) => l(i.status, i.lastSyncAt ? new Date(i.lastSyncAt) : undefined, i.error));
}
