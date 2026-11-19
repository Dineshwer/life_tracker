import type { SupabaseClient } from '@supabase/supabase-js';
import type { BackupInfo, PushItem, PushResult, Remote, RemoteRow } from './types';

/* The Supabase implementation of Remote. RLS scopes every query to the signed-in user. */

export class RemoteAuthError extends Error {
  override name = 'AuthError';
  status = 401;
}
interface RpcError { message?: string; code?: string; status?: number; details?: string }

function fail(e: RpcError): never {
  const msg = e.message ?? 'Request failed';
  if (e.status === 401 || e.status === 403 || e.code === 'PGRST301' || /jwt|not authenticated|invalid token/i.test(msg)) throw new RemoteAuthError('Your session expired. Sign in again.');
  if (e.code === '42703' || e.code === '42883' || (e.code && /^PGRST20[245]$/.test(e.code)) || e.status === 404 || /push_records|records\.seq|list_backups|take_backup|restore_backup/.test(msg)) {
    throw new Error('The database upgrade has not been applied yet. Run supabase/apply-all.sql in the Supabase SQL editor. Your changes are kept on this device.');
  }
  const err = new Error(msg) as Error & { code?: string; status?: number };
  err.code = e.code; err.status = e.status;
  throw err;
}

const COLS = 'collection,id,data,deleted,version,seq,updated_at,device_id';
const toRow = (o: RemoteRow): RemoteRow => ({ collection: o.collection, id: o.id, data: o.data, deleted: o.deleted, version: Number(o.version), seq: Number(o.seq), updated_at: o.updated_at, device_id: o.device_id ?? null });

/** The RPC does not exist (database not migrated yet): PostgREST "function not found" (PGRST202), a 404, or Postgres undefined_function (42883). */
export const isMissingFunction = (e: RpcError): boolean => e.code === 'PGRST202' || e.code === '42883' || e.status === 404;

/* ---- realtime: table-agnostic ----
   The server may publish several tables (today only `records`; later typed tables). Every change payload must carry user_id, id, version, seq, deleted and
   either a `collection` column (generic table) or be mapped from the table name through TABLE_TO_COLLECTION. */
export const TABLE_TO_COLLECTION: Record<string, string | null> = {
  records: null, // generic table: the row carries its own `collection`
  // typed tables (design pending): 'habits': 'habits', 'tasks': 'tasks', ... (a typed table holds ONE collection, so the lookup supplies it)
};
export const REALTIME_TABLES: string[] = Object.keys(TABLE_TO_COLLECTION);
/** Map a realtime change payload (`payload.new`) from `table` to a RemoteRow, or undefined when it is not a usable row (DELETE events, unknown table, missing fields).
    Typed tables: if the row has no `data` column the whole row minus the bookkeeping columns is the item (STUB: the architect defines the real mapping here). */
export function rowFromRealtime(table: string, rec: unknown): RemoteRow | undefined {
  const n = rec as Record<string, unknown> | null;
  if (!n || typeof n !== 'object' || typeof n.id !== 'string' || !(table in TABLE_TO_COLLECTION)) return undefined;
  const collection = TABLE_TO_COLLECTION[table] ?? (typeof n.collection === 'string' ? n.collection : undefined);
  if (!collection || n.version === undefined || n.seq === undefined) return undefined;
  let data = n.data;
  if (data === undefined) { const { user_id: _u, id: _i, version: _v, seq: _s, deleted: _d, updated_at: _t, device_id: _dev, created_at: _c, collection: _col, ...rest } = n; void [_u, _i, _v, _s, _d, _t, _dev, _c, _col]; data = rest; }
  return toRow({ collection, id: n.id, data, deleted: !!n.deleted, version: Number(n.version), seq: Number(n.seq), updated_at: String(n.updated_at ?? ''), device_id: (n.device_id as string | null | undefined) ?? null });
}

export type PullMode = 'rpc' | 'table';
export interface SupabaseRemote extends Remote { pullMode(): PullMode | undefined }

export function createSupabaseRemote(client: SupabaseClient, userIdHint?: string): SupabaseRemote {
  let mode: PullMode | undefined; // decided by the first pull: the RPC when the database has it, else the old table select
  const pullTable = async (since: number, limit: number): Promise<RemoteRow[]> => {
    const { data, error } = await client.from('records').select(COLS).gt('seq', since).order('seq', { ascending: true }).limit(limit);
    if (error) fail(error);
    return ((data ?? []) as RemoteRow[]).map(toRow);
  };
  return {
    pullMode: () => mode,
    async pull(sinceSeq, limit = 1000) {
      if (mode !== 'table') {
        const { data, error } = await client.rpc('pull_changes', { p_after: sinceSeq, p_limit: limit });
        if (!error) { mode = 'rpc'; return ((data ?? []) as RemoteRow[]).map(toRow); }
        if (!isMissingFunction(error)) fail(error);
        mode = 'table'; // not migrated yet: fall back (the next app start tries the RPC again)
      }
      return pullTable(sinceSeq, limit);
    },
    async push(items: PushItem[], deviceId: string) {
      const { data, error } = await client.rpc('push_records', { p_items: items, p_device_id: deviceId });
      if (error) fail(error);
      return ((data ?? []) as PushResult[]).map((r) => ({ collection: r.collection, id: r.id, status: r.status, reason: r.reason, row: r.row ? toRow(r.row) : undefined }));
    },
    subscribe(onRow, onStatus) {
      const channels: ReturnType<SupabaseClient['channel']>[] = []; let closed = false;
      void (async () => {
        let uid = userIdHint;
        if (!uid) { try { uid = (await client.auth.getSession()).data.session?.user.id; } catch { /* ignore */ } }
        if (closed) return;
        if (!uid) { onStatus('down'); return; }
        const up = new Set<string>(); // live only while EVERY table's channel is subscribed
        for (const table of REALTIME_TABLES) {
          const ch = client.channel(`${table}-${uid}-${Math.random().toString(36).slice(2, 8)}`)
            .on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${uid}` }, (payload) => {
              const row = rowFromRealtime(table, payload.new); // DELETE events (tombstone purge) carry no data: ignored
              if (row) onRow(row);
            })
            .subscribe((st) => { if (st === 'SUBSCRIBED') up.add(table); else up.delete(table); onStatus(up.size === REALTIME_TABLES.length ? 'live' : 'down'); });
          channels.push(ch);
        }
      })();
      return () => { closed = true; for (const ch of channels) void client.removeChannel(ch); };
    },
    async listBackups() {
      const { data, error } = await client.rpc('list_backups', { p_include_safety: false });
      if (error) fail(error);
      return ((data ?? []) as BackupInfo[]).map((b) => ({ taken_on: b.taken_on, row_count: Number(b.row_count) }));
    },
    async takeBackup() {
      const { data, error } = await client.rpc('take_backup');
      if (error) fail(error);
      const b = data as BackupInfo;
      return { taken_on: b.taken_on, row_count: Number(b.row_count) };
    },
    async restoreBackup(takenOn) {
      const { data, error } = await client.rpc('restore_backup', { p_date: takenOn, p_kind: 'daily' });
      if (error) fail(error);
      return Number(data);
    },
  };
}
