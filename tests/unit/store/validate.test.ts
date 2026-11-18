import { describe, it, expect } from 'vitest';
import { COLLECTIONS } from '../../../src/sync/types';
import { validateItem, sanitizeState, dedupeXP, dedupeHabitLogs, isISODate } from '../../../src/lib/validate';

const good: Record<string, unknown> = {
  habits: { id: 'meditate', name: 'Meditation', stat: 'mind', cadence: { type: 'daily' }, xp: 20, minimum: '2 min' },
  habitLogs: { id: 'hl:meditate:2026-11-01', habitId: 'meditate', date: '2026-11-01', level: 'full' },
  tasks: { id: 't1', title: 'Ship it', done: false, context: 'job', tags: [], effort: 2, stat: 'skill' },
  blocks: { id: 'b1', title: 'Job', start: '09:30', end: '18:00', day: 'weekday', kind: 'fixed' },
  workouts: { id: 'w1', date: '2026-11-01', name: 'Push', sets: [{ id: 's1', exercise: 'Bench', reps: 5, weight: 60, unit: 'kg' }] },
  body: { id: 'b1', date: '2026-11-01', weightKg: 70.5 },
  journal: { id: 'j1', date: '2026-11-01', body: 'hi', kind: 'daily', mood: 3 },
  rewards: { id: 'r1', title: 'Meal', cost: 500 },
  xp: { id: 'x1', date: '2026-11-01', stat: 'body', amount: 10, reason: 'x', ref: 'task:1' },
  books: { id: 'bk1', title: 'Deep Work', status: 'reading' }, // no `kind`: legacy
  conversations: { id: 'c1', date: '2026-11-01', who: 'Sam' },
  rejections: { id: 'rj1', date: '2026-11-01', createdAt: '2026-11-01T10:00:00.000Z', what: 'asked' },
  videos: { id: 'v1', ytId: 'abc', title: 'T', tag: 'learn', addedAt: '2026-11-01T10:00:00.000Z' },
  channels: { id: 'ippsec', handle: '@ippsec', topic: 'sec' },
  oneLogs: { id: 'o1', date: '2026-11-01', exercise: 'pullups', sets: 1, reps: 10 },
  kv: { id: 'ledger-gym-start', value: '2026-10-01' },
  wake: { date: '2026-11-01', time: '07:05' },
  meta: { id: 'settings', theme: 'dark', wakeTime: '07:00', name: 'D', settledThrough: '2026-11-01' },
};
const bad: Record<string, unknown[]> = {
  habits: [{ ...(good.habits as object), stat: 'luck' }, { ...(good.habits as object), xp: NaN }, { ...(good.habits as object), cadence: { type: 'weekly', perWeek: 9 } }, { ...(good.habits as object), id: '' }],
  habitLogs: [{ ...(good.habitLogs as object), date: '2026-13-40' }, { ...(good.habitLogs as object), level: 'half' }],
  tasks: [{ ...(good.tasks as object), effort: 7 }, { ...(good.tasks as object), tags: 'a' }, { ...(good.tasks as object), title: 5 }],
  blocks: [{ ...(good.blocks as object), start: '25:00' }, { ...(good.blocks as object), kind: 'x' }],
  workouts: [{ ...(good.workouts as object), sets: [{ id: 's', exercise: 'x', reps: -1, weight: 1, unit: 'kg' }] }, { ...(good.workouts as object), date: 'today' }],
  body: [{ ...(good.body as object), weightKg: Infinity }, { ...(good.body as object), weightKg: -3 }],
  journal: [{ ...(good.journal as object), mood: 9 }, { ...(good.journal as object), body: 'x'.repeat(300_000) }],
  rewards: [{ ...(good.rewards as object), cost: -1 }],
  xp: [{ ...(good.xp as object), amount: 1e9 }, { ...(good.xp as object), amount: '5' }, { ...(good.xp as object), date: '2026-02-30' }],
  books: [{ ...(good.books as object), status: 'lost' }, { ...(good.books as object), kind: 'comic' }],
  conversations: [{ id: 'c', date: '2026-11-01' }],
  rejections: [{ ...(good.rejections as object), createdAt: 'nope' }],
  videos: [{ ...(good.videos as object), tag: 'x' }],
  channels: [{ ...(good.channels as object), topic: 'zzz' }],
  oneLogs: [{ ...(good.oneLogs as object), exercise: 'curls' }],
  kv: [{ id: 'k', value: 5 }, { value: 'x' }],
  wake: [{ date: '2026-11-01', time: '7am' }, { time: '07:00' }],
  meta: [{ ...(good.meta as object), id: 'other' }, { ...(good.meta as object), theme: 'blue' }],
};

describe('validateItem', () => {
  it('covers every collection', () => { for (const c of COLLECTIONS) { expect(good[c], c).toBeDefined(); expect(bad[c], c).toBeDefined(); } });
  for (const c of COLLECTIONS) {
    it(`${c}: accepts a valid item`, () => expect(validateItem(c, good[c])).toBe(true));
    it(`${c}: rejects invalid items`, () => { for (const b of bad[c]) expect(validateItem(c, b), JSON.stringify(b).slice(0, 80)).toBe(false); });
    it(`${c}: rejects non-objects`, () => { for (const x of [null, undefined, 5, 'a', [], true]) expect(validateItem(c, x)).toBe(false); });
  }
  it('rejects unknown collections', () => expect(validateItem('nope', { id: 'a' })).toBe(false));
  it('keeps unknown extra fields valid', () => expect(validateItem('habits', { ...(good.habits as object), future: 1 })).toBe(true));
  it('accepts null/undefined optional fields', () => expect(validateItem('books', { ...(good.books as object), author: undefined, kind: null })).toBe(true));
  it('ISODate is a real calendar date', () => { expect(isISODate('2024-02-29')).toBe(true); expect(isISODate('2025-02-29')).toBe(false); expect(isISODate('2025-2-9')).toBe(false); });
});

describe('sanitizeState', () => {
  it('drops invalid items, dedupes, reports', () => {
    const { state, report } = sanitizeState({
      habits: [good.habits, bad.habits[0]], xp: [good.xp, { ...(good.xp as object), id: 'x0' }, { ...(good.xp as object), amount: 'a', id: 'x9' }], tasks: 'nope', settings: { theme: 'dark', wakeTime: '07:00', name: 'D' }, junk: 1, settledThrough: '2026-11-01',
    });
    expect((state.habits as unknown[]).length).toBe(1);
    expect((state.xp as { id: string }[]).map((e) => e.id)).toEqual(['x0']); // same ref: the smallest id is kept
    expect(report.dropped.habits.count).toBe(1);
    expect(report.dropped.tasks.count).toBe(1);
    expect(report.ignored).toContain('junk');
    expect(state.tasks).toBeUndefined();
    expect(state.settings).toEqual({ theme: 'dark', wakeTime: '07:00', name: 'D' });
  });
  it('never throws on garbage', () => { for (const x of [null, 1, 'x', [], { habits: [null, 1, []] }]) expect(() => sanitizeState(x)).not.toThrow(); });
  it('flags invalid settings', () => expect(sanitizeState({ settings: { theme: 'x' } }).report.settingsReset).toBe(true));
  it('drops duplicate ids', () => expect((sanitizeState({ kv: [good.kv, good.kv] }).state.kv as unknown[]).length).toBe(1));
});

describe('dedupe', () => {
  it('xp: one event per ref, deterministic regardless of order', () => {
    const a = { id: 'b', ref: 'r' }, b = { id: 'a', ref: 'r' }, c = { id: 'z' };
    expect(dedupeXP([a, b, c])).toEqual([b, c]);
    expect(dedupeXP([b, a, c])).toEqual([b, c]);
  });
  it('habit logs: one per habit+day', () => {
    const l = [{ id: 'y', habitId: 'h', date: 'd' }, { id: 'x', habitId: 'h', date: 'd' }, { id: 'q', habitId: 'h', date: 'e' }];
    expect(dedupeHabitLogs(l).map((x) => x.id)).toEqual(['x', 'q']);
  });
});
