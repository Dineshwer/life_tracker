import { useStore } from '../store';

/* A drop-in replacement for the few localStorage keys that hold the user's own data or preferences
   (gym plan, mobility ticks, skill progress, cardio log, feed preferences, view choices...).
   Values live in the store's `kv` collection, which syncs to Supabase like everything else, so they follow the user
   to every device. If a key has no synced value yet but an older copy sits in this browser, that copy is used and
   migrated by `migrateLegacyPrefs()` at startup. Caches (feed results, mirror lists) deliberately stay in localStorage. */

/** keys (or prefixes) that belong to the user and must be synced */
export const SYNCED_KEYS = [
  'ledger-cardio', 'ledger-gym-plan', 'ledger-gym-start', 'ledger-gym-skills', 'ledger-habit-view', 'lt-journal-serif',
  'ledger-feed-hidden', 'ledger-ht-topics', 'ledger-feed-tab', 'ledger-avatar-seen',
];
export const SYNCED_PREFIXES = ['ledger-mobility-'];
export const isSyncedKey = (k: string) => SYNCED_KEYS.includes(k) || SYNCED_PREFIXES.some((p) => k.startsWith(p));

const legacy = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };

export const synced = {
  getItem(k: string): string | null {
    const hit = useStore.getState().kv.find((x) => x.id === k);
    return hit ? hit.value : legacy(k);
  },
  setItem(k: string, v: string): void { useStore.getState().setKV(k, v); },
};

/** Copy any user data still sitting in this browser's localStorage into the synced store (once, idempotent; originals are kept). */
export function migrateLegacyPrefs(): void {
  try {
    const have = new Set(useStore.getState().kv.map((x) => x.id));
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !isSyncedKey(k) || have.has(k)) continue;
      const v = localStorage.getItem(k);
      if (v !== null) useStore.getState().setKV(k, v);
    }
  } catch { /* storage unavailable */ }
}
