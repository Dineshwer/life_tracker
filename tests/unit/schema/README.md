# Schema fixtures (typed-tables migration)

Golden fixtures that prove the move from `public.records (collection, id, data jsonb)` to typed tables is lossless.
The app's item JSON shapes do not change: typed rows must map to and from exactly these objects.

Files
- `fixtures.ts`: `FIXTURES[collection] = { typical, edge, nulls, extras, invalid }` for all 19 collections, plus `validItems(c, groups?)`, `syncId(c, item)`, `coverage()`.
- `roundtrip.ts`: `assertLosslessMapping(toRow, fromRow, opts?)`, `canonicalJson`, `canonicalEqual`, `assertCanonicalEqual`, `firstDiff`.
- `fixtures.test.ts`: proves the valid groups pass `validateItem`, the `invalid` group is rejected, limits are really hit, prints the coverage table.

Groups
- `typical`: realistic items. `edge`: valid items at the validator's limits (max-length strings, unicode/emoji/ZWJ/RTL/combining marks, empty arrays, field missing vs `''`, 1000 sets, 500 queue items, 500 course videos, numeric bounds, 200-char ids with colons/unicode, 1970-01-01 / 2200-12-31 / leap days, free-form timestamp strings).
- `nulls`: valid because `validateItem` treats `null` like absent for optional fields. `extras`: valid because unknown extra fields are accepted and kept.
  These two are separate so the architect decides explicitly: either the mapping preserves them (overflow jsonb column, null-aware columns), or it normalises/rejects them and the DB tests drop the group via `groups`. Do not delete the fixtures to make a test pass.
- `invalid`: `{ name, item }`, one defect each (over-length, bad enum, bad date, NUL, lone surrogate, wrong types, non-objects, `{}`). The DB layer should reject (or the sync RPC mark `rejected`) everything the app validator rejects; SQL tests can loop over `FIXTURES[c].invalid`.

Using it (SQL-level tests)
```ts
import { assertLosslessMapping } from './roundtrip';
await assertLosslessMapping(
  async (c, item) => { await db.upsertItem(c, item); return syncId(c, item); },   // item -> typed rows (row may be any handle)
  async (c, key)  => db.readItem(c, key),                                           // typed rows -> item JSON
);
// restrict: { collections: ['courses'], groups: ['typical', 'edge', 'nulls', 'extras'] }
```
Both functions may be async. The checker also asserts toRow does not mutate its input and that mapping the result again is stable (idempotent).
Wake items have no `id`; the sync id is `wake:<date>` (`syncId`). `meta` always has id `settings`.

Comparison rules (documented in `roundtrip.ts`)
- key order ignored; `undefined` equals missing; array order significant; strings exact (no trim, no Unicode normalisation); numbers by value.
- `null` is NOT equal to missing: the validator allows both and the app can persist either, so a typed table that cannot tell them apart must be a conscious decision (see `nulls`).

Size note: items must stay under `LIMITS.maxItemBytes` (512 KiB). The validator's per-field maxima cannot all be reached at once (e.g. a journal body of 200,000 CJK characters is ~600 KB). Fixtures assert every item fits.
