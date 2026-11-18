import { describe, expect, it } from 'vitest';
import { canon, diffFields, mergeThreeWay, same } from '../../src/sync/merge';

describe('mergeThreeWay (table driven)', () => {
  type Row = { name: string; base: unknown; local: unknown; remote: unknown; merged: Record<string, unknown>; conflicts?: string[]; localOnly?: string[]; remoteOnly?: string[] };
  const rows: Row[] = [
    { name: 'nothing changed', base: { a: 1 }, local: { a: 1 }, remote: { a: 1 }, merged: { a: 1 } },
    { name: 'only local changed a field', base: { a: 1, b: 1 }, local: { a: 2, b: 1 }, remote: { a: 1, b: 1 }, merged: { a: 2, b: 1 }, localOnly: ['a'] },
    { name: 'only remote changed a field', base: { a: 1, b: 1 }, local: { a: 1, b: 1 }, remote: { a: 1, b: 9 }, merged: { a: 1, b: 9 }, remoteOnly: ['b'] },
    { name: 'different fields on each side: both survive', base: { a: 1, b: 1 }, local: { a: 2, b: 1 }, remote: { a: 1, b: 9 }, merged: { a: 2, b: 9 }, localOnly: ['a'], remoteOnly: ['b'] },
    { name: 'same field, same new value: no conflict', base: { a: 1 }, local: { a: 5 }, remote: { a: 5 }, merged: { a: 5 } },
    { name: 'same field, different values: REMOTE wins and is reported', base: { a: 1 }, local: { a: 2 }, remote: { a: 3 }, merged: { a: 3 }, conflicts: ['a'] },
    { name: 'local adds a field', base: { a: 1 }, local: { a: 1, n: 'x' }, remote: { a: 1 }, merged: { a: 1, n: 'x' }, localOnly: ['n'] },
    { name: 'remote adds a field', base: { a: 1 }, local: { a: 1 }, remote: { a: 1, n: 'x' }, merged: { a: 1, n: 'x' }, remoteOnly: ['n'] },
    { name: 'both add the same field differently: remote wins', base: {}, local: { n: 1 }, remote: { n: 2 }, merged: { n: 2 }, conflicts: ['n'] },
    { name: 'local removes a field the remote did not touch', base: { a: 1, b: 2 }, local: { a: 1 }, remote: { a: 1, b: 2 }, merged: { a: 1 }, localOnly: ['b'] },
    { name: 'remote removes a field the local did not touch', base: { a: 1, b: 2 }, local: { a: 1, b: 2 }, remote: { a: 1 }, merged: { a: 1 }, remoteOnly: ['b'] },
    { name: 'local edits what remote removed: remote wins (field gone)', base: { a: 1, b: 2 }, local: { a: 1, b: 3 }, remote: { a: 1 }, merged: { a: 1 }, conflicts: ['b'] },
    { name: 'both removed the same field', base: { a: 1, b: 2 }, local: { a: 1 }, remote: { a: 1 }, merged: { a: 1 } },
    { name: 'no base (seed vs server): fields only on local are kept, different values take the server', base: undefined, local: { id: 'h', name: 'Run', color: 'x' }, remote: { id: 'h', name: 'Run 5k' }, merged: { id: 'h', name: 'Run 5k', color: 'x' }, conflicts: ['name'], localOnly: ['color'] },
    { name: 'nested objects are compared as one value (whole value, not deep merge)', base: { o: { x: 1, y: 1 } }, local: { o: { x: 2, y: 1 } }, remote: { o: { x: 1, y: 2 } }, merged: { o: { x: 1, y: 2 } }, conflicts: ['o'] },
    { name: 'arrays are compared as one value', base: { l: [1] }, local: { l: [1, 2] }, remote: { l: [1] }, merged: { l: [1, 2] }, localOnly: ['l'] },
    { name: 'key order does not matter (jsonb reorders keys)', base: { a: 1, b: { y: 1, x: 2 } }, local: { b: { x: 2, y: 1 }, a: 1 }, remote: { a: 1, b: { x: 2, y: 1 } }, merged: { a: 1, b: { x: 2, y: 1 } } },
    { name: 'settledThrough: the later date wins whichever side has it (local later)', base: { settledThrough: '2026-01-01' }, local: { settledThrough: '2026-03-01' }, remote: { settledThrough: '2026-02-01' }, merged: { settledThrough: '2026-03-01' } },
    { name: 'settledThrough: the later date wins (remote later)', base: { settledThrough: '2026-01-01' }, local: { settledThrough: '2026-02-01' }, remote: { settledThrough: '2026-03-01' }, merged: { settledThrough: '2026-03-01' } },
    { name: 'non-object inputs are treated as empty', base: null, local: 'oops', remote: { a: 1 }, merged: { a: 1 }, remoteOnly: ['a'] },
  ];
  for (const r of rows) it(r.name, () => {
    const m = mergeThreeWay(r.base, r.local, r.remote);
    expect(m.merged).toEqual(r.merged);
    expect([...m.conflicts].sort()).toEqual([...(r.conflicts ?? [])].sort());
    if (r.localOnly) expect([...m.localOnly].sort()).toEqual([...r.localOnly].sort());
    if (r.remoteOnly) expect([...m.remoteOnly].sort()).toEqual([...r.remoteOnly].sort());
  });
  it('does not mutate its inputs', () => {
    const base = { a: 1 }, local = { a: 2, b: 1 }, remote = { a: 3 }; const snap = JSON.stringify([base, local, remote]);
    mergeThreeWay(base, local, remote); expect(JSON.stringify([base, local, remote])).toBe(snap);
  });
  it('is idempotent: merging the result with the remote again changes nothing', () => {
    const m1 = mergeThreeWay({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 7 });
    const m2 = mergeThreeWay({ a: 1, b: 7 }, m1.merged, { a: 1, b: 7 }); expect(m2.merged).toEqual(m1.merged);
  });
  it('merging identical local and remote is the identity regardless of base', () => {
    for (const base of [undefined, {}, { a: 0 }, { z: 1 }]) expect(mergeThreeWay(base, { a: 1, b: [1] }, { b: [1], a: 1 }).merged).toEqual({ a: 1, b: [1] });
  });
});
describe('canon / same / diffFields', () => {
  it('canon is key-order independent and drops undefined', () => {
    expect(canon({ b: 1, a: { d: 1, c: 2 } })).toBe(canon({ a: { c: 2, d: 1 }, b: 1 }));
    expect(canon({ a: 1, b: undefined })).toBe(canon({ a: 1 }));
    expect(same({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
  it('diffFields lists exactly the fields that differ', () => { expect(diffFields({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, d: 4 }).sort()).toEqual(['b', 'c', 'd']); });
});
