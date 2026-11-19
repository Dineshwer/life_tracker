import { useStore } from '../store';
import { sanitizeState, type SanitizeReport } from './validate';

/* Versioned backup file. Export: { format: 'ledger-backup', version: 2, exportedAt, collections: { habits, ..., kv, wake }, settings }
   (`settings` includes `settledThrough`). Import accepts v2, the pre-versioned shape (`JSON.stringify(store state)`: the same
   collections at the top level) and partial files; everything passes through sanitizeState, so invalid items are dropped and reported. */

export const BACKUP_FORMAT = 'ledger-backup';
export const BACKUP_VERSION = 2;
const MAX_BYTES = 60 * 1024 * 1024;
export const BACKUP_LISTS = ['habits', 'habitLogs', 'tasks', 'blocks', 'workouts', 'body', 'journal', 'rewards', 'xp', 'wake', 'books', 'conversations', 'rejections', 'videos', 'channels', 'courses', 'oneLogs', 'kv'] as const;

export interface Backup {
  format: typeof BACKUP_FORMAT; version: number; exportedAt: string;
  collections: Record<string, unknown[]>;
  settings: Record<string, unknown>;
}
/** What parseBackup returns: only the keys present in the file (after validation), shaped like the store's state. */
export type BackupData = Record<string, unknown>;

export function buildBackup(): Backup {
  const s = useStore.getState() as unknown as Record<string, unknown>;
  const collections: Record<string, unknown[]> = {};
  for (const k of BACKUP_LISTS) collections[k] = (s[k] as unknown[]) ?? [];
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), collections, settings: { ...useStore.getState().settings, settledThrough: useStore.getState().settledThrough } };
}

export function parseBackup(text: string): { data: BackupData; report: SanitizeReport } {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The file is empty.');
  if (text.length > MAX_BYTES) throw new Error('The file is too large to be a Ledger backup.');
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new Error('The file is not valid JSON, so it is not a Ledger backup.'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('This is not a Ledger backup.');
  const o = j as Record<string, unknown>;
  let flat: Record<string, unknown>;
  if (o.format === BACKUP_FORMAT) {
    if (typeof o.version !== 'number' || o.version < 1) throw new Error('This backup has no valid version.');
    if (o.version > BACKUP_VERSION) throw new Error(`This backup was made by a newer version of Ledger (format ${o.version}). Update the app and try again.`);
    const c = o.collections && typeof o.collections === 'object' && !Array.isArray(o.collections) ? (o.collections as Record<string, unknown>) : {};
    const st = o.settings && typeof o.settings === 'object' && !Array.isArray(o.settings) ? { ...(o.settings as Record<string, unknown>) } : undefined;
    const settledThrough = st?.settledThrough; if (st) delete st.settledThrough;
    flat = { ...c, ...(st ? { settings: st } : {}), ...(settledThrough !== undefined ? { settledThrough } : {}) };
  } else flat = o; // pre-versioned export, or a partial file
  const { state, report } = sanitizeState(flat);
  if (!Object.keys(state).length) throw new Error('This is not a Ledger backup (no recognised data in it).');
  return { data: state, report };
}
