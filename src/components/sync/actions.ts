import type { BackupInfo, ConflictEntry, SyncInfo } from '../../sync/types';
import * as api from '../../sync/api';
import { supabase } from '../../lib/supabase';

/** Everything the sync UI can do. Components take this as a prop so the QA lab can drive them with fakes. */
export interface SyncActions {
  getInfo(): SyncInfo;
  syncNow(): Promise<void>;
  flushSync(): Promise<void>;
  resetLocalCache(): Promise<void>;
  restoreConflict(e: ConflictEntry): void;
  listBackups(): Promise<BackupInfo[]>;
  takeBackup(): Promise<BackupInfo>;
  restoreBackup(takenOn: string): Promise<number>;
  signOut(): Promise<void>;
}
export const liveActions: SyncActions = {
  getInfo: api.getSyncInfo, syncNow: api.syncNow, flushSync: api.flushSync, resetLocalCache: api.resetLocalCache, restoreConflict: api.restoreConflict,
  listBackups: api.listBackups, takeBackup: api.takeBackup, restoreBackup: api.restoreBackup,
  signOut: async () => { await supabase?.auth.signOut(); },
};

import { useEffect, useState } from 'react';
export function useOnline(): boolean {
  const [on, set] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => { const a = () => set(true), b = () => set(false); addEventListener('online', a); addEventListener('offline', b); return () => { removeEventListener('online', a); removeEventListener('offline', b); }; }, []);
  return on;
}
/** Re-renders every `ms` so relative times stay fresh. */
export function useNow(ms = 20000): number {
  const [n, set] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => set(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}
