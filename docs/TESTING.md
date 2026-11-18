# Testing

| Layer | Command | What it covers |
|---|---|---|
| Types | `npx tsc -b` | strict TypeScript for app and Node config |
| Unit | `npm run test:unit` | Vitest (`tests/unit/**`): merge rules, the sync engine against a fake remote (basics, random operation sequences, resilience, scale), the SQL itself against PGlite (the real migrations), store validation/migration/backup |
| E2E (UI) | `npm run test:e2e` | Playwright (`tests/e2e/**`): every route in every theme and mode, flows per page, accessibility (axe), layout checks |
| E2E (sync) | `npm run test:e2e-sync` | Two browser devices against a mock Supabase (PGlite running the migrations): realtime, offline edits, conflicts |
| CSP | `npm run build`, then `node scripts/serve-with-headers.mjs dist 4173` and `BASE_URL=http://localhost:4173 node scripts/csp-probe.mjs` | Serves the build with the headers from `vercel.json`, loads every route, the 3D page, embeds and the service worker, fails on any CSP violation. (`npm run csp:serve` / `npm run csp:probe` are shortcuts for the two node commands; the serve script takes `dist 4173` as arguments, the probe reads `BASE_URL` and `PW_CHANNEL`, default installed Chrome.) Needs a build without Supabase env (demo data) to get past the login screen. |
| Everything quick | `npm run check` | tsc + unit tests + production build |

**Not covered by any test:** a real Supabase project (real Auth/GoTrue, PostgREST, Realtime, pg_cron, dashboard-run SQL). The SQL is exercised on PGlite (in-process Postgres, with a stand-in `auth.uid()` reading `request.jwt.claim.sub`) and through a hand-written mock of the Supabase HTTP/websocket surface, so differences in the real services (rate limits, JWT handling, realtime delivery, extension availability) are unverified. `npm run test:e2e:ci` is a convenience script for the CI subset; CI itself runs the equivalent commands step by step. The UI e2e suite runs without Supabase (`?demo=1`), so the sign-in screen and Settings > Data & sync against a live account are covered only by `tests/e2e/data-sync-ui.spec.ts` and the sync suite's mock.

## UI E2E details

- Config: `playwright.config.ts`. Projects: `desktop` (1440x900), `phone` (393x852), `phone-small` (360x740). The dev server starts automatically with **no Supabase** so `?demo=1` loads sample data.
- Locally the tests use installed Google Chrome (`channel: 'chrome'`). Set `PW_CHANNEL=` (empty) to use Playwright's bundled Chromium (`npx playwright install chromium`); CI does this.
- Narrow the theme matrix with env vars: `SKINS=canopy,paper MODES=dark ROUTES=/gym,/today npx playwright test tests/e2e/smoke.spec.ts --project=phone`. All skins: canopy, paper, grimoire, pop, arcade, sumi, bauhaus, riso, blueprint, swiss, collage, rings, cyberpunk.
- `PW_WORKERS` (default 2) sets parallelism. `BASE_URL` runs against an already served build instead of starting Vite.
- Failures write artifacts to `test-results/`. Screenshots for visual review go to `test-results/shots/<project>/`.
- A software WebGL renderer (swiftshader) is enabled via launch args so the 3D page works headless.

## CI (`.github/workflows`)

- `ci.yml` on every push and pull request:
  - job `verify`: `npm ci` (cached), `tsc -b`, migration bundle freshness check (`scripts/db-bundle.mjs --check`), unit tests, build, then Playwright (bundled Chromium, phone project): smoke with SKINS=canopy,paper,cyberpunk MODES=dark,light, and the flow specs for today, habits/tasks, rejections/journal/books, gym flows, entertainment/rewards/settings; then the CSP probe on the built app; `npm audit --omit=dev` is informational. Playwright artifacts are uploaded on failure.
  - job `sync-e2e`: installs Google Chrome and runs the multi-device sync suite.
- `nightly.yml` (02:30 UTC, also manual): `tsc -b`, unit tests, then the full Playwright matrix (all skins x modes x routes, flows, accessibility) on the `phone` and `desktop` projects (not `phone-small`, not the sync suite), plus an informational `npm audit`.
- CI uses no secrets and no Supabase: the app is built with empty `VITE_SUPABASE_*`.

## Writing tests
- Sync engine logic: add to `tests/unit/engine/` using the harness; anything that must hold for every `Remote` goes in `tests/unit/remote.contract.ts` so both FakeRemote and the PGlite-backed real SQL run it.
- Database changes: add cases to `tests/unit/db/db.test.ts`.
- New page: add the route to `ALL` in `tests/e2e/smoke.spec.ts` and a flow spec.
