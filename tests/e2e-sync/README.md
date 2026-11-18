# Multi-device sync E2E (real client engine + real SQL, mock Supabase HTTP layer)

Run from the project root:

    npx playwright test -c tests/e2e-sync/playwright.config.ts            # whole suite (~6-8 min)
    npx playwright test -c tests/e2e-sync/playwright.config.ts 02-        # one file

Also available as `npm run test:e2e-sync`. Uses Google Chrome (`channel: 'chrome'`, installed locally; CI installs it).
Dev dependencies used: `ws`, `@types/ws` (added), `@electric-sql/pglite`, `vite-node` (ships with vitest).

## Architecture
- `mockSupabase.ts` (started by the Playwright `webServer` via `vite-node`, port 54329): Node http + PGlite running ALL
  `supabase/migrations` through `tests/unit/db/harness.ts` (`createDb`, `asUser`). Speaks PostgREST (`GET /rest/v1/records` with
  `select/eq/gt/in/order/limit/offset/Range`), RPC (`push_records`, `take_backup`, `list_backups`, `restore_backup`, run as the JWT `sub`
  so RLS and SECURITY DEFINER are real), minimal GoTrue (`/auth/v1/token`, `/user`, `/logout`), CORS, and a Phoenix realtime websocket
  (`/realtime/v1/websocket`: join ack with `postgres_changes` bindings, heartbeat, INSERT/UPDATE events after each write RPC).
- Controls: `/__test/reset`, `offline?on=1` (kills every connection, refuses requests), `latency?ms=`, `auth-fail?on=1` (401 on REST/token,
  websocket refused), `drop-realtime[?block=1|0]`, `user` (creates a user, returns a minted HS256 JWT + refresh token), `session?id=&email=`,
  `snapshot?user=[&all=1]`, `stats`, `sockets?user=`.
- App under test: a second Vite dev server on :5190 with `VITE_SUPABASE_URL` -> mock. No UI sign-in: each simulated device is a Playwright
  browser context whose init script seeds `sb-localhost-auth-token` (only when absent, so wiping storage == logging in again).
- `fixtures.ts`: `Device` (one browser context). `device.run(fn)` evaluates in the page against the REAL app modules via
  `import('/src/store.ts')` / `import('/src/sync/api.ts')` (same instances the app uses, no app edits). Helpers poll the DOM/engine/mock snapshot, no fixed sleeps.
- Serial (1 worker): every test resets the single mock DB and uses its own fresh user.
