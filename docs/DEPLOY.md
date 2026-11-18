# Deploy

Hosting is Vercel (static build from GitHub `main`), backend is one Supabase project. The owner configures both; nothing here is automated against your accounts.

## First-time checklist

1. **Supabase project.** Create it (any region). Project Settings > API: copy the project URL and the **publishable** key (`sb_publishable_...`; the legacy anon key also works).
2. **Database.** Supabase > SQL Editor > New query > paste the whole of `supabase/apply-all.sql` > Run. It is idempotent: re-run it whenever migrations change. (Alternative: `SUPABASE_DB_URL=... npm run db:apply`, see below.)
3. **Auth settings** (Authentication > URL Configuration): Site URL = your production URL (e.g. `https://<project>.vercel.app`); add the same URL and `http://localhost:5173` under Redirect URLs. Authentication > Providers > Email: keep enabled. Decide whether "Confirm email" stays on (the app tells new users "Check your email for a confirmation link, then sign in"); for a single-user app consider disabling sign-ups after creating your account (setting name in the Supabase dashboard not verified here).
4. **pg_cron** (nightly backups; dashboard labels not verified against the live Supabase UI): Database > Extensions > enable `pg_cron`, then run `supabase/apply-all.sql` again so the schedules are created. Verify: `select jobname, schedule, active from cron.job;` shows `ledger-nightly-backup` (03:15 UTC) and `ledger-purge-tombstones` (Sundays 03:45 UTC).
5. **Vercel project.** Import the GitHub repo. Framework preset Vite, build command `npm run build`, output `dist`, Node 20. Environment variables (Production and Preview):
   - `VITE_SUPABASE_URL` = project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = publishable key
   These are baked into the bundle at build time: change them, then redeploy. Never add the secret/service_role key or the database password to Vercel.
6. **Deploy** by pushing to `main`. `vercel.json` provides the SPA rewrite, cache headers and the security headers.
7. **Verify** after the first deploy:
   - `curl -sI https://<your-url>/today` shows `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`.
   - Sign up/in, add a habit, open the app on a second device or browser: it appears (realtime).
   - Browser console has no `Refused to ...` messages (CSP).
   - Settings > Data & sync > Back up now works, and the backup is listed.
8. **GitHub.** Enable Actions. No repository secrets are needed. To make CI a merge gate, add branch protection requiring the `verify` and `sync-e2e` checks.

## Running migrations

- **SQL editor (simplest):** paste `supabase/apply-all.sql`. Regenerate it after adding a migration with `npm run db:bundle` (CI fails if it is stale).
- **Command line:** `SUPABASE_DB_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' npm run db:apply` (add `-- --dry-run` to preview; `-- --list` to see applied/pending). Use the direct connection or the session pooler, not the transaction pooler. The URL contains the database password: keep it in your shell only, never in a file in the repo. Applied files are recorded in `public.schema_migrations`; a changed already-applied file is reported as checksum drift and not re-run. Note: if you first used the SQL editor, `db:apply` will re-run the (idempotent) migrations once and then track them.

## Local development

```
cp .env.example .env.local   # leave empty to run purely local with ?demo=1 sample data, or fill in to use a (dev) Supabase project
npm ci && npm run dev
```

## Order of a first upgrade, and rollback
Step by step with checks: `docs/OWNER_RUNBOOK.md`.
- The database upgrade (`apply-all.sql`) revokes INSERT/UPDATE/DELETE on `public.records` from signed-in users. The **old** app wrote with direct upserts (`git show HEAD:src/sync.ts`), so after the SQL runs an old build can read but its writes fail. The **new** app calls `push_records()`, so before the SQL runs it shows a sync error (local data stays on the device). Either order therefore leaves a gap until both are done: run the SQL, then deploy right away, then reload the app on every device.
- Rollback: redeploy a previous deployment from the Vercel dashboard. The service worker auto-updates (`registerType: autoUpdate`), so clients pick it up on next load. **Rolling the app back to the pre-upgrade build does not undo the database**; that build cannot save to the server any more (its edits stay on the device). Roll forward instead, or restore data from a snapshot (`docs/DATA.md`). Migrations are forward-only. (Derived from the code; the deploy-order scenario was not run against a real Supabase project.)
