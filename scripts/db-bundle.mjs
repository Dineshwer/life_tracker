#!/usr/bin/env node
/* Regenerates supabase/apply-all.sql from supabase/migrations/*.sql (concatenated in file-name order, one header per file).
   The owner pastes that file into Supabase -> SQL Editor -> Run (every migration is idempotent, so re-running is safe).
   Usage: node scripts/db-bundle.mjs [--check]     --check: write nothing, exit 1 if apply-all.sql is out of date (used in CI). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'supabase', 'migrations');
const out = path.join(root, 'supabase', 'apply-all.sql');
const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
if (!files.length) { console.error('no migrations found'); process.exit(1); }
const nums = files.map((f) => f.split('_')[0]);
const head = `-- Ledger: ALL migrations in order (${nums[0]}..${nums[nums.length - 1]}), idempotent. Paste into Supabase -> SQL Editor -> Run. Safe to re-run.`;
const body = files.map((f) => `-- ======== migrations/${f} ========\n${fs.readFileSync(path.join(dir, f), 'utf8').replace(/\s+$/, '')}`);
const text = [head, ...body].join('\n\n') + '\n';

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (cur !== text) { console.error('supabase/apply-all.sql is out of date: run `npm run db:bundle`'); process.exit(1); }
  console.log('supabase/apply-all.sql is up to date');
} else {
  fs.writeFileSync(out, text);
  console.log(`wrote supabase/apply-all.sql from ${files.length} migrations (${files.join(', ')})`);
}
