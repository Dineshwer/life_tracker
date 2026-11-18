import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type {
  Habit, HabitLog, Task, TimeBlock, Workout, BodyEntry, JournalEntry, Reward, XPEvent, Settings, WakeLog, Book, Conversation, Rejection, Video, Channel, OneLog, OneId, KV, ISODate,
} from './types';
import { addDays, today, isWeekend, fromISO, weekDays } from './lib/dates';
import { MISSED_PENALTY, TASK_XP } from './lib/xp';
import { REJECTION_XP } from './lib/rejections';
import { seed } from './seed';
import { COLLECTIONS } from './sync/types';
import { STORE_VERSION, migratePersisted, loadState } from './lib/migrate';
import { buildBackup, parseBackup } from './lib/backup';
import { rehydrateOnStorage } from './lib/crossTab';
import { normalizeLists, type SanitizeReport, coerceItem } from './lib/validate';

/** Collision-safe id: a random UUID (crypto.randomUUID, else 128 random bits from getRandomValues, else Math.random as a last resort). */
export const uid = (): string => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) return Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('') + Date.now().toString(36);
};
/** Events that carry a `ref` get a deterministic id, so two devices creating the same event offline produce ONE row, not two. */
const xpId = (ref: string | undefined): string => (ref ? `x:${ref}`.slice(0, 190) : uid());

interface State {
  habits: Habit[]; habitLogs: HabitLog[];
  tasks: Task[]; blocks: TimeBlock[];
  workouts: Workout[]; body: BodyEntry[];
  journal: JournalEntry[]; rewards: Reward[]; xp: XPEvent[];
  wake: WakeLog[]; books: Book[]; conversations: Conversation[]; rejections: Rejection[]; videos: Video[]; channels: Channel[]; oneLogs: OneLog[]; kv: KV[];
  settings: Settings; settledThrough: ISODate;
  /** Sync cache marker (NOT synced data, persisted with the store): proves the persisted store and the sync metadata belong together. See src/sync/engine.ts. */
  syncCache?: { id: string; owner: string; gen: number; ready: boolean };
  /** Transient: true while the first cloud sync of this device has not finished; settle() must not run on provisional (seed) dates. */
  holdSettle: boolean;

  // generic helpers
  upsert: <K extends CollectionKey>(key: K, item: State[K][number]) => void;
  remove: (key: CollectionKey, id: string) => void;

  // domain actions (all XP bookkeeping lives here so screens stay dumb)
  logHabit: (habitId: string, date: ISODate, level: 'full' | 'min' | null, extra?: Partial<HabitLog>) => void;
  toggleTask: (id: string) => void;
  tapWake: () => void;
  addXP: (e: Omit<XPEvent, 'id'>) => void;
  settle: () => void; // applies missed-day penalties for days before today, once
  claimReward: (id: string) => void;
  addOneLog: (exercise: OneId, sets: number, reps: number, effort?: number, date?: ISODate) => void;
  removeOneLog: (id: string) => void;
  addRejection: (what: string, extra?: { who?: string; note?: string }) => { n: number; xp: number; milestone?: string };
  removeRejection: (id: string) => void;
  addVideo: (ytId: string, title: string, tag: Video['tag']) => void;
  setVideoWatched: (id: string, watched: boolean) => void;
  removeVideo: (id: string) => void;
  setKV: (id: string, value: string) => void;
  addChannel: (handle: string, topic: Channel['topic']) => void;
  removeChannel: (id: string) => void;
  logWatched: (ytId: string, title: string, tag?: Video['tag']) => void;
  setTheme: (t: Settings['theme']) => void;
  setSkin: (id: string, mode: Settings['theme']) => void;
  exportAll: () => string;
  importAll: (json: string) => SanitizeReport;
}

type CollectionKey = 'habits' | 'habitLogs' | 'tasks' | 'blocks' | 'workouts' | 'body' | 'journal' | 'rewards' | 'xp' | 'books' | 'conversations' | 'rejections' | 'videos' | 'channels' | 'oneLogs' | 'kv';

/* Write-behind: the whole store is serialised on every change, which is expensive with thousands of items, so writes are coalesced (200 ms) and
   flushed when the page is hidden/closed. In Node (tests) there is no window and writes are immediate. A failed write (quota) is remembered but
   never thrown: the cloud copy is the source of truth, and the sync engine detects a persisted store that lags behind its metadata (cache marker). */
let pendingWrite: { name: string; value: string } | null = null;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
export let persistFailed = false;
function flushWrites() {
  if (writeTimer !== undefined) { clearTimeout(writeTimer); writeTimer = undefined; }
  if (!pendingWrite) return;
  const { name, value } = pendingWrite; pendingWrite = null;
  try { localStorage.setItem(name, value); persistFailed = false; } catch { persistFailed = true; }
}
function writeBehind(name: string, value: string) {
  if (typeof window === 'undefined') { try { localStorage.setItem(name, value); persistFailed = false; } catch { persistFailed = true; } return; }
  pendingWrite = { name, value };
  if (writeTimer === undefined) writeTimer = setTimeout(flushWrites, 200);
}
export const flushStoreWrites = flushWrites;
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushWrites);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushWrites(); });
}

/** localStorage that never throws. A blob that cannot be parsed is parked under `<name>-corrupt` (one copy) instead of being silently overwritten,
    and the store starts from the seed; the sync engine then rebuilds everything from the cloud copy. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      if (raw === null) return null;
      try { JSON.parse(raw); } catch { try { localStorage.setItem(`${name}-corrupt`, raw); } catch { /* quota */ } return null; }
      return raw;
    } catch { return null; }
  },
  setItem: (name, value) => writeBehind(name, value),
  removeItem: (name) => { pendingWrite = null; try { localStorage.removeItem(name); } catch { /* ignore */ } },
};

const isScheduled = (h: Habit, date: ISODate): boolean => {
  if (h.cadence.type === 'daily') return true;
  if (h.cadence.type === 'days') return h.cadence.days.includes(fromISO(date).getDay());
  return false; // weekly-N habits are settled per week below
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...seed(),
      holdSettle: false,

      upsert: (key, item) => set((s) => {
        const list = s[key] as { id: string }[];
        item = coerceItem(key, item);
        const i = list.findIndex((x) => x.id === (item as { id: string }).id);
        const next = i >= 0 ? list.map((x, j) => (j === i ? item : x)) : [...list, item];
        return { [key]: next } as Partial<State>;
      }),
      remove: (key, id) => set((s) => ({ [key]: (s[key] as { id: string }[]).filter((x) => x.id !== id) }) as Partial<State>),

      addXP: (e) => set((s) => (e.ref && s.xp.some((x) => x.ref === e.ref) ? s : { xp: [...s.xp, { ...e, id: xpId(e.ref) }] })),

      logHabit: (habitId, date, level, extra) => {
        const { habits, habitLogs, xp } = get();
        const h = habits.find((x) => x.id === habitId); if (!h) return;
        const existing = habitLogs.find((l) => l.habitId === habitId && l.date === date);
        const ref = `habit:${habitId}:${date}`;
        // a missed-day penalty for a day that is (now) logged is reversed: the day was done, the other device just had not synced yet
        const withoutOld = xp.filter((e) => e.ref !== ref && !(level && e.ref === `miss:${habitId}:${date}`));
        let logs = habitLogs.filter((l) => !(l.habitId === habitId && l.date === date));
        let newXP = withoutOld;
        if (level) {
          logs = [...logs, { id: existing?.id ?? `hl:${habitId}:${date}`.slice(0, 190), habitId, date, level, ...extra }];
          const amount = level === 'full' ? h.xp : Math.round(h.xp / 2);
          newXP = [...withoutOld, { id: xpId(ref), date, stat: h.stat, amount, reason: h.name + (level === 'min' ? ' (minimum)' : ''), ref }];
        }
        set({ habitLogs: logs, xp: newXP });
      },

      toggleTask: (id) => {
        const s = get(); const t = s.tasks.find((x) => x.id === id); if (!t) return;
        const done = !t.done; const ref = `task:${id}`;
        const xp = s.xp.filter((e) => e.ref !== ref);
        if (done) xp.push({ id: xpId(ref), date: today(), stat: t.stat, amount: TASK_XP[t.effort], reason: t.title, ref });
        let tasks = s.tasks.map((x) => (x.id === id ? { ...x, done, doneAt: done ? new Date().toISOString() : undefined } : x));
        // recurring: spawn the next occurrence when completed
        if (done && t.recurrence) {
          const step = t.recurrence.every === 'day' ? t.recurrence.interval : t.recurrence.every === 'week' ? 7 * t.recurrence.interval : 30 * t.recurrence.interval;
          const nextDate = addDays(t.date && t.date > today() ? t.date : today(), step); // overdue: restart from today, never spawn an already-overdue copy
          // undo + redo must not spawn a second copy of the same next occurrence
          if (!tasks.some((x) => x.id !== id && !x.done && x.title === t.title && x.date === nextDate && x.parentId === t.parentId && x.recurrence)) tasks = [...tasks, { ...t, id: uid(), done: false, doneAt: undefined, date: nextDate }];
        }
        set({ tasks, xp });
      },

      tapWake: () => {
        const s = get(); const d = today();
        if (s.wake.some((w) => w.date === d)) return;
        const now = new Date(); const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const target = isWeekend(d) && s.settings.weekendWake ? s.settings.weekendWake : s.settings.wakeTime;
        const [th, tm] = target.split(':').map(Number);
        const late = now.getHours() * 60 + now.getMinutes() - (th * 60 + tm);
        const onTime = late <= 15;
        set({
          wake: [...s.wake, { date: d, time }],
          xp: [...s.xp.filter((e) => e.ref !== `wake:${d}`), { id: xpId(`wake:${d}`), date: d, stat: 'discipline', amount: onTime ? 15 : 5, reason: onTime ? 'Up on time' : 'Up late', ref: `wake:${d}` }],
        });
      },

      settle: () => {
        if (get().holdSettle) return; // the first cloud sync decides how far days were already settled
        const s = get(); const t = today();
        let d = addDays(s.settledThrough, 1);
        const newXP: XPEvent[] = [];
        while (d < t) {
          for (const h of s.habits.filter((x) => !x.archived)) {
            if (isScheduled(h, d) && !s.habitLogs.some((l) => l.habitId === h.id && l.date === d)) {
              newXP.push({ id: xpId(`miss:${h.id}:${d}`), date: d, stat: h.stat, amount: -MISSED_PENALTY, reason: `Missed: ${h.name}`, ref: `miss:${h.id}:${d}` });
            }
          }
          // weekly-N habits: settle on Sunday
          if (fromISO(d).getDay() === 0) {
            for (const h of s.habits.filter((x) => !x.archived && x.cadence.type === 'weekly')) {
              const per = (h.cadence as { perWeek: number }).perWeek;
              const done = weekDays(d).filter((x) => s.habitLogs.some((l) => l.habitId === h.id && l.date === x)).length;
              if (done < per) newXP.push({ id: xpId(`miss:${h.id}:wk:${d}`), date: d, stat: h.stat, amount: -MISSED_PENALTY * (per - done), reason: `Short this week: ${h.name}`, ref: `miss:${h.id}:wk:${d}` });
            }
          }
          d = addDays(d, 1);
        }
        const have = new Set(s.xp.map((e) => e.ref).filter(Boolean)); // another device may already have settled these days
        const fresh = newXP.filter((e) => !have.has(e.ref));
        set({ xp: [...s.xp, ...fresh], settledThrough: addDays(t, -1) > s.settledThrough ? addDays(t, -1) : s.settledThrough });
      },

      addOneLog: (exercise, sets, reps, effort, date = today()) => {
        const s = get(); const id = uid();
        const log: OneLog = { id, date, exercise, sets, reps, ...(effort ? { effort } : {}) };
        const ref = `one:${date}`;
        // one small XP reward per day for keeping the minimum, so logging twice cannot farm XP
        const xp = s.xp.some((e) => e.ref === ref) ? s.xp : [...s.xp, { id: xpId(ref), date, stat: 'discipline' as const, amount: 10, reason: 'Kept the daily minimum', ref }];
        set({ oneLogs: [...s.oneLogs, log], xp });
      },
      removeOneLog: (id) => {
        const s = get(); const log = s.oneLogs.find((l) => l.id === id); if (!log) return;
        const oneLogs = s.oneLogs.filter((l) => l.id !== id);
        const xp = oneLogs.some((l) => l.date === log.date) ? s.xp : s.xp.filter((e) => e.ref !== `one:${log.date}`);
        set({ oneLogs, xp });
      },

      addRejection: (what, extra) => {
        const s = get(); const id = uid();
        const entry: Rejection = coerceItem('rejections', { id, date: today(), createdAt: new Date().toISOString(), what: what.trim(), ...(extra?.who?.trim() ? { who: extra.who.trim() } : {}), ...(extra?.note?.trim() ? { note: extra.note.trim() } : {}) });
        const n = s.rejections.length + 1;
        const events: XPEvent[] = [{ id: xpId(`rej:${id}`), date: today(), stat: 'discipline', amount: REJECTION_XP, reason: `Rejection #${n}`, ref: `rej:${id}` }];
        let milestone: string | undefined; let bonus = 0;
        if (n % 1000 === 0) { bonus = 1000; milestone = 'All 1,000. You did it.'; }
        else if (n % 100 === 0) { bonus = 150; milestone = `Block ${n / 100} complete.`; }
        else if (n % 10 === 0) { bonus = 30; milestone = `Run of 10 complete (${n}).`; }
        if (bonus && !s.xp.some((e) => e.ref === `rejmile:${n}`)) events.push({ id: xpId(`rejmile:${n}`), date: today(), stat: 'discipline', amount: bonus, reason: milestone!, ref: `rejmile:${n}` });
        set({ rejections: [...s.rejections, entry], xp: [...s.xp, ...events] });
        return { n, xp: REJECTION_XP + bonus, milestone };
      },
      removeRejection: (id) => {
        const s = get();
        const rejections = s.rejections.filter((r) => r.id !== id);
        const total = rejections.length;
        const xp = s.xp.filter((e) => {
          if (e.ref === `rej:${id}`) return false;
          if (e.ref?.startsWith('rejmile:')) return Number(e.ref.split(':')[1]) <= total;
          return true;
        });
        set({ rejections, xp });
      },

      addVideo: (ytId, title, tag) => set((s) => s.videos.some((v) => v.ytId === ytId) ? s : { videos: [...s.videos, coerceItem('videos', { id: uid(), ytId, title: title.trim() || 'Untitled video', tag, addedAt: new Date().toISOString() })] }),
      setVideoWatched: (id, watched) => set((s) => ({ videos: s.videos.map((v) => (v.id === id ? { ...v, watchedAt: watched ? new Date().toISOString() : undefined } : v)) })),
      logWatched: (ytId, title, tag = 'learn') => set((s) => {
        const now = new Date().toISOString();
        if (s.videos.some((v) => v.ytId === ytId)) return { videos: s.videos.map((v) => (v.ytId === ytId ? { ...v, watchedAt: now } : v)) };
        return { videos: [...s.videos, coerceItem('videos', { id: uid(), ytId, title: title.trim() || 'Untitled video', tag, addedAt: now, watchedAt: now })] };
      }),
      addChannel: (handle, topic) => set((s) => {
        const h = handle.trim().replace(/^https?:\/\/(www\.)?youtube\.com\//, '').replace(/\/.*$/, '');
        const clean = h.startsWith('@') ? h : `@${h}`;
        const id = clean.replace(/^@/, '').toLowerCase();
        return !id || s.channels.some((c) => c.id === id) ? s : { channels: [...s.channels, { id, handle: clean, topic }] };
      }),
      removeChannel: (id) => set((s) => ({ channels: s.channels.filter((c) => c.id !== id) })),
      setKV: (id, value) => set((s) => (s.kv.find((k) => k.id === id)?.value === value ? s : { kv: s.kv.some((k) => k.id === id) ? s.kv.map((k) => (k.id === id ? { ...k, value } : k)) : [...s.kv, { id, value }] })),
      removeVideo: (id) => set((s) => ({ videos: s.videos.filter((v) => v.id !== id) })),

      claimReward: (id) => set((s) => ({ rewards: s.rewards.map((r) => (r.id === id ? { ...r, claimedAt: new Date().toISOString() } : r)) })),
      setTheme: (theme) => set((s) => ({ settings: { ...s.settings, theme } })),
      setSkin: (skin, theme) => set((s) => ({ settings: { ...s.settings, skin, theme } })),
      exportAll: () => JSON.stringify(buildBackup(), null, 2),
      importAll: (json) => {
        const { data, report } = parseBackup(json); // throws a readable error; never loads unvalidated data
        const { settings, settledThrough, ...lists } = data as Record<string, unknown>;
        const patch: Record<string, unknown> = { ...lists };
        if (settings) patch.settings = { ...get().settings, ...(settings as object) };
        if (typeof settledThrough === 'string') patch.settledThrough = settledThrough;
        set(normalizeLists(patch) as Partial<State>);
        return report;
      },
    }),
    {
      name: 'life-tracker-v1', version: STORE_VERSION,
      storage: createJSONStorage(() => safeStorage),
      migrate: (persisted, version) => migratePersisted(persisted, version) as unknown as State,
      // always validate what is loaded from the browser cache (also when the version did not change): invalid items are dropped
      partialize: (s) => { const { holdSettle: _h, ...rest } = s; void _h; return rest as unknown as State; },
      merge: (persisted, current) => ({ ...current, ...(loadState((persisted && typeof persisted === 'object' ? persisted : {}) as Record<string, unknown>, seed() as never) as unknown as Partial<State>) }),
    },
  ),
);

/** Another tab wrote the store blob: fold it into this tab's memory WITHOUT losing anything either tab did (union by id). While this tab has unflushed
    changes of its own, its copy of an item that both have wins; otherwise the other tab's (newer) copy wins. Deletions travel through the sync
    (tombstones), not through this merge. Returns true when the state changed (so two tabs cannot ping-pong writes). */
export function mergeOtherTabBlob(raw: string | null): boolean {
  if (!raw) return false;
  let p: Record<string, unknown>;
  try { const j = JSON.parse(raw) as { state?: unknown }; if (!j.state || typeof j.state !== 'object') return false; p = loadState(j.state as Record<string, unknown>, seed() as never) as unknown as Record<string, unknown>; } catch { return false; }
  const dirty = pendingWrite !== null; const cur = useStore.getState() as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {}; let changed = false;
  for (const col of COLLECTIONS) {
    if (col === 'meta') continue;
    const mine = cur[col] as { id?: string; date?: string }[], theirs = p[col] as { id?: string; date?: string }[] | undefined;
    if (!Array.isArray(theirs)) continue;
    const kf = (it: { id?: string; date?: string }) => (col === 'wake' ? it.date : it.id);
    const idx = new Map(mine.map((it, i) => [kf(it), i]));
    let out: typeof mine | null = null;
    for (const it of theirs) {
      const i = idx.get(kf(it));
      if (i === undefined) { out = out ?? [...mine]; out.push(it); }
      else if (!dirty && JSON.stringify(mine[i]) !== JSON.stringify(it)) { out = out ?? [...mine]; out[i] = it; }
    }
    if (out) { patch[col] = out; changed = true; }
  }
  if (!dirty) {
    if (p.settings && JSON.stringify(p.settings) !== JSON.stringify(cur.settings)) { patch.settings = p.settings; changed = true; }
    if (typeof p.settledThrough === 'string' && p.settledThrough > (cur.settledThrough as string)) { patch.settledThrough = p.settledThrough; changed = true; }
    if (p.syncCache && JSON.stringify(p.syncCache) !== JSON.stringify(cur.syncCache)) { patch.syncCache = p.syncCache; changed = true; }
  }
  if (changed) useStore.setState(normalizeLists(patch) as Partial<State>);
  return changed;
}

// another tab wrote the store: load its changes on top of ours, then keep going
if (typeof window !== 'undefined') {
  rehydrateOnStorage(window, 'life-tracker-v1', { persist: { rehydrate: () => { try { mergeOtherTabBlob(localStorage.getItem('life-tracker-v1')); } catch { /* ignore */ } } } });
}
