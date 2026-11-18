/* Realistic data for the upgrade tests: what the owner's store looked like under the OLD client (git b9dc102 / ee96961 era).
   Deterministic (seeded RNG). Items use the OLD id style (`Math.random().toString(36)` ids), the OLD settings shape (no id, no settledThrough
   inside `settings`), no `kv` collection, and legacy browser-only keys. */
import { DEFAULT_CHANNELS, seed } from '../../../src/seed';

export type Item = Record<string, any>;
export interface OldState {
  habits: Item[]; habitLogs: Item[]; tasks: Item[]; blocks: Item[]; workouts: Item[]; body: Item[]; journal: Item[]; rewards: Item[]; xp: Item[];
  wake: Item[]; books: Item[]; conversations: Item[]; rejections: Item[]; videos: Item[]; channels: Item[]; oneLogs: Item[];
  settings: Item; settledThrough: string;
}
export const LISTS = ['habits', 'habitLogs', 'tasks', 'blocks', 'workouts', 'body', 'journal', 'rewards', 'xp', 'books', 'conversations', 'rejections', 'videos', 'channels', 'oneLogs', 'wake'] as const;

export function rng(seedN: number) { let s = seedN >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const TODAY = '2026-11-17';

export function oldState(seedN = 7): OldState {
  const r = rng(seedN); const rid = () => Math.floor(r() * 36 ** 8).toString(36).padStart(8, '0') + Math.floor(r() * 36 ** 4).toString(36).padStart(4, '0');
  const base = seed();
  const habits: Item[] = [...base.habits.map((h) => ({ ...h })),
    { id: rid(), name: 'Cold shower', stat: 'discipline', cadence: { type: 'daily' }, xp: 10 },
    { id: rid(), name: 'Walk 8k steps', stat: 'body', cadence: { type: 'days', days: [1, 2, 3, 4, 5] }, xp: 15, unit: { label: 'k steps', target: 8 } },
    { id: rid(), name: 'Old habit', stat: 'mind', cadence: { type: 'daily' }, xp: 5, archived: true },
    { id: rid(), name: 'Pushups', stat: 'body', cadence: { type: 'weekly', perWeek: 5 }, xp: 12, minimum: '5 reps' }];
  const habitLogs: Item[] = []; const seen = new Set<string>();
  while (habitLogs.length < 300) {
    const h = habits[Math.floor(r() * habits.length)]; const date = addDays(TODAY, -Math.floor(r() * 60)); const k = h.id + date;
    if (seen.has(k)) continue; seen.add(k);
    habitLogs.push({ id: rid(), habitId: h.id, date, level: r() < 0.8 ? 'full' : 'min', ...(r() < 0.1 ? { note: 'felt good' } : {}) });
  }
  const xp: Item[] = habitLogs.slice(0, 200).map((l) => ({ id: rid(), date: l.date, stat: 'mind', amount: 10 + Math.floor(r() * 20), reason: 'habit', ref: `habit:${l.habitId}:${l.date}` }));
  const tasks: Item[] = Array.from({ length: 30 }, (_, i) => ({ id: rid(), title: `Task ${i}`, done: i % 3 === 0, ...(i % 3 === 0 ? { doneAt: `${addDays(TODAY, -i)}T10:00:00.000Z` } : {}), date: addDays(TODAY, i - 10), context: (['job', 'agency', 'personal', 'learning'] as const)[i % 4], tags: i % 2 ? ['x'] : [], effort: ((i % 3) + 1) as 1 | 2 | 3, stat: 'skill', ...(i === 4 ? { recurrence: { every: 'week', interval: 1 } } : {}), ...(i === 5 ? { horizon: 'short' } : {}) }));
  tasks.push({ id: rid(), title: 'Subtask', done: false, context: 'job', tags: [], effort: 1, stat: 'skill', parentId: tasks[2].id });
  const workouts: Item[] = Array.from({ length: 12 }, (_, i) => ({ id: rid(), date: addDays(TODAY, -i * 3), name: i % 2 ? 'Pull' : 'Push', notes: 'ok', sets: Array.from({ length: 5 }, (_, j) => ({ id: rid(), exercise: 'Bench', reps: 5 + j, weight: 40 + j, unit: 'kg' })) }));
  const body = Array.from({ length: 10 }, (_, i) => ({ id: rid(), date: addDays(TODAY, -i * 7), weightKg: 78 - i * 0.2, measurements: { waist: 82 } }));
  const journal = Array.from({ length: 20 }, (_, i) => ({ id: rid(), date: addDays(TODAY, -i), kind: 'daily', body: `Entry ${i} ` + 'lorem ipsum '.repeat(40), mood: ((i % 5) + 1) as number, energy: 3 }));
  const rejections = Array.from({ length: 137 }, (_, i) => ({ id: rid(), date: addDays(TODAY, -Math.floor(i / 3)), createdAt: `${addDays(TODAY, -Math.floor(i / 3))}T12:00:00.000Z`, what: `Asked ${i}`, ...(i % 4 ? { who: 'stranger' } : {}), ...(i % 5 ? { note: 'learned' } : {}) }));
  xp.push(...rejections.slice(0, 10).map((x) => ({ id: rid(), date: x.date, stat: 'discipline', amount: 5, reason: 'rejection', ref: `rej:${x.id}` })));
  const wake = Array.from({ length: 40 }, (_, i) => ({ date: addDays(TODAY, -i), time: `0${6 + (i % 2)}:${i % 2 ? '45' : '05'}` }));
  const oneLogs = Array.from({ length: 20 }, (_, i) => ({ id: rid(), date: addDays(TODAY, -i), exercise: 'pullups', sets: 3, reps: 5 }));
  const videos = Array.from({ length: 5 }, (_, i) => ({ id: rid(), ytId: `yt${i}`, title: `Vid ${i}`, tag: i % 2 ? 'fun' : 'learn', addedAt: `${TODAY}T08:00:00.000Z` }));
  return {
    habits, habitLogs, tasks, blocks: base.blocks.map((b) => ({ ...b })), workouts, body, journal, rewards: base.rewards.map((x) => ({ ...x })), xp, wake,
    books: [{ id: rid(), title: 'Deep Work', status: 'reading', pages: 300, page: 40 }, { id: rid(), title: 'Dune', status: 'done', kind: 'story', rating: 5 }],
    conversations: [{ id: rid(), date: TODAY, who: 'Sam', note: 'chat' }], rejections, videos, channels: DEFAULT_CHANNELS.map((c) => ({ ...c })), oneLogs,
    settings: { theme: 'dark', skin: 'canopy', wakeTime: '06:30', weekendWake: '08:00', name: 'Dinesh' },
    settledThrough: addDays(TODAY, -1),
  };
}

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** the browser-only keys of the old client (never synced): gym plan etc. */
export function legacyKeys(tag: string): Record<string, string> {
  return {
    'ledger-gym-plan': JSON.stringify({ sessions: [{ id: 'p1', name: `Push ${tag}`, days: [1], exercises: [{ id: 'e1', name: 'Bench', sets: 4, reps: 5, unit: 'kg' }] }] }),
    'ledger-gym-start': JSON.stringify(`2026-09-0${tag === 'laptop' ? 1 : 8}`),
    'ledger-gym-skills': JSON.stringify({ pullup: { level: tag === 'laptop' ? 2 : 3 } }),
    'ledger-cardio': JSON.stringify([{ date: TODAY, min: tag === 'laptop' ? 30 : 45 }]),
    [`ledger-mobility-${TODAY}`]: JSON.stringify({ done: tag === 'laptop' ? ['a', 'b'] : ['c'] }),
    'ledger-habit-view': JSON.stringify(tag === 'laptop' ? 'grid' : 'list'),
  };
}
