/* Several tabs share one persisted store blob (localStorage 'life-tracker-v1'). zustand persist writes the WHOLE blob from the writing tab's memory, so
   without this a tab that has not seen the other tab's change would erase it on its next write. The browser fires a `storage` event in the OTHER tabs
   when a tab writes: re-read the blob into memory right away so every tab always writes on top of the latest data. */
export type StorageEventLike = { key: string | null };
export function rehydrateOnStorage(
  target: { addEventListener(type: 'storage', cb: (e: StorageEventLike) => void): void },
  key: string,
  store: { persist: { rehydrate(): unknown } },
  beforeRehydrate?: () => void,
): void {
  target.addEventListener('storage', (e) => {
    if (e.key !== key && e.key !== null) return;
    beforeRehydrate?.();
    void store.persist.rehydrate();
  });
}
