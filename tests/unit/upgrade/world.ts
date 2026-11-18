import { createDb, createUser, applyMigrations, applyAllSql, asAdmin } from '../db/harness';
import { pgOldDb, OldClient } from './oldClient';
import { oldState, legacyKeys } from './fixtures';
import { serverRows } from './device';
import { TestClock } from '../engine/harness';

export const UID = '22222222-2222-4222-8222-222222222222';

/** a LIVE 0001 database holding what the old client wrote from the laptop (and nothing else) */
export async function oldWorld(opts: { seedN?: number } = {}) {
  const db = await createDb({ upTo: '0001' }); await createUser(db, UID);
  // Supabase's default privileges in `public` give the API roles full access to every new table; the PGlite stub does not, so state it:
  await db.exec('grant all on public.records to anon, authenticated, service_role');
  const laptop = new OldClient(UID, pgOldDb(db, UID), oldState(opts.seedN ?? 7));
  await laptop.cycle();
  if (laptop.status !== 'synced') throw new Error('old client could not populate: ' + laptop.lastError);
  // Tombstones. NOTE (old-client defect, see s1 test 'old client resurrects deletions'): the OLD client can never persist a delete, because every cycle
  // pulls (and re-adds the still-live row) before it pushes. So a real old table normally has NO tombstones. We still write some, exactly as old push()
  // would (data {}, deleted true), to prove the upgrade preserves them (e.g. rows deleted via the SQL editor / an earlier build).
  const st = laptop.state; const dead = [...st.tasks.slice(0, 5).map((x: any) => ['tasks', x.id]), ...st.habitLogs.slice(0, 4).map((x: any) => ['habitLogs', x.id]), ['rejections', st.rejections[3].id]];
  await laptop.db.upsert(dead.map(([c, id]) => ({ user_id: UID, collection: c, id, data: {}, deleted: true, updated_at: new Date().toISOString() })));
  st.tasks = st.tasks.slice(5); st.habitLogs = st.habitLogs.slice(4); st.rejections = st.rejections.filter((_: any, i: number) => i !== 3);
  for (const [c, id] of dead) laptop.synced.delete(`${c}/${id}`);
  const clock = new TestClock();
  return { db, laptop, clock, legacy: legacyKeys('laptop'), rowsBeforeUpgrade: await serverRows(db, UID) };
}
export { applyMigrations, applyAllSql, asAdmin, serverRows };

/** the candidate SQL fix for DEFECT-A: give the legacy settings row the `id` the new validator requires (idempotent; bumps version/seq via the trigger only when it changes anything) */
export async function backfillMetaId(db: any) {
  await asAdmin(db).query(`update public.records set data = data || jsonb_build_object('id','settings') where collection = 'meta' and id = 'settings' and not (data ? 'id')`);
}
