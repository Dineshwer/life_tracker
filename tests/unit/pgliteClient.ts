/* A tiny SupabaseClient look-alike over PGlite, just big enough for src/sync/remote.ts (createSupabaseRemote): from('records').select().gt().order().limit(),
   rpc(name, args), and no-op realtime. It lets the REAL adapter (rpc path and the table fallback) run against the real SQL. */
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asUser } from './db/harness';

/** What the typed-table migration must provide (the contract the client assumes): jsonb array of RemoteRow-shaped objects ordered by seq, RLS-scoped (security invoker). */
export const PULL_CHANGES_SQL = `
  create or replace function public.pull_changes(p_after bigint, p_limit int) returns jsonb language sql stable security invoker as $$
    select coalesce(jsonb_agg(to_jsonb(r) order by r.seq), '[]'::jsonb)
    from (select collection, id, data, deleted, version, seq, updated_at, device_id from public.records where seq > p_after order by seq limit p_limit) r $$;
  grant execute on function public.pull_changes(bigint, int) to authenticated;`;

const plain = (v: unknown): unknown => {
  const j = JSON.parse(JSON.stringify(v ?? null)) as unknown;
  const fix = (x: unknown): unknown => { if (Array.isArray(x)) return x.map(fix); if (x && typeof x === 'object') { const o = { ...(x as Record<string, unknown>) }; if (typeof o.taken_on === 'string') o.taken_on = o.taken_on.slice(0, 10); for (const k of Object.keys(o)) if (k !== 'data') o[k] = fix(o[k]); return o; } return x; };
  return fix(j);
};

export interface ClientLog { rpcs: string[]; selects: number }
export function pgliteClient(db: PGlite, userId: string, opts: { pullChanges: boolean }, log: ClientLog = { rpcs: [], selects: 0 }): SupabaseClient {
  const session = () => asUser(db, userId);
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    log.rpcs.push(name);
    if (name === 'pull_changes' && !opts.pullChanges) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.pull_changes(p_after, p_limit) in the schema cache', status: 404 } };
    try { return { data: plain(await session().rpc(name, args)), error: null }; }
    catch (e) { const x = e as { message?: string; code?: string }; return { data: null, error: { message: x.message, code: x.code } }; }
  };
  const from = (table: string) => {
    let after = 0; let n = 1000;
    const b = {
      select: () => b, order: () => b,
      gt: (_c: string, v: number) => { after = v; return b; },
      limit: (k: number) => { n = k; return b; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => (async () => {
        log.selects++;
        try { const rows = await session().query(`select collection, id, data, deleted, version, seq, updated_at, device_id from public.${table} where seq > $1 order by seq asc limit $2`, [after, n]); return { data: plain(rows), error: null }; }
        catch (e) { const x = e as { message?: string; code?: string }; return { data: null, error: { message: x.message, code: x.code } }; }
      })().then(res, rej),
    };
    return b;
  };
  const channel = () => { const c = { on: () => c, subscribe: () => c }; return c; };
  return { rpc, from, channel, removeChannel: async () => 'ok', auth: { getSession: async () => ({ data: { session: null } }) } } as unknown as SupabaseClient;
}
