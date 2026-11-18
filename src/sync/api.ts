import { useEffect, useState } from 'react';
import type { BackupInfo, ConflictEntry, SyncInfo } from './types';
import { addInfoListener, currentInfo, getEngine, getRemote } from './runtime';
/* The facade the UI uses. Implemented on the live engine owned by src/sync.ts. */

const need = () => { const e = getEngine(); const r = getRemote(); if (!e || !r) throw new Error('Cloud sync is not running (sign in first).'); return { e, r }; };

export const getSyncInfo = (): SyncInfo => currentInfo();
export const onSyncInfo = (cb: (i: SyncInfo) => void): (() => void) => addInfoListener(cb);
export function useSyncInfo(): SyncInfo { const [i, set] = useState(getSyncInfo()); useEffect(() => onSyncInfo(set), []); return i; }
export const syncNow = async (): Promise<void> => { await getEngine()?.syncNow(); };
export const flushSync = async (): Promise<void> => { await getEngine()?.flush(); };
export const resetLocalCache = async (): Promise<void> => { await need().e.resetLocalCache(); };
export const restoreConflict = (e: ConflictEntry): void => { getEngine()?.restoreConflict(e); };
export const listBackups = async (): Promise<BackupInfo[]> => need().r.listBackups();
export const takeBackup = async (): Promise<BackupInfo> => {
  const { e, r } = need();
  await e.flush().catch(() => { /* snapshot what the server has */ });
  return r.takeBackup();
};
export const restoreBackup = async (takenOn: string): Promise<number> => {
  const { e, r } = need();
  await e.flush().catch(() => { /* unsent edits merge afterwards */ });
  const n = await r.restoreBackup(takenOn);
  await e.syncNow();
  return n;
};
