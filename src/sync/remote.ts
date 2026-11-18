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

export function createSupabaseRemote(client: SupabaseClient, userIdHint?: string): Remote {
  return {
    async pull(sinceSeq, limit = 1000) {
      const { data, error } = await client.from('records').select(COLS).gt('seq', sinceSeq).order('seq', { ascending: true }).limit(limit);
      if (error) fail(error);
      return ((data ?? []) as RemoteRow[]).map(toRow);
    },
    async push(items: PushItem[], deviceId: string) {
      const { data, error } = await client.rpc('push_records', { p_items: items, p_device_id: deviceId });
      if (error) fail(error);
      return ((data ?? []) as PushResult[]).map((r) => ({ collection: r.collection, id: r.id, status: r.status, reason: r.reason, row: r.row ? toRow(r.row) : undefined }));
    },
    subscribe(onRow, onStatus) {
      let channel: ReturnType<SupabaseClient['channel']> | undefined; let closed = false;
      void (async () => {
        let uid = userIdHint;
        if (!uid) { try { uid = (await client.auth.getSession()).data.session?.user.id; } catch { /* ignore */ } }
        if (closed) return;
        if (!uid) { onStatus('down'); return; }
        channel = client.channel(`records-${uid}-${Math.random().toString(36).slice(2, 8)}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `user_id=eq.${uid}` }, (payload) => {
            const n = payload.new as Partial<RemoteRow>; // DELETE events (tombstone purge) carry no data: ignored
            if (n && typeof n.collection === 'string' && typeof n.id === 'string') onRow(toRow(n as RemoteRow));
          })
          .subscribe((s) => { onStatus(s === 'SUBSCRIBED' ? 'live' : 'down'); });
      })();
      return () => { closed = true; if (channel) void client.removeChannel(channel); };
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
