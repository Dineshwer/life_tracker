import { describe, it, expect } from 'vitest';
import { COLLECTIONS, LIMITS } from '../../../src/sync/types';
import { validateItem, coerceItem } from '../../../src/lib/validate';
import { FIXTURES, VALID_GROUPS, coverage, syncId, validItems } from './fixtures';
import { canonicalJson, canonicalEqual, firstDiff, assertLosslessMapping } from './roundtrip';

const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x), 'utf8');

describe('golden fixtures', () => {
  it('covers every collection', () => { expect(Object.keys(FIXTURES).sort()).toEqual([...COLLECTIONS].sort()); });

  for (const c of COLLECTIONS) {
    describe(c, () => {
      it('has typical, edge and invalid items', () => {
        expect(FIXTURES[c].typical.length).toBeGreaterThan(0);
        expect(FIXTURES[c].edge.length).toBeGreaterThan(0);
        expect(FIXTURES[c].invalid.length).toBeGreaterThan(5);
      });
      for (const g of VALID_GROUPS) {
        it(`${g}: every item passes validateItem, survives JSON, fits the item size limit`, () => {
          const bad: string[] = [];
          for (const it of FIXTURES[c][g]) {
            if (!validateItem(c, it)) bad.push(`invalid: ${syncId(c, it)}`);
            if (bytes(it) > LIMITS.maxItemBytes) bad.push(`over ${LIMITS.maxItemBytes} bytes: ${syncId(c, it)} (${bytes(it)})`);
            if (!canonicalEqual(JSON.parse(JSON.stringify(it)), it)) bad.push(`not JSON-stable: ${syncId(c, it)}`);
            if (!canonicalEqual(coerceItem(c, it), it)) bad.push(`coerceItem changes it: ${syncId(c, it)}`);
          }
          expect(bad).toEqual([]);
        });
      }
      it('invalid: every item is rejected by validateItem', () => {
        const accepted = FIXTURES[c].invalid.filter((x) => validateItem(c, x.item)).map((x) => x.name);
        expect(accepted).toEqual([]);
      });
      it('invalid: names are unique', () => {
        const names = FIXTURES[c].invalid.map((x) => x.name);
        expect(new Set(names).size).toBe(names.length);
      });
      it('typical+edge: sync ids are unique within the collection', () => {
        const ids = validItems(c).map((it) => syncId(c, it));
        if (c === 'meta') return; // always 'settings'
        expect(ids.length - new Set(ids).size).toBe(0);
      });
    });
  }

  it('max-size claims really sit at the limits', () => {
    const q = (c: (typeof COLLECTIONS)[number], f: (it: Record<string, unknown>) => boolean) => expect(validItems(c).some(f)).toBe(true);
    q('habits', (i) => (i.name as string).length === 200 && (i.minimum as string | undefined)?.length === 2000);
    q('tasks', (i) => (i.tags as string[]).length === 50 && (i.title as string).length === 1000);
    q('workouts', (i) => (i.sets as unknown[]).length === 1000);
    q('workouts', (i) => (i.queue as unknown[] | undefined)?.length === 500);
    q('courses', (i) => (i.videos as unknown[] | undefined)?.length === 500);
    q('journal', (i) => (i.body as string).length === 200_000);
    q('kv', (i) => (i.value as string).length === 200_000);
    q('body', (i) => (i.photo as string | undefined)?.length === 400_000);
    q('body', (i) => Object.keys((i.measurements as object) ?? {}).length === 100);
    for (const c of COLLECTIONS) if (c !== 'wake' && c !== 'meta') q(c, (i) => String(i.id).length === 200);
  });

  it('prints the coverage table', () => {
    const rows = coverage();
    const w = (s: string | number, n: number) => String(s).padStart(n);
    const lines = [`${'collection'.padEnd(14)}${w('typical', 8)}${w('edge', 6)}${w('nulls', 7)}${w('extras', 8)}${w('invalid', 9)}`];
    const tot = { typical: 0, edge: 0, nulls: 0, extras: 0, invalid: 0 };
    for (const r of rows) { lines.push(`${r.collection.padEnd(14)}${w(r.typical, 8)}${w(r.edge, 6)}${w(r.nulls, 7)}${w(r.extras, 8)}${w(r.invalid, 9)}`); for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += r[k]; }
    lines.push(`${'TOTAL'.padEnd(14)}${w(tot.typical, 8)}${w(tot.edge, 6)}${w(tot.nulls, 7)}${w(tot.extras, 8)}${w(tot.invalid, 9)}`);
    console.log('\n' + lines.join('\n'));
    expect(rows.length).toBe(COLLECTIONS.length);
  });
});

describe('canonical comparison', () => {
  it('ignores key order and undefined-vs-missing', () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: [1, { z: 1, y: 2 }] } })).toBe(canonicalJson({ a: { c: [1, { y: 2, z: 1 }], d: 1 }, b: 1, gone: undefined }));
    expect(canonicalEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(canonicalEqual({ a: 0 }, { a: -0 })).toBe(true);
  });
  it('does NOT equate null with missing, empty string, 0 or false', () => {
    expect(canonicalEqual({ a: null }, {})).toBe(false);
    expect(canonicalEqual({ a: null }, { a: undefined })).toBe(false);
    expect(canonicalEqual({ a: null }, { a: '' })).toBe(false);
    expect(canonicalEqual({ a: null }, { a: 0 })).toBe(false);
    expect(canonicalEqual({ a: [] }, {})).toBe(false);
  });
  it('is order-sensitive for arrays, exact for strings, strict about non-JSON', () => {
    expect(canonicalEqual([1, 2], [2, 1])).toBe(false);
    expect(canonicalEqual('é', 'é')).toBe(false);
    expect(canonicalEqual(' a', 'a')).toBe(false);
    expect(canonicalEqual(1, 1.0000001)).toBe(false);
    expect(() => canonicalJson({ a: NaN })).toThrow();
    expect(() => canonicalJson({ a: new Date() })).toThrow();
    expect(() => canonicalJson([undefined])).toThrow();
  });
  it('reports the first difference as a path', () => {
    expect(firstDiff({ a: [{ b: 1 }] }, { a: [{ b: 2 }] })).toContain('$.a[0].b');
    expect(firstDiff({ a: 1 }, { a: 1, b: null })).toContain('$.b');
  });
});

describe('assertLosslessMapping', () => {
  it('passes for the identity mapping (also through a JSON text column and with reordered keys)', async () => {
    const r = await assertLosslessMapping((_c, it) => JSON.stringify(it), (_c, row) => JSON.parse(row as string));
    expect(r.checked).toBeGreaterThan(200);
    await assertLosslessMapping((_c, it) => Object.fromEntries(Object.entries(it).reverse()), (_c, row) => row as never, { groups: VALID_GROUPS });
  });
  it('fails (and says where) when a mapping drops null, trims strings, truncates arrays or loses unknown fields', async () => {
    const dropNull = assertLosslessMapping((_c, it) => JSON.stringify(it, (_k, v) => (v === null ? undefined : v)), (_c, r) => JSON.parse(r as string), { groups: ['nulls'] });
    await expect(dropNull).rejects.toThrow(/not mapped losslessly[\s\S]*habits\.nulls/);
    await expect(assertLosslessMapping((_c, it) => JSON.stringify(it), (_c, r) => JSON.parse((r as string).replace(/"Ship it"/, '"Ship it "')))).rejects.toThrow(/tasks/);
    await expect(assertLosslessMapping((_c, it) => it, (_c, r) => ({ ...(r as object), sets: [] }) as never, { collections: ['workouts'] })).rejects.toThrow(/workouts/);
    await expect(assertLosslessMapping((_c, it) => it, (_c, r) => { const { color: _c2, ...rest } = r as Record<string, unknown>; void _c2; return rest; }, { groups: ['extras'], collections: ['habits'] })).rejects.toThrow(/habits\.extras/);
  });
});
