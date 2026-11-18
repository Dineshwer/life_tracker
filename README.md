# Ledger

[![CI](https://github.com/Dineshwer/life_tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/Dineshwer/life_tracker/actions/workflows/ci.yml)
[![Nightly](https://github.com/Dineshwer/life_tracker/actions/workflows/nightly.yml/badge.svg)](https://github.com/Dineshwer/life_tracker/actions/workflows/nightly.yml)

A personal life tracker as an installable PWA: habits, tasks, a Today view, rejections, a 12-week gym program with form demos, a single "one exercise" streak, journal, books, a feed of videos, rewards and XP, and a 3D character that grows with you. 13 visual skins, each in light and dark.

Stack: React 18, TypeScript, Vite, zustand, react-router, three.js, vite-plugin-pwa (workbox), Supabase (Postgres, Auth, Realtime). Deployed on Vercel from `main`.

## How your data is kept
The database is the source of truth; the browser holds a disposable cache and works offline. Edits apply locally at once and sync in the background with versioned writes, three-way merge on conflicts, realtime updates between devices, tombstones and 14 daily server-side snapshots you can restore from Settings. Without Supabase configured the app runs purely local. The sync layer has been tested against an in-process Postgres (PGlite) and a mock Supabase server, never yet against a real Supabase project. See `docs/ARCHITECTURE.md` and `docs/DATA.md`.

## Quick start
```
nvm use            # Node 20
npm ci
cp .env.example .env.local   # optional: empty = local only; open any page with ?demo=1 for sample data
npm run dev
```
To use sync, create a Supabase project, apply the database and set the two `VITE_SUPABASE_*` variables: follow `docs/OWNER_RUNBOOK.md` (plain steps) or `docs/DEPLOY.md` (reference).

## Scripts
| Script | What |
|---|---|
| `npm run dev` / `build` / `preview` | Vite dev server, type-check + production build, preview |
| `npm run check` | tsc + unit tests + build (run before pushing) |
| `npm run test:unit` | Vitest: merge, sync engine, SQL (PGlite), store |
| `npm run test:e2e` | Playwright UI suite (themes x modes x routes, flows, a11y) |
| `npm run test:e2e:ci` | a convenience subset of the UI suite with bundled Chromium (CI runs equivalent steps itself) |
| `npm run test:e2e-sync` | two-device sync suite against a mock Supabase (installed Chrome) |
| `npm run lint` | ESLint |
| `npm run db:bundle` | regenerate `supabase/apply-all.sql` from `supabase/migrations/` |
| `npm run db:apply` | apply pending migrations to `SUPABASE_DB_URL` (`-- --dry-run` to preview) |
| `npm run csp:serve` / `csp:probe` | serve `dist/` with the `vercel.json` headers; check for CSP violations |

## Docs
- **`docs/OWNER_RUNBOOK.md`: start here if you run this app.** Step-by-step: upgrade order, how to check each step, backups and restore, what to do when something looks wrong, rolling back.
- `docs/ARCHITECTURE.md`: components, data flow, the sync model, offline behaviour
- `docs/DATA.md`: guarantees, failure modes, runbooks (restore, export, rotate keys, migrate, delete)
- `docs/TESTING.md`: unit, e2e, theme matrix, CI
- `docs/DEPLOY.md`: Vercel, Supabase, migrations, pg_cron, first-time checklist
- `SECURITY.md`: threat model, keys, CSP
- `supabase/README.md`: database reference; `src/sync/README.md`: sync engine details
- `DESIGN.md`: design system; `GYM_PLAN.md`: the gym program
