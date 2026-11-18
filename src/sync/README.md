# Ledger sync engine

The database (`public.records`) is the source of truth. The browser keeps a disposable cache: the persisted zustand store and the
per-user metadata `ledger-sync-v2-<userId>` (cursor `seq`, per item `{version, base}`). Wiping both loses nothing.

## Cycle (`syncNow`, under the cross-tab lock)
1. First sync / no metadata: pull everything first. The server wins for items that exist there; local-only items are pushed.
   The old `ledger-sync-<uid>` snapshot is used once as merge base, then removed.
2. Push pending items (batches of 500, `base_version`). Pending = local JSON differs from base, new items, confirmed items missing locally.
   ok: record version+base. conflict: three-way merge, push again (max 5 rounds). gone: drop local item. rejected: quarantined until the item changes.
3. Pull `seq > cursor - 50` in pages of 1000 (up to 4 push+pull rounds per cycle), apply, then advance the cursor. Rows with version <= known are skipped (echoes, overlap).
4. Realtime rows go through the same apply function; polling every 20 s when realtime is down and every 60 s while live (a full catch-up pull runs whenever realtime (re)connects). Local edits are pushed 600 ms after the last change. Errors back off 1 s .. 5 min with jitter.

## Merge rules (`mergeThreeWay`, per top-level field)
changed only locally: local; only remotely: remote; both differently: SERVER value + `server-won` ConflictEntry holding the local value.
`settledThrough` takes the later date. Remote tombstone vs local edit: deletion wins and the local copy is kept in the conflict list (`deleted-remotely`). Local delete vs remote edit: edit wins (`deleted-locally`). The conflict list is local only, newest 100.

## Invariants
- Reading the store and writing merged results happen in one synchronous block: no stale snapshot can overwrite a user edit.
- Pending is derived (store vs meta), so reloads and crashes lose nothing; a pushed batch is idempotent (a "conflict" equal to our data counts as ok).
- Invalid server rows are never applied (quarantine list in meta). Cache-loss guard: mass "local deletions" trigger a rebuild from the server instead of a mass delete.
