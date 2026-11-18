import type { Remote, SyncInfo } from './types';
import type { SyncEngineExt } from './engine';

/* The single live engine of this tab, shared by src/sync.ts (which creates it) and src/sync/api.ts (which the UI uses). */

export const DEVICE_KEY = 'ledger-device-id';

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch { return 'device-' + Math.random().toString(36).slice(2); }
}

let current: { engine: SyncEngineExt; remote: Remote; unsub: () => void } | null = null;
const listeners = new Set<(i: SyncInfo) => void>();
const idleInfo = (): SyncInfo => ({ status: 'off', live: false, pending: 0, conflicts: [], deviceId: getDeviceId() });

export function setRuntime(engine: SyncEngineExt, remote: Remote) {
  clearRuntime();
  const unsub = engine.subscribe((i) => listeners.forEach((l) => l(i)));
  current = { engine, remote, unsub };
}
export function clearRuntime() {
  if (!current) return;
  current.unsub(); current = null;
  listeners.forEach((l) => l(idleInfo()));
}
export const getEngine = (): SyncEngineExt | null => current?.engine ?? null;
export const getRemote = (): Remote | null => current?.remote ?? null;
export const currentInfo = (): SyncInfo => current?.engine.info() ?? idleInfo();
export function addInfoListener(cb: (i: SyncInfo) => void): () => void { listeners.add(cb); cb(currentInfo()); return () => { listeners.delete(cb); }; }
