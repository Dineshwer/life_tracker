/* Pure helpers for the sync engine: canonical JSON and the field-level three-way merge. No I/O, no globals except a WeakMap cache. */

export type Obj = Record<string, unknown>;

const cache = new WeakMap<object, string>();

/** Canonical JSON: object keys sorted, undefined dropped. Two values are "the same item" iff their canon strings are equal.
    (Postgres jsonb reorders keys, so plain JSON.stringify cannot be used to compare local and server copies.) */
export function canon(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return typeof v === 'number' && !Number.isFinite(v) ? 'null' : JSON.stringify(v) ?? 'null';
  const hit = cache.get(v);
  if (hit !== undefined) return hit;
  let out: string;
  if (Array.isArray(v)) out = '[' + v.map((x) => canon(x)).join(',') + ']';
  else {
    const o = v as Obj;
    out = '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
  }
  cache.set(v, out);
  return out;
}

export const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Fields whose conflicts are resolved by a rule instead of "server wins". settledThrough is a monotonic date: the larger one is always right. */
const FIELD_RULES: Record<string, (local: unknown, remote: unknown) => unknown> = {
  settledThrough: (l, r) => (typeof l === 'string' && typeof r === 'string' ? (l > r ? l : r) : r),
};

export interface MergeResult {
  merged: Obj;
  /** fields changed on both sides to different values: the SERVER value is in `merged`, the local value was dropped */
  conflicts: string[];
  localOnly: string[];
  remoteOnly: string[];
}

/** Field-level three-way merge of (base, local, remote), where base is the last server-confirmed version.
    changed only locally -> local; only remotely -> remote; both to the same value -> that value; both differently -> remote (reported in `conflicts`). */
export function mergeThreeWay(base: unknown, local: unknown, remote: unknown): MergeResult {
  const b: Obj = isObj(base) ? base : {};
  const l: Obj = isObj(local) ? local : {};
  const r: Obj = isObj(remote) ? remote : {};
  const merged: Obj = {}; const conflicts: string[] = []; const localOnly: string[] = []; const remoteOnly: string[] = [];
  const keys = new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)]);
  for (const k of keys) {
    const bv = b[k], lv = l[k], rv = r[k];
    let v: unknown;
    if (same(lv, rv)) v = lv;
    else if (same(lv, bv)) { v = rv; remoteOnly.push(k); }
    else if (same(rv, bv)) { v = lv; localOnly.push(k); }
    else if (FIELD_RULES[k]) v = FIELD_RULES[k](lv, rv);
    else { v = rv; conflicts.push(k); }
    if (v !== undefined) merged[k] = v;
  }
  return { merged, conflicts, localOnly, remoteOnly };
}

/** Names of the top-level fields that differ between two items. */
export function diffFields(a: unknown, b: unknown): string[] {
  const x: Obj = isObj(a) ? a : {}; const y: Obj = isObj(b) ? b : {};
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => !same(x[k], y[k]));
}
