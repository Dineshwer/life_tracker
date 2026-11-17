import { useEffect, useState } from 'react';
import type { BackupInfo, ConflictEntry, SyncInfo } from './types';
/* The facade the UI uses. STUB: the engine agent replaces the bodies with the real engine (keep every name and signature). */
const idle: SyncInfo = { status: 'off', live: false, pending: 0, conflicts: [], deviceId: 'stub' };
export const getSyncInfo = (): SyncInfo => idle;
export const onSyncInfo = (cb: (i: SyncInfo) => void): (() => void) => { cb(idle); return () => {}; };
export function useSyncInfo(): SyncInfo { const [i, set] = useState(getSyncInfo()); useEffect(() => onSyncInfo(set), []); return i; }
export const syncNow = async (): Promise<void> => {};
export const flushSync = async (): Promise<void> => {};
export const resetLocalCache = async (): Promise<void> => {};
export const restoreConflict = (_e: ConflictEntry): void => {};
export const listBackups = async (): Promise<BackupInfo[]> => [];
export const takeBackup = async (): Promise<BackupInfo> => ({ taken_on: new Date().toISOString().slice(0, 10), row_count: 0 });
export const restoreBackup = async (_takenOn: string): Promise<number> => 0;
