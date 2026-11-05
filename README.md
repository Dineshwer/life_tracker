# Ledger

A personal life tracker: tasks, habits, gym, routine, journal, XP and levels, rewards, and a 1,000-rejections challenge. Built as an installable PWA (phone and laptop) with optional Supabase sync.

## Stack
React 18 · TypeScript · Vite · zustand · react-router · plain CSS (no UI kit) · vite-plugin-pwa · Supabase (auth + sync)

## Run it
```bash
npm install
npm run dev          # http://localhost:5173, runs fully local without Supabase
npm run build        # type-checks and builds the PWA into dist/
```

## Supabase sync (optional)
1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor.
2. Copy `.env.example` to `.env.local` and fill in your project URL and publishable key.
3. Without these variables the app simply runs local-only.

Sync is item level: every habit, task, set and so on is one row in `public.records`, protected by row-level security so a login only sees its own rows.

## Themes
13 skins, each with a dark and a light mode, switchable in Settings → Theme.
- Token contract and defaults: [`src/styles/tokens.css`](src/styles/tokens.css)
- Registry (names, fonts, native mode): [`src/themes.ts`](src/themes.ts)
- One file per skin: [`src/styles/skins/`](src/styles/skins/)
- Design notes: [`DESIGN.md`](DESIGN.md)

## QA helpers
Append URL parameters to force a theme and load sample data (never persisted, and the demo loader is disabled when Supabase is configured):

`/today?skin=paper&mode=light&demo=1`

## Notes
- XP: missed scheduled habit days lose XP, but your level never drops.
- Rewards unlock when total XP reaches their threshold; claiming does not spend XP.
