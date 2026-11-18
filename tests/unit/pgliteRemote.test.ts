/* Runs the shared Remote contract against the REAL SQL (PGlite + the DB agent's migrations). Skips with a clear message while
   the DB agent's harness/migrations are missing. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { describeRemoteContract } from './remote.contract';

const harness = join(__dirname, 'db', 'harness.ts');
const backups = join(__dirname, '..', '..', 'supabase', 'migrations', '0004_backups.sql');
if (!existsSync(harness) || !existsSync(backups)) {
  describe('Remote contract: PGlite (SQL)', () => { it.skip(`SKIPPED: missing ${!existsSync(harness) ? 'tests/unit/db/harness.ts' : 'supabase/migrations/0004_backups.sql'} (DB agent files not present yet)`, () => {}); });
} else {
  const { createDb } = await import('./db/harness');
  const { pgliteWorld } = await import('./pgliteRemote');
  describeRemoteContract('PGlite SQL', async () => pgliteWorld(await createDb()));
}
