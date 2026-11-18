# Unit tests for the sync layer

Run everything: `npx vitest run` (config: `vitest.config.ts`, node environment, `tests/unit/**/*.test.ts`).
Run one area: `npx vitest run tests/unit/engine`, `npx vitest run tests/unit/merge.test.ts`.

| Path | What it is |
|---|---|
| `fakeRemote.ts` | `FakeServer` (in-memory server with the exact contract semantics from `src/sync/types.ts`: optimistic concurrency, versions, global `seq`, tombstones, validation, paging, backups, per-user isolation, realtime with `dropRealtime()` / `deliverPending()`, fault injection `failNext` / `loseResponseNext` / `latency` / `setOffline`, injectable `clock`) and `FakeRemote` (one device's client; many share a server). |
| `remote.contract.ts` | `describeRemoteContract(name, makeWorld)`: the reusable behaviour suite every `Remote` must satisfy. |
| `fakeRemote.test.ts` | Runs the contract against `FakeRemote` plus tests of the fake's own controls. |
| `pgliteRemote.ts`, `pgliteRemote.test.ts` | A `Remote` over PGlite calling the real SQL (`push_records`, `select ... where seq > $1`, `take_backup`, `list_backups`, `restore_backup`) through `tests/unit/db/harness.ts`, running the SAME contract: proves fake and SQL agree. Skips with a message if the DB files are missing (the skip text still says "DB agent files not present yet", a leftover from how the suite was written). |
| `merge.test.ts` | Table-driven tests of `mergeThreeWay`, `canon`, `diffFields`. |
| `engine/harness.ts` | `world()` (server + fake clock), `Device` (engine + in-memory store/storage + edit helpers), `converge()`, `expectConverged()`. Timers and `now` are injected: nothing sleeps for real; `clock.advance(ms)` runs due timers. |
| `engine/basics.test.ts` | First sync, seeds, propagation by pull and realtime, offline edits, field merges, same-field conflicts + `restoreConflict`, edit vs delete, delete/recreate, clock skew. |
| `engine/scale.test.ts` | 1,000 / 5,000 items, batches over 500, large edit bursts. |
| `engine/resilience.test.ts` | Mid-push/mid-pull failures, lost responses (idempotent retry), backoff, status, pending count, `flush()`, rejected items, `gone`, quarantine of invalid rows, disposable cache / `resetLocalCache`, realtime drop and polling, locks and tabs. |
| `engine/backup.test.ts` | Server-side restore converges all devices. |
| `perf/scale.test.ts` | Generous performance budgets for the engine and the persisted-store cost model (the printed table is the real measurement). |
| `store/*.test.ts` | Store side: `adapter` (store <-> sync items), `backup` (file export/import), `coerce`, `migrate`, `validate` (`src/lib/*`, `src/store.ts`). |
| `engine/random.test.ts` | Seeded model-based tests (N devices x M random operations; serial model with an exact expected state). |

Randomized tests print the seed on failure. Re-run one: `SYNC_SEED=1000 npx vitest run tests/unit/engine/random.test.ts`; more seeds: `SYNC_SEEDS=100`. `SYNC_VERBOSE=1` shows the engine's `[sync]` console warnings.

`tests/unit/db/**` belongs to the database tests (SQL migrations on PGlite) and is not described here.
