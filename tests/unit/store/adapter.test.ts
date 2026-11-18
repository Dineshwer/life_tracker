import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, uid } from '../../../src/store';
import { seed } from '../../../src/seed';
import { zustandStoreAdapter } from '../../../src/lib/storeAdapter';
import { COLLECTIONS } from '../../../src/sync/types';

beforeEach(() => { useStore.setState({ ...seed(), xp: [], habitLogs: [], wake: [], rejections: [], oneLogs: [], kv: [] } as never); });

describe('zustandStoreAdapter', () => {
  it('read returns every collection, meta carries settings + settledThrough', () => {
    const r = zustandStoreAdapter().read();
    for (const c of COLLECTIONS) expect(Array.isArray(r[c]), c).toBe(true);
    expect(r.meta[0]).toMatchObject({ id: 'settings', theme: 'dark', wakeTime: '07:00' });
    expect(r.meta[0].settledThrough).toBe(useStore.getState().settledThrough);
  });
  it('write applies all collections with a single notification', () => {
    const a = zustandStoreAdapter(); let n = 0; const off = a.subscribe(() => n++);
    a.write({ kv: [{ id: 'k', value: 'v' }], wake: [{ date: '2026-11-01', time: '07:00' }], rewards: [] });
    off(); expect(n).toBe(1);
    expect(useStore.getState().kv).toEqual([{ id: 'k', value: 'v' }]); expect(useStore.getState().wake).toHaveLength(1); expect(useStore.getState().rewards).toEqual([]);
  });
  it('write drops garbage, maps meta, settledThrough only moves forward, ignores bad meta', () => {
    const a = zustandStoreAdapter();
    useStore.setState({ syncCache: { id: 'c', owner: 'u', gen: 1, ready: true } }); // after the first completed cloud sync settledThrough only moves forward (before it, the cloud's date wins)
    a.write({ kv: [{ id: 'k', value: 'v' }, { id: 'bad', value: 1 }], meta: [{ id: 'settings', theme: 'light', wakeTime: '06:30', name: 'Z', settledThrough: '2000-01-01' }] });
    const s = useStore.getState();
    expect(s.kv).toHaveLength(1); expect(s.settings).toMatchObject({ theme: 'light', wakeTime: '06:30', name: 'Z' });
    expect(s.settledThrough > '2000-01-01').toBe(true);
    a.write({ meta: [{ id: 'settings', theme: 'nope' }] }); expect(useStore.getState().settings.theme).toBe('light');
    a.write({ meta: [{ id: 'settings', theme: 'dark', wakeTime: '06:30', name: 'Z', settledThrough: '2100-01-01' }] }); expect(useStore.getState().settledThrough).toBe('2100-01-01');
  });
  it('write collapses duplicate xp refs deterministically', () => {
    const e = (id: string) => ({ id, date: '2026-11-01', stat: 'body', amount: 5, reason: 'r', ref: 'same' });
    zustandStoreAdapter().write({ xp: [e('b'), e('a')] });
    expect(useStore.getState().xp.map((x) => x.id)).toEqual(['a']);
  });
});

describe('identity safety', () => {
  it('seed ids are identical on every call (second device creates no duplicates)', () => {
    const a = seed(), b = seed();
    expect(a.habits.map((h) => h.id)).toEqual(b.habits.map((h) => h.id));
    expect(a.blocks.map((h) => h.id)).toEqual(b.blocks.map((h) => h.id));
    expect(a.rewards.map((h) => h.id)).toEqual(b.rewards.map((h) => h.id));
    expect(a.channels.map((h) => h.id)).toEqual(b.channels.map((h) => h.id));
  });
  it('uid is unique and collision-free in bulk', () => { const s = new Set(Array.from({ length: 50_000 }, uid)); expect(s.size).toBe(50_000); });
  it('same habit logged on two devices yields the same log id and xp id', () => {
    const st = useStore.getState(); st.logHabit('read', '2026-11-01', 'full');
    const one = { logs: useStore.getState().habitLogs, xp: useStore.getState().xp };
    useStore.setState({ habitLogs: [], xp: [] }); useStore.getState().logHabit('read', '2026-11-01', 'full');
    expect(useStore.getState().habitLogs[0].id).toBe(one.logs[0].id); expect(useStore.getState().xp[0].id).toBe(one.xp[0].id);
  });
  it('settle is idempotent: days already settled elsewhere are not penalised twice', () => {
    useStore.setState({ settledThrough: '2020-01-01' });
    useStore.getState().settle(); const first = useStore.getState().xp.length;
    expect(first).toBeGreaterThan(0);
    useStore.setState({ settledThrough: '2020-01-01' }); useStore.getState().settle();
    expect(useStore.getState().xp).toHaveLength(first);
  });
  it('rejection milestone is not double awarded', () => {
    for (let i = 0; i < 10; i++) useStore.getState().addRejection(`r${i}`);
    expect(useStore.getState().xp.filter((e) => e.ref === 'rejmile:10')).toHaveLength(1);
    useStore.setState({ rejections: useStore.getState().rejections.slice(0, 9) }); useStore.getState().addRejection('again');
    expect(useStore.getState().xp.filter((e) => e.ref === 'rejmile:10')).toHaveLength(1);
  });
  it('wake tap twice awards once', () => { useStore.getState().tapWake(); useStore.getState().tapWake(); expect(useStore.getState().xp.filter((e) => e.ref?.startsWith('wake:'))).toHaveLength(1); });
  it('addXP with an existing ref is ignored', () => { const e = { date: '2026-11-01', stat: 'body' as const, amount: 1, reason: 'r', ref: 'q' }; useStore.getState().addXP(e); useStore.getState().addXP(e); expect(useStore.getState().xp).toHaveLength(1); });
});
