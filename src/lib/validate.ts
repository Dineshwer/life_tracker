import { COLLECTIONS, type Item } from '../sync/types';

/* Item validation for every synced collection, plus `sanitizeState` (used when the persisted store is loaded and when a backup is
   imported): invalid items are dropped and reported, never loaded. Rules: required fields and primitive types, bounded sizes,
   enums, real ISO dates, finite numbers. Optional fields (see src/types.ts) may be absent or undefined but, when present, must
   have the right type, so old data that lacks newer optional fields (Book.kind...) is accepted. Unknown extra fields are kept. */

const MAX_ID = 200, MAX_STR = 2_000, MAX_TEXT = 200_000, MAX_PHOTO = 400_000, MAX_XP = 100_000;
type R = Record<string, unknown>;
const isObj = (v: unknown): v is R => !!v && typeof v === 'object' && !Array.isArray(v);
const absent = (v: unknown) => v === undefined || v === null;

export const isISODate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (y < 1970 || y > 2200) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const isHHMM = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isStamp = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const num = (v: unknown, min = -1e9, max = 1e9): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
/** NUL and lone UTF-16 surrogates cannot be stored by Postgres (jsonb) nor round-trip through JSON: such strings are invalid (coerceItem strips them). */
const BAD_CHARS = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const BAD_CHARS_G = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const hasBadChars = (v: string): boolean => BAD_CHARS.test(v);
const str = (v: unknown, max = MAX_STR, min = 0): v is string => typeof v === 'string' && v.length >= min && v.length <= max && !BAD_CHARS.test(v);

function deepBad(v: unknown, depth = 0): boolean {
  if (typeof v === 'string') return BAD_CHARS.test(v);
  if (depth > 20) return true;
  if (Array.isArray(v)) return v.some((x) => deepBad(x, depth + 1));
  if (isObj(v)) { for (const k in v) if (BAD_CHARS.test(k) || deepBad(v[k], depth + 1)) return true; }
  return false;
}

/** Remove NUL and lone surrogates from every string inside a value (returns the same object when nothing needed to change). */
function scrub<T>(v: T): T {
  if (typeof v === 'string') return (BAD_CHARS.test(v) ? v.replace(BAD_CHARS_G, '') : v) as T;
  if (Array.isArray(v)) { let out: unknown[] | null = null; v.forEach((x, i) => { const y = scrub(x); if (y !== x) { out = out ?? [...v]; out[i] = y; } }); return (out ?? v) as T; }
  if (isObj(v)) { let out: R | null = null; for (const k in v) { const x = v[k], y = scrub(x); if (y !== x) { out = out ?? { ...v }; out[k] = y; } } return (out ?? v) as T; }
  return v;
}
const oneOf = <T extends string | number>(v: unknown, set: readonly T[]): v is T => (set as readonly unknown[]).includes(v);
const idOk = (v: unknown) => str(v, MAX_ID, 1);

type Check = ((v: unknown) => boolean) & { max?: number };
const opt = (c: Check): Check => Object.assign((v: unknown) => absent(v) || c(v), { max: c.max });
const bool: Check = (v) => typeof v === 'boolean';
const S = (max = MAX_STR, min = 0): Check => Object.assign((v: unknown) => str(v, max, min), { max });
const N = (min?: number, max?: number): Check => (v) => num(v, min, max);
const E = (...set: (string | number)[]): Check => (v) => oneOf(v, set);
const D: Check = isISODate;
const T: Check = isHHMM;
const TS: Check = isStamp;
const ID: Check = idOk;
const STAT = E('body', 'mind', 'skill', 'discipline');
const arrOf = (c: Check, max = 500): Check => (v) => Array.isArray(v) && v.length <= max && v.every(c);
const recOf = (c: Check): Check => (v) => isObj(v) && Object.keys(v).length <= 100 && Object.values(v).every(c);
const UNIT = E('kg', 'bw', 'sec');

type Schema = Record<string, Check>;
const check = (it: R, s: Schema) => { for (const k in s) if (!s[k](it[k])) return false; return true; };

const SCHEMAS: Record<string, Schema> = {
  habits: {
    id: ID, name: S(200, 1), stat: STAT, xp: N(0, MAX_XP), minimum: opt(S()), archived: opt(bool),
    cadence: (v) => isObj(v) && (v.type === 'daily' || (v.type === 'weekly' && num(v.perWeek, 1, 7)) || (v.type === 'days' && arrOf(E(0, 1, 2, 3, 4, 5, 6), 7)(v.days))),
    unit: opt((v) => isObj(v) && str(v.label, 100) && num(v.target, 0, 1e6)),
  },
  habitLogs: { id: ID, habitId: ID, date: D, level: E('full', 'min'), amount: opt(N(0, 1e7)), note: opt(S(MAX_TEXT)) },
  tasks: {
    id: ID, title: S(1000, 1), done: bool, doneAt: opt(TS), date: opt(D), context: E('job', 'agency', 'personal', 'learning'),
    tags: arrOf(S(100), 50), parentId: opt(ID), effort: E(1, 2, 3), stat: STAT, horizon: opt(E('today', 'short', 'long')),
    recurrence: opt((v) => isObj(v) && oneOf(v.every, ['day', 'week', 'month'] as const) && num(v.interval, 1, 366)),
  },
  blocks: {
    id: ID, title: S(200, 1), start: T, end: T, day: E('weekday', 'weekend', 'all'), kind: E('fixed', 'agency', 'habit', 'focus', 'free'),
    fixed: opt(bool), habitId: opt(ID),
  },
  workouts: {
    id: ID, date: D, name: S(200), notes: opt(S(MAX_TEXT)), planId: opt(S(MAX_ID)),
    sets: arrOf((s) => isObj(s) && idOk(s.id) && str(s.exercise, 200) && num(s.reps, 0, 100_000) && num(s.weight, 0, 100_000) && UNIT(s.unit) && opt(S())(s.note), 1000),
    queue: opt(arrOf((q) => isObj(q) && idOk(q.id) && str(q.name, 200) && num(q.sets, 0, 1000) && num(q.reps, 0, 100_000) && UNIT(q.unit)
      && opt(S())(q.demo) && opt(S(MAX_TEXT))(q.text) && opt(S(MAX_TEXT))(q.note) && opt(bool)(q.skipped), 500)),
  },
  body: { id: ID, date: D, weightKg: opt(N(1, 1000)), measurements: opt(recOf((x) => num(x, 0, 10_000))), photo: opt(S(MAX_PHOTO)) },
  journal: { id: ID, date: D, body: S(MAX_TEXT), kind: E('daily', 'weekly'), mood: opt(E(1, 2, 3, 4, 5)), energy: opt(E(1, 2, 3, 4, 5)) },
  rewards: { id: ID, title: S(300, 1), cost: N(0, 1e7), claimedAt: opt(TS) },
  xp: { id: ID, date: D, stat: STAT, amount: N(-MAX_XP, MAX_XP), reason: S(500), ref: opt(S(MAX_ID)) },
  books: {
    id: ID, title: S(500, 1), status: E('reading', 'done', 'queued'), author: opt(S(300)), kind: opt(E('self', 'story')),
    pages: opt(N(0, 100_000)), page: opt(N(0, 100_000)), startedAt: opt(S(40)), finishedAt: opt(S(40)), rating: opt(N(0, 5)),
  },
  conversations: { id: ID, date: D, who: S(300), note: opt(S(MAX_TEXT)) },
  rejections: { id: ID, date: D, createdAt: TS, what: S(MAX_TEXT), who: opt(S(500)), note: opt(S(MAX_TEXT)) },
  videos: { id: ID, ytId: S(64, 1), title: S(500), tag: E('learn', 'fun'), addedAt: TS, watchedAt: opt(TS) },
  channels: { id: ID, handle: S(200, 1), cid: opt(S(100)), topic: E('sec', 'psy', 'per', 'biz', 'sci', 'code') },
  oneLogs: { id: ID, date: D, exercise: E('pullups', 'dips', 'pushups', 'rows', 'pikes', 'squats', 'splits', 'rdls'), sets: N(0, 1000), reps: N(0, 100_000), effort: opt(N(0, 10)) },
  kv: { id: ID, value: S(MAX_TEXT) },
  wake: { date: D, time: T },
  meta: {
    id: (v) => v === 'settings', theme: E('dark', 'light'), skin: opt(S(64)), wakeTime: T, weekendWake: opt(T), name: S(200),
    settledThrough: opt(D),
  },
};

/** Is this item well-formed for its collection? */
/** Cut free-text fields that are longer than the schema allows. The UI lets people type more than the data layer accepts; truncating is
    better than silently dropping the whole item later (validation would reject it on the next load or sync). Call it wherever user text enters the store. */
export function coerceItem<T>(collection: string, item: T): T {
  const s = SCHEMAS[collection];
  if (!s || !isObj(item)) return item;
  item = scrub(item);
  let out: R | null = null;
  for (const k in s) {
    const max = s[k].max, v = (item as R)[k];
    if (max !== undefined && typeof v === 'string' && v.length > max) { out = out ?? { ...(item as R) }; out[k] = v.slice(0, max); }
  }
  return (out ?? item) as T;
}

export function validateItem(collection: string, item: unknown): item is Item {
  const s = SCHEMAS[collection];
  if (!s || !isObj(item)) return false;
  try { return check(item, s) && !deepBad(item); } catch { return false; }
}

export interface SanitizeReport {
  /** items dropped as invalid, per collection (up to 5 samples of their id/date each, for diagnostics) */
  dropped: Record<string, { count: number; samples: string[] }>;
  droppedTotal: number;
  /** items kept per collection */
  kept: Record<string, number>;
  /** duplicate xp events (same non-empty `ref`) and duplicate ids that were collapsed */
  deduped: number;
  /** top-level keys that were ignored (not part of the store) */
  ignored: string[];
  /** true when settings were present but invalid and replaced by defaults */
  settingsReset: boolean;
}

/** XP events with the same non-empty `ref` are the same real-world event (e.g. created offline on two devices): keep ONE.
    Deterministic (the smallest id wins) so every device keeps the same row and the sync converges instead of tombstoning both. Order is preserved. */
export function dedupeXP<T extends { ref?: string; id?: string }>(xp: T[]): T[] {
  const win = new Map<string, string>();
  for (const e of xp) if (e.ref) { const w = win.get(e.ref); if (w === undefined || String(e.id) < w) win.set(e.ref, String(e.id)); }
  return xp.filter((e) => !e.ref || win.get(e.ref) === String(e.id));
}
/** One log per habit per day (two devices logging the same habit offline created two rows): the smallest id wins. */
export function dedupeHabitLogs<T extends { id?: string; habitId?: string; date?: string }>(logs: T[]): T[] {
  const win = new Map<string, string>();
  for (const l of logs) { const k = `${l.habitId}|${l.date}`; const w = win.get(k); if (w === undefined || String(l.id) < w) win.set(k, String(l.id)); }
  return logs.filter((l) => win.get(`${l.habitId}|${l.date}`) === String(l.id));
}
/** Apply the cross-device identity rules to a partial state (only the lists present are touched). Returns the same object when nothing changed. */
export function normalizeLists<T extends Record<string, unknown>>(st: T): T {
  let out = st;
  if (Array.isArray(st.xp)) { const x = dedupeXP(st.xp as { ref?: string; id?: string }[]); if (x.length !== st.xp.length) out = { ...out, xp: x }; }
  if (Array.isArray(st.habitLogs)) { const h = dedupeHabitLogs(st.habitLogs as { id?: string }[]); if (h.length !== st.habitLogs.length) out = { ...out, habitLogs: h }; }
  return out;
}

const KEYS = COLLECTIONS.filter((c) => c !== 'meta' && c !== 'wake');
const keyOf = (c: string, it: R) => (c === 'wake' ? String(it.date) : String(it.id));

/** Clean a raw (persisted / imported / legacy) state: lists keep only valid, unique items; absent keys stay absent (callers decide defaults).
    Never throws. `settings` and `settledThrough` are validated; an invalid settings object is dropped (key absent) and flagged. */
export function sanitizeState(raw: unknown): { state: Record<string, unknown>; report: SanitizeReport } {
  const report: SanitizeReport = { dropped: {}, droppedTotal: 0, kept: {}, deduped: 0, ignored: [], settingsReset: false };
  const state: Record<string, unknown> = {};
  if (!isObj(raw)) return { state, report };
  const drop = (c: string, it: unknown) => {
    const d = (report.dropped[c] ??= { count: 0, samples: [] });
    d.count++; report.droppedTotal++;
    if (d.samples.length < 5) d.samples.push(isObj(it) ? String(it.id ?? it.date ?? '?').slice(0, 60) : typeof it);
  };
  for (const c of [...KEYS, 'wake'] as const) {
    if (!(c in raw)) continue;
    const list = raw[c];
    if (!Array.isArray(list)) { if (!absent(list)) drop(c, list); continue; }
    const seen = new Set<string>(); const out: unknown[] = [];
    for (const raw of list) {
      const it = coerceItem(c, raw); // old data valid for the old client but over the new caps is cut, not dropped
      if (!validateItem(c, it)) { drop(c, raw); continue; }
      const k = keyOf(c, it as R);
      if (seen.has(k)) { report.deduped++; continue; }
      seen.add(k); out.push(it);
    }
    state[c] = out;
    report.kept[c] = (state[c] as unknown[]).length;
  }
  const norm = normalizeLists(state);
  for (const c of ['xp', 'habitLogs']) if (Array.isArray(state[c])) report.deduped += (state[c] as unknown[]).length - (norm[c] as unknown[]).length;
  Object.assign(state, norm);
  for (const c of Object.keys(report.kept)) report.kept[c] = (state[c] as unknown[]).length;
  if ('settings' in raw) {
    if (validateItem('meta', { id: 'settings', ...(isObj(raw.settings) ? raw.settings : {}) })) {
      const { id: _id, settledThrough: _s, ...rest } = { id: 'settings', ...(raw.settings as R) } as R; void _id; void _s;
      state.settings = rest;
    } else report.settingsReset = true;
  }
  if ('settledThrough' in raw && isISODate(raw.settledThrough)) state.settledThrough = raw.settledThrough;
  for (const k of Object.keys(raw)) if (!(k in state) && !(k in report.dropped) && k !== 'settings' && k !== 'settledThrough' && !COLLECTIONS.includes(k as never)) report.ignored.push(k);
  return { state, report };
}
