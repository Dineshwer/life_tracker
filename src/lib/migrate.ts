import { seed, DEFAULT_CHANNELS } from '../seed';
import { sanitizeState } from './validate';

/* The persisted store is only a disposable cache of the cloud copy, but it must still always load: a numbered migration chain,
   then sanitizeState (invalid items dropped), then defaults for anything missing. `migratePersisted` NEVER throws: on a corrupt
   blob it returns the seed and the sync engine rebuilds everything from the server.
   Versions: 1 initial; 2 channel list reworked; 3 adds `kv` (synced preferences) and guarantees every collection exists. */
export const STORE_VERSION = 3;

type Blob = Record<string, unknown>;
const LISTS = ['habits', 'habitLogs', 'tasks', 'blocks', 'workouts', 'body', 'journal', 'rewards', 'xp', 'wake', 'books', 'conversations', 'rejections', 'videos', 'channels', 'oneLogs', 'kv'] as const;

const CONFIG: string[] = ['habits', 'blocks', 'rewards', 'channels'];
export const MIGRATIONS: Record<number, (s: Blob) => Blob> = {
  // v1 -> v2: the channel list was reworked (security, psychology, persuasion, business, science); start from the new defaults.
  2: (s) => ({ ...s, channels: DEFAULT_CHANNELS }),
  // v2 -> v3: `kv` collection; every list collection is an array (older blobs lack videos / channels / rejections / oneLogs / books...).
  3: (s) => { const o: Blob = { ...s }; for (const k of LISTS) if (!Array.isArray(o[k]) && !CONFIG.includes(k)) o[k] = []; return o; }, // config lists fall back to the seed in loadState
};

export function migratePersisted(persisted: unknown, version: number): Blob {
  const base = seed() as unknown as Blob;
  try {
    let s: Blob = persisted && typeof persisted === 'object' && !Array.isArray(persisted) ? { ...(persisted as Blob) } : {};
    const v = Number.isFinite(version) ? version : 1;
    for (let n = Math.max(v, 0) + 1; n <= STORE_VERSION; n++) { try { s = MIGRATIONS[n]?.(s) ?? s; } catch { /* keep going with what we have */ } }
    return loadState(s, base);
  } catch { return base; }
}

/** sanitize + fill defaults. Unknown top-level fields are kept. Lists that are missing become [] (config lists fall back to the seed). */
export function loadState(raw: Blob, base: Blob = seed() as unknown as Blob): Blob {
  const { state } = sanitizeState(raw);
  const out: Blob = { ...raw, ...state };
  for (const k of LISTS) if (!Array.isArray(out[k])) out[k] = CONFIG.includes(k) ? base[k] : [];
  out.settings = { ...(base.settings as object), ...((state.settings as object) ?? {}) };
  out.settledThrough = typeof state.settledThrough === 'string' ? state.settledThrough : base.settledThrough;
  return out;
}
