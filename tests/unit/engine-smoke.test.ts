import { describe, it, expect } from 'vitest';
import { mergeThreeWay, canon } from '../../src/sync/merge';

describe('mergeThreeWay', () => {
  it('local-only, remote-only, both-different (server wins, reported)', () => {
    const r = mergeThreeWay({ a: 1, b: 1, c: 1 }, { a: 2, b: 1, c: 5 }, { a: 1, b: 3, c: 9 });
    expect(r.merged).toEqual({ a: 2, b: 3, c: 9 });
    expect(r.conflicts).toEqual(['c']);
  });
  it('settledThrough takes the larger date', () => {
    expect(mergeThreeWay({ settledThrough: '2026-01-01' }, { settledThrough: '2026-01-03' }, { settledThrough: '2026-01-02' }).merged.settledThrough).toBe('2026-01-03');
  });
  it('canon ignores key order and undefined', () => {
    expect(canon({ a: 1, b: undefined, c: { y: 1, x: 2 } })).toBe(canon({ c: { x: 2, y: 1 }, a: 1 }));
  });
});
