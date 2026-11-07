import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Habit, HabitLog, Task, TimeBlock, Workout, BodyEntry, JournalEntry, Reward, XPEvent, Settings, WakeLog, Book, Conversation, Rejection, Video, Channel, ISODate,
} from './types';
import { addDays, today, isWeekend, fromISO, weekDays } from './lib/dates';
import { MISSED_PENALTY, TASK_XP } from './lib/xp';
import { REJECTION_XP } from './lib/rejections';
import { seed } from './seed';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

interface State {
  habits: Habit[]; habitLogs: HabitLog[];
  tasks: Task[]; blocks: TimeBlock[];
  workouts: Workout[]; body: BodyEntry[];
  journal: JournalEntry[]; rewards: Reward[]; xp: XPEvent[];
  wake: WakeLog[]; books: Book[]; conversations: Conversation[]; rejections: Rejection[]; videos: Video[]; channels: Channel[];
  settings: Settings; settledThrough: ISODate;

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
  addRejection: (what: string, extra?: { who?: string; note?: string }) => { n: number; xp: number; milestone?: string };
  removeRejection: (id: string) => void;
  addVideo: (ytId: string, title: string, tag: Video['tag']) => void;
  setVideoWatched: (id: string, watched: boolean) => void;
  removeVideo: (id: string) => void;
  addChannel: (handle: string, topic: Channel['topic']) => void;
  removeChannel: (id: string) => void;
  logWatched: (ytId: string, title: string, tag?: Video['tag']) => void;
  setTheme: (t: Settings['theme']) => void;
  setSkin: (id: string, mode: Settings['theme']) => void;
  exportAll: () => string;
  importAll: (json: string) => void;
}

type CollectionKey = 'habits' | 'habitLogs' | 'tasks' | 'blocks' | 'workouts' | 'body' | 'journal' | 'rewards' | 'xp' | 'books' | 'conversations' | 'rejections' | 'videos' | 'channels';

const isScheduled = (h: Habit, date: ISODate): boolean => {
  if (h.cadence.type === 'daily') return true;
  if (h.cadence.type === 'days') return h.cadence.days.includes(fromISO(date).getDay());
  return false; // weekly-N habits are settled per week below
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...seed(),

      upsert: (key, item) => set((s) => {
        const list = s[key] as { id: string }[];
        const i = list.findIndex((x) => x.id === (item as { id: string }).id);
        const next = i >= 0 ? list.map((x, j) => (j === i ? item : x)) : [...list, item];
        return { [key]: next } as Partial<State>;
      }),
      remove: (key, id) => set((s) => ({ [key]: (s[key] as { id: string }[]).filter((x) => x.id !== id) }) as Partial<State>),

      addXP: (e) => set((s) => ({ xp: [...s.xp, { ...e, id: uid() }] })),

      logHabit: (habitId, date, level, extra) => {
        const { habits, habitLogs, xp } = get();
        const h = habits.find((x) => x.id === habitId); if (!h) return;
        const existing = habitLogs.find((l) => l.habitId === habitId && l.date === date);
        const ref = `habit:${habitId}:${date}`;
        const withoutOld = xp.filter((e) => e.ref !== ref);
        let logs = habitLogs.filter((l) => !(l.habitId === habitId && l.date === date));
        let newXP = withoutOld;
        if (level) {
          logs = [...logs, { id: existing?.id ?? uid(), habitId, date, level, ...extra }];
          const amount = level === 'full' ? h.xp : Math.round(h.xp / 2);
          newXP = [...withoutOld, { id: uid(), date, stat: h.stat, amount, reason: h.name + (level === 'min' ? ' (minimum)' : ''), ref }];
        }
        set({ habitLogs: logs, xp: newXP });
      },

      toggleTask: (id) => {
        const s = get(); const t = s.tasks.find((x) => x.id === id); if (!t) return;
        const done = !t.done; const ref = `task:${id}`;
        const xp = s.xp.filter((e) => e.ref !== ref);
        if (done) xp.push({ id: uid(), date: today(), stat: t.stat, amount: TASK_XP[t.effort], reason: t.title, ref });
        let tasks = s.tasks.map((x) => (x.id === id ? { ...x, done, doneAt: done ? new Date().toISOString() : undefined } : x));
        // recurring: spawn the next occurrence when completed
        if (done && t.recurrence) {
          const step = t.recurrence.every === 'day' ? t.recurrence.interval : t.recurrence.every === 'week' ? 7 * t.recurrence.interval : 30 * t.recurrence.interval;
          tasks = [...tasks, { ...t, id: uid(), done: false, doneAt: undefined, date: addDays(t.date ?? today(), step) }];
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
          xp: [...s.xp, { id: uid(), date: d, stat: 'discipline', amount: onTime ? 15 : 5, reason: onTime ? 'Up on time' : 'Up late', ref: `wake:${d}` }],
        });
      },

      settle: () => {
        const s = get(); const t = today();
        let d = addDays(s.settledThrough, 1);
        const newXP: XPEvent[] = [];
        while (d < t) {
          for (const h of s.habits.filter((x) => !x.archived)) {
            if (isScheduled(h, d) && !s.habitLogs.some((l) => l.habitId === h.id && l.date === d)) {
              newXP.push({ id: uid(), date: d, stat: h.stat, amount: -MISSED_PENALTY, reason: `Missed: ${h.name}`, ref: `miss:${h.id}:${d}` });
            }
          }
          // weekly-N habits: settle on Sunday
          if (fromISO(d).getDay() === 0) {
            for (const h of s.habits.filter((x) => !x.archived && x.cadence.type === 'weekly')) {
              const per = (h.cadence as { perWeek: number }).perWeek;
              const done = weekDays(d).filter((x) => s.habitLogs.some((l) => l.habitId === h.id && l.date === x)).length;
              if (done < per) newXP.push({ id: uid(), date: d, stat: h.stat, amount: -MISSED_PENALTY * (per - done), reason: `Short this week: ${h.name}`, ref: `miss:${h.id}:wk:${d}` });
            }
          }
          d = addDays(d, 1);
        }
        set({ xp: [...s.xp, ...newXP], settledThrough: addDays(t, -1) });
      },

      addRejection: (what, extra) => {
        const s = get(); const id = uid();
        const entry: Rejection = { id, date: today(), createdAt: new Date().toISOString(), what: what.trim(), ...(extra?.who?.trim() ? { who: extra.who.trim() } : {}), ...(extra?.note?.trim() ? { note: extra.note.trim() } : {}) };
        const n = s.rejections.length + 1;
        const events: XPEvent[] = [{ id: uid(), date: today(), stat: 'discipline', amount: REJECTION_XP, reason: `Rejection #${n}`, ref: `rej:${id}` }];
        let milestone: string | undefined; let bonus = 0;
        if (n % 1000 === 0) { bonus = 1000; milestone = 'All 1,000. You did it.'; }
        else if (n % 100 === 0) { bonus = 150; milestone = `Block ${n / 100} complete.`; }
        else if (n % 10 === 0) { bonus = 30; milestone = `Run of 10 complete (${n}).`; }
        if (bonus) events.push({ id: uid(), date: today(), stat: 'discipline', amount: bonus, reason: milestone!, ref: `rejmile:${n}` });
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

      addVideo: (ytId, title, tag) => set((s) => s.videos.some((v) => v.ytId === ytId) ? s : { videos: [...s.videos, { id: uid(), ytId, title: title.trim() || 'Untitled video', tag, addedAt: new Date().toISOString() }] }),
      setVideoWatched: (id, watched) => set((s) => ({ videos: s.videos.map((v) => (v.id === id ? { ...v, watchedAt: watched ? new Date().toISOString() : undefined } : v)) })),
      logWatched: (ytId, title, tag = 'learn') => set((s) => {
        const now = new Date().toISOString();
        if (s.videos.some((v) => v.ytId === ytId)) return { videos: s.videos.map((v) => (v.ytId === ytId ? { ...v, watchedAt: now } : v)) };
        return { videos: [...s.videos, { id: uid(), ytId, title: title.trim() || 'Untitled video', tag, addedAt: now, watchedAt: now }] };
      }),
      addChannel: (handle, topic) => set((s) => {
        const h = handle.trim().replace(/^https?:\/\/(www\.)?youtube\.com\//, '').replace(/\/.*$/, '');
        const clean = h.startsWith('@') ? h : `@${h}`;
        const id = clean.replace(/^@/, '').toLowerCase();
        return !id || s.channels.some((c) => c.id === id) ? s : { channels: [...s.channels, { id, handle: clean, topic }] };
      }),
      removeChannel: (id) => set((s) => ({ channels: s.channels.filter((c) => c.id !== id) })),
      removeVideo: (id) => set((s) => ({ videos: s.videos.filter((v) => v.id !== id) })),

      claimReward: (id) => set((s) => ({ rewards: s.rewards.map((r) => (r.id === id ? { ...r, claimedAt: new Date().toISOString() } : r)) })),
      setTheme: (theme) => set((s) => ({ settings: { ...s.settings, theme } })),
      setSkin: (skin, theme) => set((s) => ({ settings: { ...s.settings, skin, theme } })),
      exportAll: () => JSON.stringify(get(), null, 2),
      importAll: (json) => set(JSON.parse(json)),
    }),
    { name: 'life-tracker-v1', version: 1 },
  ),
);
