import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../../../src/store';
import { buildBackup, parseBackup } from '../../../src/lib/backup';

beforeEach(() => { useStore.setState({ kv: [{ id: 'ledger-gym-start', value: '2026-10-01' }], rejections: [], xp: [] }); });

describe('backup', () => {
  it('round trip: export -> import restores everything incl kv and settings', () => {
    useStore.getState().addRejection('asked');
    useStore.getState().setTheme('light');
    const text = useStore.getState().exportAll();
    const b = JSON.parse(text);
    expect(b).toMatchObject({ format: 'ledger-backup', version: 2 });
    expect(b.collections.kv).toHaveLength(1);
    useStore.setState({ kv: [], rejections: [], xp: [] }); useStore.getState().setTheme('dark');
    const rep = useStore.getState().importAll(text);
    expect(rep.droppedTotal).toBe(0);
    const s = useStore.getState();
    expect(s.kv).toEqual([{ id: 'ledger-gym-start', value: '2026-10-01' }]);
    expect(s.rejections).toHaveLength(1); expect(s.xp).toHaveLength(1); expect(s.settings.theme).toBe('light');
  });
  it('accepts the old pre-versioned shape and partial files', () => {
    const legacy = JSON.stringify({ habits: [], kv: [{ id: 'a', value: 'b' }], settings: { theme: 'light', wakeTime: '07:00', name: 'N' } });
    const { data } = parseBackup(legacy);
    expect(data.kv).toEqual([{ id: 'a', value: 'b' }]);
    expect(Object.keys(data)).not.toContain('tasks'); // untouched on import
  });
  it('drops invalid items and reports them instead of loading', () => {
    const { data, report } = parseBackup(JSON.stringify({ format: 'ledger-backup', version: 2, collections: { kv: [{ id: 'a', value: 'b' }, { id: 'x', value: {} }], xp: [{ id: 1 }] } }));
    expect(data.kv).toHaveLength(1); expect(report.droppedTotal).toBe(2);
  });
  it('hostile inputs throw readable errors and never touch the store', () => {
    const before = useStore.getState().kv;
    for (const t of ['', '   ', 'not json', '[]', 'null', '5', '{}', '{"foo":1}', '{"format":"ledger-backup","version":99,"collections":{}}', '{"format":"ledger-backup","collections":{}}', '{"__proto__":{"x":1},"constructor":1}']) {
      expect(() => useStore.getState().importAll(t), t).toThrow(/.+/);
    }
    expect(useStore.getState().kv).toBe(before);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
  it('buildBackup includes every synced collection', () => {
    expect(Object.keys(buildBackup().collections).sort()).toEqual(['habitLogs', 'habits', 'tasks', 'blocks', 'workouts', 'body', 'journal', 'rewards', 'xp', 'wake', 'books', 'conversations', 'rejections', 'videos', 'channels', 'oneLogs', 'kv'].sort());
  });
});
