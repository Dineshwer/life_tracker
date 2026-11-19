/* THE SYNC CONTRACT. Four parts are written against this file in parallel:
     supabase/migrations/*.sql        the database: tables, versioned writes, constraints, backups, realtime  (DB agent)
     src/sync/**, src/sync.ts         the client sync engine + the Supabase `Remote` adapter                 (engine agent)
     tests/unit/**                    FakeRemote + the shared Remote contract tests + engine tests            (test agent)
     Settings "Data & sync" UI, store hardening, CI/docs                                                      (other agents)
   Do not change this file without telling the integrator. Principle: the DATABASE is the source of truth. The browser keeps a
   disposable cache (the zustand store persisted in localStorage plus per-user sync metadata); wiping it must lose nothing. */

/** One synced item. `collection` is one of COLLECTIONS, `id` is the item's own id (wake logs use `wake:<date>`). */
export interface RemoteRow {
  collection: string;
  id: string;
  data: unknown;             // the item as a JSON object ({} for tombstones)
  deleted: boolean;          // tombstone: the item was deleted
  version: number;           // 1 on creation, +1 on every accepted write (including deletes and restores)
  seq: number;               // global, strictly increasing per write: the pull cursor (select ... where seq > cursor order by seq)
  updated_at: string;        // ISO, server clock, set by a trigger (clients never send it)
  device_id?: string | null; // which device wrote last (diagnostics)
}

/** A change the client wants to write. `base_version` is the version the client last saw for this item (0 = it believes the item is new). */
export interface PushItem {
  collection: string;
  id: string;
  data: unknown;
  deleted: boolean;
  base_version: number;
}

/** Result for one pushed item. The write is accepted only if `base_version` equals the server's current version (optimistic concurrency).
    'ok'       written; `row` is the new canonical row.
    'conflict' not written; `row` is the server's current row: the client merges and pushes again.
    'gone'     the client sent base_version > 0 but the server no longer has the item (tombstone purged after 90 days): drop the local item.
    'rejected' not written because the item is invalid (unknown collection, bad id, data not an object, too large); `reason` says why; do not retry. */
export interface PushResult {
  collection: string;
  id: string;
  status: 'ok' | 'conflict' | 'gone' | 'rejected';
  row?: RemoteRow;
  reason?: string;
}

export interface BackupInfo { taken_on: string; row_count: number }

/** Everything the engine needs from the server. Two implementations: the Supabase adapter (src/sync/remote.ts) and FakeRemote (tests). */
export interface Remote {
  /** Rows with seq > sinceSeq, ordered by seq ascending, at most `limit` (default 1000). The engine pages until it gets fewer than `limit`. */
  pull(sinceSeq: number, limit?: number): Promise<RemoteRow[]>;
  /** Write up to 500 items. Per-item results, same order as the input. Throws only on network/auth failure (the engine retries with backoff). */
  push(items: PushItem[], deviceId: string): Promise<PushResult[]>;
  /** Live changes from other devices. Returns an unsubscribe function. `onStatus('down')` means reconnecting (the engine falls back to polling). */
  subscribe(onRow: (row: RemoteRow) => void, onStatus: (s: 'live' | 'down') => void): () => void;
  listBackups(): Promise<BackupInfo[]>;
  /** Server-side: replace the user's live rows by the snapshot of `takenOn` (ISO date); every restored/removed row gets a new version so all devices converge. Returns the number of rows touched. */
  restoreBackup(takenOn: string): Promise<number>;
  /** Server-side: snapshot now (at most once per 10 minutes per user). */
  takeBackup(): Promise<BackupInfo>;
}

/** Allowed collections (the DB enforces the same list). `meta` holds { id: 'settings' }. */
export const COLLECTIONS = [
  'habits', 'habitLogs', 'tasks', 'blocks', 'workouts', 'body', 'journal', 'rewards', 'xp', 'books', 'conversations',
  'rejections', 'videos', 'channels', 'oneLogs', 'kv', 'wake', 'meta', 'courses',
] as const;
export type Collection = (typeof COLLECTIONS)[number];

export const LIMITS = { maxItemBytes: 512 * 1024, maxBatch: 500, maxIdLength: 200, tombstoneDays: 90, backupDays: 14 } as const;

/* ---- what the UI and the rest of the app see ---- */
export type SyncStatus = 'off' | 'syncing' | 'synced' | 'offline' | 'error';
export interface ConflictEntry {
  at: string;                        // ISO
  collection: string; id: string;
  kind: 'merged' | 'server-won' | 'local-won' | 'deleted-remotely' | 'deleted-locally';
  fields?: string[];                 // fields that differed (for merged/server-won)
  local?: unknown; remote?: unknown; // the losing value, so the user can recover it
}
export interface SyncInfo {
  status: SyncStatus;
  live: boolean;                     // realtime connection up
  lastSyncAt?: string;               // ISO of the last fully successful cycle
  pending: number;                   // local changes not yet accepted by the server
  error?: string;
  conflicts: ConflictEntry[];        // most recent first, capped at 100 (kept locally; diagnostic)
  deviceId: string;
}

/* ---- the engine's dependencies: injected so the engine runs in Node (unit tests) and in the browser ---- */
export type Item = { id?: string; date?: string; [k: string]: unknown };

/** The local store as the engine sees it. `read()` returns every synced collection (including 'meta' = [{ id: 'settings', ...settings }] ).
    `write(patch)` replaces whole collections atomically (the engine passes the merged lists) and must notify subscribers like a normal change. */
export interface StoreAdapter {
  read(): Record<string, Item[]>;
  write(patch: Record<string, Item[]>): void;
  subscribe(cb: () => void): () => void;
}
export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export interface EngineDeps {
  remote: Remote;
  store: StoreAdapter;
  storage: KeyValueStorage;          // per-user sync metadata (cursor, per-item base versions) is kept here: a disposable cache
  userId: string;
  deviceId: string;
  now?: () => number;                // default Date.now
  /** timers are injectable so tests can run on a fake clock */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
  /** run `fn` while holding a cross-tab lock (navigator.locks in the browser); default: just run it */
  withLock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  /** per-item validation of rows coming from the server (src/lib/validate.ts); invalid rows are quarantined, never applied */
  validate?: (collection: string, item: unknown) => boolean;
}
export interface SyncEngine {
  start(): void;                     // load metadata, first sync, subscribe to realtime + local changes, schedule polling
  stop(): void;
  syncNow(): Promise<void>;          // one full cycle: push local changes, pull remote changes, merge, push merge results
  flush(): Promise<void>;            // resolves when there are no pending local changes (or rejects after a timeout / when offline)
  info(): SyncInfo;
  subscribe(cb: (i: SyncInfo) => void): () => void;
  resetLocalCache(): Promise<void>;  // drop the local copy and sync metadata and rebuild everything from the server (proves the cache is disposable)
  restoreConflict(e: ConflictEntry): void; // put the losing local value from a conflict entry back into the store (it then syncs as a normal edit)
  idOf(collection: string, item: Item): string;
}
