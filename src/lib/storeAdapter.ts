import { COLLECTIONS, type Item, type StoreAdapter } from '../sync/types';
import { useStore } from '../store';
import type { MarkerCapable } from '../sync/engine';
import { isISODate, normalizeLists, validateItem } from './validate';

/* The real zustand store as the sync engine sees it (contract: src/sync/types.ts).
   read():  every COLLECTIONS key -> its items. `meta` = [{ id: 'settings', ...settings, settledThrough }]; wake logs are { date, time }.
   write(): whole-collection replacements applied with ONE `set` (one notification, one persisted write). Invalid items are dropped,
            xp / habit-log duplicates are collapsed deterministically, `meta` is mapped back to settings + settledThrough
            (settledThrough only ever moves forward, so a stale device cannot re-open days that were already settled). */

const LISTS = COLLECTIONS.filter((c) => c !== 'meta');

export function zustandStoreAdapter(): StoreAdapter & MarkerCapable {
  return {
    read() {
      const s = useStore.getState() as unknown as Record<string, Item[]>;
      const out: Record<string, Item[]> = {};
      for (const c of LISTS) out[c] = s[c] ?? [];
      out.meta = [{ id: 'settings', ...useStore.getState().settings, settledThrough: useStore.getState().settledThrough }];
      return out;
    },
    write(patch) {
      const next: Record<string, unknown> = {};
      for (const c of LISTS) {
        const list = patch[c];
        if (!Array.isArray(list)) continue;
        next[c] = list.filter((it) => validateItem(c, it));
      }
      const meta = Array.isArray(patch.meta) ? patch.meta.find((m) => m && m.id === 'settings') : undefined;
      const cur = useStore.getState();
      if (meta && validateItem('meta', meta)) {
        const { id: _id, settledThrough, ...settings } = meta as Item & { settledThrough?: string };
        void _id;
        next.settings = { ...cur.settings, ...settings };
        // settledThrough only moves forward, EXCEPT before the first completed sync: then the local date is the seed's and the cloud's is the truth
        if (isISODate(settledThrough) && (settledThrough > cur.settledThrough || !cur.syncCache?.ready)) next.settledThrough = settledThrough;
      }
      if (!Object.keys(next).length) return;
      useStore.setState(normalizeLists(next) as never);
    },
    subscribe(cb) { return useStore.subscribe(() => cb()); },
    /* the sync engine's cache marker (see src/sync/engine.ts): kept next to the persisted store, never synced */
    getMarker() { return useStore.getState().syncCache; },
    setMarker(m) { useStore.setState((m ? { syncCache: m, ...(m.ready ? { holdSettle: false } : {}) } : { syncCache: undefined }) as never); },
  };
}
