# Security

Ledger is a personal app with private data (habits, journal, body metrics). The design goal: a leaked front-end key or a bug in the browser must not expose or destroy anyone's data.

## Reporting
This is a personal project. If you find a problem, contact the repository owner privately (GitHub profile) rather than opening a public issue.

## Threat model (short)

| Threat | Mitigation |
|---|---|
| Another signed-in user reads or changes my rows | Row level security on `public.records` and `record_backups` (`auth.uid() = user_id`). Clients have `SELECT` only; every write goes through `push_records()` / backup RPCs, which are SECURITY DEFINER with a fixed `search_path`, check `auth.uid()` themselves and filter every statement by it. |
| Anyone with the app's keys | The **publishable key is public by design** (it is in the JS bundle). It identifies the project; it grants only the `anon`/`authenticated` roles, which can do nothing without a valid user JWT and can then only touch that user's own rows through the allowed functions. It cannot read other users, run maintenance jobs (`run_nightly_backup`, `purge_tombstones` are revoked from clients), change the schema or bypass RLS. |
| Client bug or tampered client corrupts data | Server-owned `version`/`seq`/`updated_at`, optimistic concurrency, collection allow-list, id and size (600,000 bytes per item) checks (DB CHECK constraints). Tombstones and 14 daily snapshots allow recovery. Loaded and imported data is validated client-side. |
| XSS / injected script | CSP `script-src 'self'` (no inline scripts, no eval), React escaping, no `dangerouslySetInnerHTML` of user content, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. |
| Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: DENY`. |
| Downgrade / sniffing | HSTS (2 years, includeSubDomains), `upgrade-insecure-requests`, `X-Content-Type-Options: nosniff`. |
| Sensors and powerful APIs | Permissions-Policy disables camera, microphone, geolocation, payment, USB; YouTube embeds keep only encrypted-media, picture-in-picture, fullscreen. |
| Cross-window attacks | `Cross-Origin-Opener-Policy: same-origin`. (COEP is intentionally not set: it would block YouTube embeds and thumbnails.) |
| Stolen device | Sessions live in browser storage like any web app; sign out revokes the session. Journal data is not encrypted at rest in the browser or (beyond Supabase's disk encryption) in the database. |
| (Verification) RLS, grants and functions | Tested on PGlite and a mock server only; never run on a real Supabase project. After applying the SQL, run the checks in `docs/OWNER_RUNBOOK.md` ("Check the database"). |
| Dependency vulnerabilities | `npm audit` in CI (informational); see accepted findings below. |

## Keys and secrets
- **In the browser/bundle (public):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- **Never in the repo or in Vercel:** the Supabase secret / `service_role` key, the database password, `SUPABASE_DB_URL`. They are used only from the owner's machine (`npm run db:apply`) or the Supabase dashboard.
- `.gitignore` excludes `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, `service_role*`. A scan of the working tree (tracked and untracked files, excluding images/models) for JWTs, `sb_secret_` and connection strings with passwords found nothing, and `git log -S sb_secret_` found nothing; a full history scan for JWTs was not done. Most of the sync work is still uncommitted, so history says little about it.
- CI uses no secrets.

## Content Security Policy (vercel.json)
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://i.ytimg.com; media-src 'self' blob: data:;
frame-src https://www.youtube-nocookie.com https://www.youtube.com;
connect-src 'self' blob: data: https://*.supabase.co wss://*.supabase.co https://www.youtube.com https://api.invidious.io https:;
worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```
Trade-offs, honestly:
- **`connect-src ... https:`** is the loosest rule. The Entertainment feed lists channel videos through public Invidious mirrors whose host list is fetched at runtime from `api.invidious.io` and changes constantly, so a fixed allow-list would break the feature. Consequence: if an attacker ever got script running, it could send data to any HTTPS host. Mitigated by `script-src 'self'` (no way to run injected script). To tighten it, drop `https:` and hard-code the one or two mirrors you trust (`FALLBACK` in `src/lib/mirror.ts`), accepting the feed breaks when they go away.
- **`style-src 'unsafe-inline'`** is needed because React sets inline `style` attributes and the skin font CSS is injected from Google Fonts. It does not allow script.
- `blob:`/`data:` in `connect-src` are needed by three.js to load textures embedded in the `.glb` models. `worker-src blob:` is allowed for workers.
- Google Fonts are the only third-party CSS/fonts; YouTube (privacy-enhanced `youtube-nocookie.com`) is the only embedded third-party frame.
- `scripts/csp-probe.mjs` loads every route, the 3D page, the embeds and the service worker against the built app with these headers and fails on any violation (it runs in CI).

## Accepted dependency findings (`npm audit --omit=dev`, 2026-11; recorded by an earlier pass, not re-run when these docs were checked)
Eight findings reported on production dependencies, none reachable in the deployed app:
- `vite` (high) / `esbuild` (moderate): development-server request issues; they affect `npm run dev` only, not the static build served by Vercel. The fix is Vite 8 (major upgrade, not done in this hardening pass).
- `react-router` / `react-router-dom` (moderate): open redirect via backslash in `<Link>`/`navigate` with attacker-controlled targets, and an SSR hydration issue. The app has no SSR and never navigates to user-supplied URLs. Fixed in 7.x (major upgrade).
- `glob`, `minimatch`, `workbox-build` (moderate): build-time tooling used by the PWA plugin.
Re-run `npm audit --omit=dev` before releases and plan the Vite and react-router major upgrades.
