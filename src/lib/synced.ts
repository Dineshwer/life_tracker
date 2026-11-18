import { useStore, flushStoreWrites } from '../store';

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

/** Browser originals of migrated prefs are archived under this prefix until the first successful cloud sync, then deleted. */
export const LEGACY_ARCHIVE = 'ledger-legacy-';
export function purgeLegacyArchive(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(LEGACY_ARCHIVE)) keys.push(k); }
    for (const k of keys) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

const legacy = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };

export const synced = {
  getItem(k: string): string | null {
    const hit = useStore.getState().kv.find((x) => x.id === k);
    return hit ? hit.value : legacy(k);
  },
  setItem(k: string, v: string): void { useStore.getState().setKV(k, v); },
};

/* Storage audit (final). Everything the user chooses or records lives in the store (synced to Supabase): the collections, `settings`,
   and the keys above in `kv`. What deliberately stays in the browser, all disposable and rebuilt on demand:
     ledger-channels-v2        feed result cache (3h TTL)           ledger-mirror-list / -ledger-mirror / ledger-mirror-ids   Invidious mirror list, last good mirror, channel-id lookups
     life-tracker-v1           the zustand cache of the store itself   life-tracker-v1-corrupt   a parked unreadable copy of it (only on corruption)
     sb-*-auth-token           the Supabase session                 sync metadata (cursor, base versions) kept by the sync engine
     ledger-mirror-extra       a read-only developer override (nothing in the app writes it)
   Component-local state that is lost on reload is limited to short unsaved form fields (task draft, rejection form before "Log"), and the
   ?skin= / ?mode= QA overrides; the journal saves to the store on every keystroke. */

/** Copy any user data still sitting in this browser's localStorage into the synced store (idempotent). The browser original is removed
    only once the value is verified to be in the store AND in its persisted copy, so a stale copy can never resurrect old data after a cache reset
    and nothing is ever lost. Caches and unknown keys are never touched. */
export function migrateLegacyPrefs(): void {
  try {
    const have = new Map(useStore.getState().kv.map((x) => [x.id, x.value]));
    const found: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isSyncedKey(k)) found.push(k);
    }
    for (const k of found) {
      const v = localStorage.getItem(k);
      if (v === null) continue;
      if (!have.has(k)) useStore.getState().setKV(k, v);
    }
    // verify against the persisted blob (flush the write-behind first), then archive + drop the originals
    flushStoreWrites();
    let persisted: Map<string, string> | null = null;
    try { const raw = JSON.parse(localStorage.getItem('life-tracker-v1') || 'null'); persisted = new Map(((raw?.state?.kv ?? []) as { id: string; value: string }[]).map((x) => [x.id, x.value])); } catch { persisted = null; }
    if (!persisted) return;
    for (const k of found) {
      const v = localStorage.getItem(k);
      const inStore = useStore.getState().kv.find((x) => x.id === k)?.value;
      if (v !== null && inStore !== undefined && persisted.get(k) === inStore && (have.has(k) || inStore === v)) {
        try { localStorage.setItem(`${LEGACY_ARCHIVE}${k}`, v); } catch { continue; } // quota: keep the original instead
        localStorage.removeItem(k);
      }
    }
  } catch { /* storage unavailable */ }
}
