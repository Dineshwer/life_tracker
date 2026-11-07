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

## Entertainment: HackerTube tab
Ships with the open [HackerTube data](https://hackertube.org/data) (6,454 videos Hacker News readers recommend, ODC-BY licence, exported 2026-10-31) as `public/hackertube.json`. Pick topics in the app; no key needed. To refresh it, download `videos.jsonl` and `taxonomy.json` from that page and rebuild the file.

## Entertainment: My YouTube tab (your channels)
The feed shows the newest long videos from YouTube channels you pick (starter list: LiveOverflow, John Hammond, 3Blue1Brown, Veritasium and others; edit it under Channels). It uses the official YouTube Data API, so it needs one free key:
1. In Google Cloud Console create a project, enable **YouTube Data API v3**, and create an API key (restrict it to that API).
2. Laptop: put `YOUTUBE_API_KEY=your-key` in `.env.local` and restart `npm run dev`.
3. Phone (Vercel): add `YOUTUBE_API_KEY` under Project Settings > Environment Variables, then redeploy.
Each refresh costs about 3 quota units per channel against a free 10,000 a day. The key never reaches the browser: it is read by `api/feed.js`.

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
