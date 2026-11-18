import type { ConflictEntry, KeyValueStorage } from './types';

/* Per-user sync metadata: a DISPOSABLE cache kept in local storage. Deleting it loses nothing (the next sync rebuilds it from the server).
   For every item the server confirmed we remember its version and its canonical JSON (the "base" of later three-way merges).
   base === null means "the server has a tombstone at this version". */

export interface ItemMeta { v: number; base: string | null; s?: number } // s = seq of the row at which we learned `v` (a re-created item restarts at version 1 but has a newer seq)
export interface QuarantineEntry { key: string; version: number; reason: string; at: string }
export interface RejectedEntry { json: string; reason: string; at: string }

export interface MetaBlob {
  format: 'ledger-sync-v2';
  rev: number;                         // bumped on every save: lets another tab detect that the blob changed
  seq: number;                         // pull cursor
  initialized: boolean;                // the first full pull finished
  cacheId?: string;                    // epoch of the local cache: must equal the marker stored next to the persisted store, else the store was reset/replaced
  storeGen: number;                    // generation of the store as of the last meta save (the marker in the store carries the same counter)
  items: Record<string, ItemMeta>;     // key = `${collection}/${id}`
  quarantine: Record<string, QuarantineEntry>; // invalid rows received from the server (never applied)
  rejected: Record<string, RejectedEntry>;     // local items the server refused (never retried until they change)
  conflicts: ConflictEntry[];          // most recent first, capped
  lastSyncAt?: string;
}

export const metaKey = (userId: string): string => `ledger-sync-v2-${userId}`;
export const legacyKey = (userId: string): string => `ledger-sync-${userId}`;
export const MAX_CONFLICTS = 100;

/** Items whose canonical JSON is longer than this are kept in the meta as a hash only (item-level merge, half the storage). */
export const BIG_BASE = 4096;
function cyrb53(str: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
/** What the meta stores as the "base" of an item: its canonical JSON, or `h:<hash>:<length>` for big items. Compare bases only through this. */
export const toBase = (canonJson: string): string => (canonJson.length > BIG_BASE ? `h:${cyrb53(canonJson, 1)}${cyrb53(canonJson, 7)}:${canonJson.length}` : canonJson);
export const isHashBase = (b: string): boolean => b.startsWith('h:');

export const emptyMeta = (): MetaBlob => ({ format: 'ledger-sync-v2', rev: 0, seq: 0, initialized: false, storeGen: 0, items: {}, quarantine: {}, rejected: {}, conflicts: [] });

export function loadMeta(storage: KeyValueStorage, userId: string): MetaBlob {
  try {
    const raw = storage.getItem(metaKey(userId));
    if (!raw) return emptyMeta();
    const j = JSON.parse(raw) as Partial<MetaBlob>;
    if (!j || j.format !== 'ledger-sync-v2' || typeof j.seq !== 'number' || !j.items || typeof j.items !== 'object') return emptyMeta();
    return { ...emptyMeta(), ...j, items: j.items, quarantine: j.quarantine ?? {}, rejected: j.rejected ?? {}, conflicts: Array.isArray(j.conflicts) ? j.conflicts.slice(0, MAX_CONFLICTS) : [] };
  } catch { return emptyMeta(); }
}

/** Returns false when the browser refused the write (storage full). The meta is a cache: the next start rebuilds it from the server. */
export function saveMeta(storage: KeyValueStorage, userId: string, m: MetaBlob): boolean {
  m.rev += 1;
  try { storage.setItem(metaKey(userId), JSON.stringify(m)); return true; } catch { return false; }
}

/** The old `ledger-sync-<uid>` snapshot: [[key, itemJson], ...]. Used once as the merge base for items the v2 meta has never seen. */
export function loadLegacy(storage: KeyValueStorage, userId: string): Map<string, string> | undefined {
  try {
    const raw = storage.getItem(legacyKey(userId));
    if (!raw) return undefined;
    const arr = JSON.parse(raw) as [string, string][];
    return new Map(arr.map(([k, json]) => [k, json]));
  } catch { return undefined; }
}
