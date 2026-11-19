/* The REAL Supabase adapter (src/sync/remote.ts) against the real SQL through a PGlite-backed client: the shared Remote contract runs on
   (1) the pull_changes RPC path and (2) the capability fallback (RPC missing -> select on records). */
import { describe, expect, it } from 'vitest';
import { describeRemoteContract } from './remote.contract';
import { createDb, asAdmin } from './db/harness';
import { PULL_CHANGES_SQL, pgliteClient, type ClientLog } from './pgliteClient';
import { createSupabaseRemote, isMissingFunction, rowFromRealtime } from '../../src/sync/remote';
import { USER_A } from './supabaseRemote.fixtures';

const world = (pullChanges: boolean) => async () => {
  const db = await createDb(); if (pullChanges) await asAdmin(db).exec(PULL_CHANGES_SQL);
  const users = new Set<string>();
  return { remote: (u: string) => { if (!users.has(u)) { users.add(u); void db.query('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [u, `${u}@test.local`]); } return createSupabaseRemote(pgliteClient(db, u, { pullChanges }), u); }, close: () => db.close() };
};
describeRemoteContract('Supabase adapter, pull_changes RPC', world(true));
describeRemoteContract('Supabase adapter, fallback (no pull_changes: select on records)', world(false));

describe('adapter pull mode', () => {
  it('reports rpc when the function exists, table after the fallback, and keeps the mode afterwards', async () => {
    for (const has of [true, false]) {
      const db = await createDb(); if (has) await asAdmin(db).exec(PULL_CHANGES_SQL);
      const log: ClientLog = { rpcs: [], selects: 0 };
      await db.query('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [USER_A, 'a@test.local']);
      const r = createSupabaseRemote(pgliteClient(db, USER_A, { pullChanges: has }, log), USER_A);
      expect(r.pullMode()).toBeUndefined();
      await r.push([{ collection: 'tasks', id: 't1', data: { id: 't1' }, deleted: false, base_version: 0 }], 'd');
      expect((await r.pull(0, 10)).map((x) => x.id)).toEqual(['t1']);
      expect(r.pullMode()).toBe(has ? 'rpc' : 'table');
      await r.pull(0, 10);
      expect(log.rpcs.filter((n) => n === 'pull_changes').length, 'the missing RPC is probed once, not on every pull').toBe(has ? 2 : 1);
      expect(log.selects).toBe(has ? 0 : 2);
      await db.close();
    }
  }, 60_000);
  it('isMissingFunction recognises the PostgREST / Postgres signals', () => {
    expect(isMissingFunction({ code: 'PGRST202' })).toBe(true); expect(isMissingFunction({ status: 404 })).toBe(true); expect(isMissingFunction({ code: '42883' })).toBe(true);
    expect(isMissingFunction({ code: '42501', status: 403 })).toBe(false);
  });
  it('rowFromRealtime maps the generic table and ignores unknown tables / incomplete payloads', () => {
    const rec = { collection: 'tasks', id: 't1', data: { id: 't1' }, deleted: false, version: '2', seq: '9', updated_at: 'x', user_id: 'u' };
    expect(rowFromRealtime('records', rec)).toMatchObject({ collection: 'tasks', id: 't1', version: 2, seq: 9 });
    expect(rowFromRealtime('other', rec)).toBeUndefined(); expect(rowFromRealtime('records', { id: 't1' })).toBeUndefined(); expect(rowFromRealtime('records', null)).toBeUndefined();
  });
});
