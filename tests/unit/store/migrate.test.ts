import { describe, it, expect } from 'vitest';
import { migratePersisted, STORE_VERSION, MIGRATIONS } from '../../../src/lib/migrate';
import { DEFAULT_CHANNELS } from '../../../src/seed';

const v1 = { habits: [{ id: 'meditate', name: 'M', stat: 'mind', cadence: { type: 'daily' }, xp: 20 }], habitLogs: [], tasks: [], blocks: [], workouts: [], body: [], journal: [], rewards: [], xp: [], wake: [], settings: { theme: 'light', wakeTime: '06:00', name: 'X' }, settledThrough: '2026-01-01', channels: [{ id: 'old', handle: '@old', topic: 'sec' }], myUnknown: 7 };

describe('persisted store migrations', () => {
  it('has a step for every version up to current', () => { for (let n = 2; n <= STORE_VERSION; n++) expect(MIGRATIONS[n]).toBeTypeOf('function'); });
  it('v1 -> current: new channels, new collections as [], data and settings kept, unknown fields kept', () => {
    const o = migratePersisted(v1, 1) as Record<string, unknown>;
    expect(o.channels).toEqual(DEFAULT_CHANNELS);
    for (const k of ['videos', 'books', 'conversations', 'rejections', 'oneLogs', 'kv']) expect(o[k]).toEqual([]);
    expect((o.habits as unknown[]).length).toBe(1);
    expect((o.settings as { theme: string; name: string; wakeTime: string })).toMatchObject({ theme: 'light', name: 'X', wakeTime: '06:00' });
    expect(o.settledThrough).toBe('2026-01-01');
    expect(o.myUnknown).toBe(7);
  });
  it('v2 -> v3 keeps the user channels and adds kv', () => {
    const o = migratePersisted({ ...v1, videos: [], books: [], conversations: [], rejections: [], oneLogs: [] }, 2) as Record<string, unknown>;
    expect((o.channels as { id: string }[])[0].id).toBe('old');
    expect(o.kv).toEqual([]);
  });
  it('current version: still sanitizes', () => {
    const o = migratePersisted({ ...v1, kv: [{ id: 'a', value: 'b' }, { id: 'c', value: 3 }], tasks: [{ nope: 1 }] }, STORE_VERSION) as Record<string, unknown>;
    expect(o.kv).toEqual([{ id: 'a', value: 'b' }]);
    expect(o.tasks).toEqual([]);
  });
  it('missing and invalid settings fall back to defaults', () => {
    expect((migratePersisted({ ...v1, settings: { theme: 'neon' } }, 2) as { settings: { theme: string } }).settings.theme).toBe('dark');
    expect((migratePersisted({}, 1) as { settings: { wakeTime: string } }).settings.wakeTime).toBe('07:00');
  });
  it('never throws on corrupt input and starts from the seed', () => {
    for (const p of [null, undefined, 5, 'x', [], { habits: 'x', xp: [null] }]) for (const v of [0, 1, 2, 3, NaN, 99]) {
      const o = migratePersisted(p, v) as { habits: unknown[]; kv: unknown[] };
      expect(Array.isArray(o.habits)).toBe(true); expect(Array.isArray(o.kv)).toBe(true);
    }
    expect((migratePersisted(null, 1) as { habits: unknown[] }).habits.length).toBeGreaterThan(5);
  });
});
