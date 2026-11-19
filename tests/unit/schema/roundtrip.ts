/* Lossless-mapping checker for the typed-tables migration.

   Usage (sync or async mappers; the SQL-level tests pass async ones that INSERT into the typed tables and SELECT back):
     await assertLosslessMapping(
       (collection, item) => toRow(collection, item),      // item -> typed-row object (anything: columns, jsonb overflow, ...)
       (collection, row) => fromRow(collection, row));     // typed row -> item
   For every valid fixture (default groups: typical + edge) it checks canonicalJson(fromRow(toRow(x))) === canonicalJson(x),
   that toRow does not mutate its input, and that the mapping is idempotent (mapping the result again gives the same result).

   EQUALITY RULES (the "canonical JSON" comparison), chosen deliberately:
     - object key order is ignored (jsonb does not keep it, columns have no order);
     - a key whose value is `undefined` is the same as a missing key (JSON.stringify drops it; the app writes `{ x: undefined }` in places);
     - `null` is NOT the same as missing, and NOT the same as '' or 0: the validator accepts null for optional fields, so an item that
       holds `note: null` must come back with `note: null`, and one without `note` must come back without it. If the mapping wants to
       normalise null to missing (SQL NULL cannot tell them apart), it must do so on purpose and drop the `nulls` fixture group
       (pass `groups`), documenting the change; the test must never hide it silently;
     - array order IS significant (sets, queue, tags, videos, days);
     - numbers compare by value (-0 equals 0, as in JSON); strings compare exactly (no trimming, no Unicode normalisation, so
       'é' and 'é' differ); NaN/Infinity/functions/bigint/Date objects throw (they are not JSON). */
import { COLLECTIONS, type Collection } from '../../../src/sync/types';
import { FIXTURES, VALID_GROUPS, syncId, type Obj, type ValidGroup } from './fixtures';

/** Deterministic JSON text of `v` with sorted keys and undefined-valued keys removed. Throws on non-JSON values. */
export function canonicalJson(v: unknown): string {
  const walk = (x: unknown, path: string): string => {
    if (x === null) return 'null';
    switch (typeof x) {
      case 'string': return JSON.stringify(x);
      case 'boolean': return x ? 'true' : 'false';
      case 'number': if (!Number.isFinite(x)) throw new Error(`non-finite number at ${path}`); return JSON.stringify(x === 0 ? 0 : x);
      case 'object': {
        if (Array.isArray(x)) return '[' + x.map((e, i) => { if (e === undefined) throw new Error(`undefined array element at ${path}[${i}]`); return walk(e, `${path}[${i}]`); }).join(',') + ']';
        const proto = Object.getPrototypeOf(x);
        if (proto !== Object.prototype && proto !== null) throw new Error(`non-plain object at ${path} (${(x as object).constructor?.name})`);
        const o = x as Obj;
        return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + walk(o[k], `${path}.${k}`)).join(',') + '}';
      }
      default: throw new Error(`non-JSON value (${typeof x}) at ${path}`);
    }
  };
  return walk(v, '$');
}

/** First difference between two values, as a JSON path with both sides (for readable failures); null when canonically equal. */
export function firstDiff(a: unknown, b: unknown, path = '$'): string | null {
  const show = (x: unknown) => { const t = x === undefined ? '<missing>' : canonicalJson(x); return t.length > 120 ? t.slice(0, 117) + '...' : t; };
  const isRec = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: array length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  if (isRec(a) && isRec(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) { const d = firstDiff(a[k], b[k], `${path}.${k}`); if (d) return d; }
    return null;
  }
  if (a === undefined || b === undefined) return a === b ? null : `${path}: ${show(a)} vs ${show(b)}`;
  return canonicalJson(a) === canonicalJson(b) ? null : `${path}: ${show(a)} vs ${show(b)}`;
}

export const canonicalEqual = (a: unknown, b: unknown): boolean => firstDiff(a, b) === null;

export function assertCanonicalEqual(expected: unknown, actual: unknown, label = 'value'): void {
  const d = firstDiff(expected, actual);
  if (d) throw new Error(`${label} is not lossless at ${d}`);
}

export type ToRow<R = unknown> = (collection: Collection, item: Obj) => R | Promise<R>;
export type FromRow<R = unknown> = (collection: Collection, row: R) => Obj | Promise<Obj>;
export interface LosslessOptions {
  /** fixture groups to check (default typical + edge) */
  groups?: readonly ValidGroup[];
  /** restrict to these collections (default all) */
  collections?: readonly Collection[];
}
export interface LosslessReport { checked: number; failures: string[] }

/** Round-trips every valid fixture through toRow/fromRow. Throws one Error listing every failure; returns counts when all pass. */
export async function assertLosslessMapping<R = unknown>(toRow: ToRow<R>, fromRow: FromRow<R>, opts: LosslessOptions = {}): Promise<LosslessReport> {
  const groups = opts.groups ?? (['typical', 'edge'] as const);
  for (const g of groups) if (!VALID_GROUPS.includes(g)) throw new Error(`unknown fixture group ${g}`);
  const failures: string[] = []; let checked = 0;
  for (const c of opts.collections ?? COLLECTIONS) {
    for (const g of groups) {
      for (let i = 0; i < FIXTURES[c][g].length; i++) {
        const item = FIXTURES[c][g][i]; checked++;
        const label = `${c}.${g}[${i}] (${syncId(c, item).slice(0, 40)})`;
        try {
          const before = canonicalJson(item);
          const row = await toRow(c, item);
          const back = await fromRow(c, row);
          assertCanonicalEqual(item, back, label);
          const again = await fromRow(c, await toRow(c, structuredClone(back)));
          assertCanonicalEqual(back, again, `${label} (second pass, mapping not idempotent)`);
          if (canonicalJson(item) !== before) throw new Error(`${label}: fixture was mutated`);
        } catch (e) { failures.push(e instanceof Error ? e.message : String(e)); }
      }
    }
  }
  if (failures.length) throw new Error(`${failures.length} of ${checked} fixtures are not mapped losslessly:\n  ` + failures.slice(0, 50).join('\n  ') + (failures.length > 50 ? `\n  ... and ${failures.length - 50} more` : ''));
  return { checked, failures };
}
