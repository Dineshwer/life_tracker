import { describe, expect, it } from 'vitest';
import { coerceItem, validateItem } from '../../../src/lib/validate';

/** Free text longer than the schema allows is cut, not dropped: an over-long title must never make a whole item disappear on the next load or sync. */
describe('coerceItem', () => {
  const video = { id: 'v1', ytId: 'dQw4w9WgXcQ', title: 'W'.repeat(900), tag: 'learn', addedAt: '2026-11-18T10:00:00.000Z' };
  it('an over-long title is invalid as typed but valid after coercion, and nothing else changes', () => {
    expect(validateItem('videos', video)).toBe(false);
    const c = coerceItem('videos', video);
    expect(c.title).toHaveLength(500);
    expect(validateItem('videos', c)).toBe(true);
    expect({ ...c, title: '' }).toEqual({ ...video, title: '' });
  });
  it('returns the very same object when nothing needs cutting', () => {
    const ok = { ...video, title: 'fine' };
    expect(coerceItem('videos', ok)).toBe(ok);
  });
  it('handles optional fields and unknown collections without throwing', () => {
    expect(coerceItem('books', { id: 'b', title: 'T', status: 'queued', author: 'A'.repeat(900) }).author).toHaveLength(300);
    const x = { a: 1 };
    expect(coerceItem('nope', x)).toBe(x);
  });
});
